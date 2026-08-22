import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { expect, test, type Page } from "@playwright/test";

/**
 * The atmosphere's lifecycle, in a real browser.
 *
 * `tests/unit/atmosphere-lifecycle.test.tsx` covers what the component does
 * with a stubbed renderer, and `tests/e2e/atmosphere.spec.ts` covers what the
 * shader draws on a bare canvas. Neither can see the defect that actually
 * shipped: `forceContextLoss()` in the cleanup destroyed the WebGL context that
 * React's development remount then inherited on the *same* `<canvas>`, and the
 * field came back as a flat white sheet over the whole world. A pixel read
 * taken before the teardown still showed the right colour, which is what kept
 * it looking like a shader fault.
 *
 * Seeing it needs a real WebGL implementation, React's development
 * double-mount, and one canvas across both mounts — all three at once. So this
 * bundles the component itself (never a copy) with the fixture in
 * `fixtures/atmosphere-mount.tsx`, opens it as a local page, and drives the
 * mounts from the test.
 *
 * No server and no account, like the shader spec. The bundle is built into a
 * temporary directory and is imported by nothing under `src/`, so none of the
 * instrumentation here can reach a production build.
 */

const ENTRY = "tests/e2e/fixtures/atmosphere-mount.tsx";

/**
 * Built once for the file, in **development** mode on purpose.
 *
 * StrictMode only double-invokes effects in React's development build, and the
 * double-invoke is the whole point: it is the only thing that mounts, unmounts
 * and mounts again on one canvas. A production bundle here would pass while
 * testing nothing. `registrations >= 2` below is the assertion that keeps that
 * honest.
 */
let pageUrl: Promise<string> | null = null;

async function fixtureUrl(): Promise<string> {
  pageUrl ??= (async () => {
    const outDir = await mkdtemp(join(tmpdir(), "captivate-atmosphere-"));

    await build({
      root: process.cwd(),
      mode: "development",
      logLevel: "error",
      plugins: [react()],
      resolve: { alias: { "@": resolve(process.cwd(), "src") } },
      define: { "process.env.NODE_ENV": '"development"' },
      build: {
        outDir,
        emptyOutDir: true,
        minify: false,
        // One self-contained script, so the page can be opened from the file
        // system without a server and without module CORS.
        lib: {
          entry: resolve(process.cwd(), ENTRY),
          formats: ["iife"],
          name: "atmosphereFixture",
          fileName: () => "fixture.js",
        },
      },
    });

    const script = await readFile(join(outDir, "fixture.js"), "utf8");
    const html = join(outDir, "index.html");
    await writeFile(
      html,
      `<!doctype html><meta charset="utf-8"><title>atmosphere</title>` +
        `<body style="margin:0;background:#000"><script>${script}</script></body>`,
    );
    return `file://${html}`;
  })();

  return pageUrl;
}

interface Inspection {
  canvases: number;
  hasCanvas: boolean;
  canvasHidden: boolean;
  contextLost: boolean | null;
  hasHandle: boolean;
  registrations: number;
  releases: number;
}

interface Frame {
  drew: boolean;
  pixel: [number, number, number, number] | null;
}

/**
 * Counts every animation frame and context-loss listener the page takes out.
 *
 * Installed before the bundle runs, so a loop or a listener the component
 * forgets to release is visible as a number rather than as heat.
 */
const INSTRUMENT = () => {
  const counters = { outstanding: new Set<number>(), requested: 0, listeners: 0 };
  (window as unknown as { probe: typeof counters }).probe = counters;

  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);

  window.requestAnimationFrame = (callback) => {
    const id = request((time) => {
      counters.outstanding.delete(id);
      callback(time);
    });
    counters.outstanding.add(id);
    counters.requested += 1;
    return id;
  };

  window.cancelAnimationFrame = (id) => {
    counters.outstanding.delete(id);
    cancel(id);
  };

  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (type === "webglcontextlost") counters.listeners += 1;
    return add.call(this, type, listener, options);
  };

  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    if (type === "webglcontextlost") counters.listeners -= 1;
    return remove.call(this, type, listener, options);
  };
};

async function open(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });

  await page.addInitScript(INSTRUMENT);
  await page.goto(await fixtureUrl());
  return problems;
}

const inspect = (page: Page) =>
  page.evaluate(() => window.atmosphereFixture.inspect()) as Promise<Inspection>;

const probe = (page: Page) =>
  page.evaluate(() => {
    const counters = (
      window as unknown as {
        probe: { outstanding: Set<number>; requested: number; listeners: number };
      }
    ).probe;
    return {
      outstanding: counters.outstanding.size,
      requested: counters.requested,
      listeners: counters.listeners,
    };
  });

async function mount(page: Page, options?: { still?: boolean; depth?: number }) {
  await page.evaluate((o) => window.atmosphereFixture.mount(o), options);
  await page.waitForFunction(() => window.atmosphereFixture.inspect().hasHandle);
}

const unmount = (page: Page) => page.evaluate(() => window.atmosphereFixture.unmount());

const draw = (page: Page) => page.evaluate(() => window.atmosphereFixture.draw()) as Promise<Frame>;

/** A drawn frame, as opposed to the zeroes a dead context leaves behind. */
function expectPainted(frame: Frame) {
  expect(frame.drew, "draw() reported no renderer").toBe(true);
  expect(frame.pixel, "no context to read the frame back from").not.toBeNull();
  const [r, g, b, a] = frame.pixel!;
  expect(a, "opaque buffer, so alpha is 255 on any real frame").toBe(255);
  expect(
    r + g + b,
    `centre pixel came back black — rgb(${r}, ${g}, ${b}) — which is what a lost context leaves`,
  ).toBeGreaterThan(0);
}

test.describe("atmosphere lifecycle", () => {
  test.beforeAll(async () => {
    // Bundling React and three from source, once for the file.
    test.setTimeout(240_000);
    await fixtureUrl();
  });

  test("survives React's development remount on the same canvas", async ({ page }) => {
    const problems = await open(page);
    await mount(page);

    const state = await inspect(page);

    // The guard that keeps this test honest: two registrations and one release
    // from a single mount is React having torn the effect down and set it up
    // again — on the canvas it had already given the first one. A production
    // React build would report one, and the rest of this would pass while
    // testing nothing.
    expect(
      state.registrations,
      "StrictMode did not double-invoke; this bundle is not a development build",
    ).toBeGreaterThanOrEqual(2);
    expect(state.releases).toBeGreaterThanOrEqual(1);

    expect(state.canvases, "one canvas, not one per mount").toBe(1);
    expect(state.contextLost, "the remount inherited a destroyed context").toBe(false);
    expect(state.canvasHidden).toBe(false);

    expectPainted(await draw(page));
    expect(problems).toEqual([]);
  });

  test("keeps drawing across repeated unmount and remount cycles", async ({ page }) => {
    const problems = await open(page);
    await mount(page);
    expectPainted(await draw(page));

    // Twelve is chosen against the other side of the same trade: dropping
    // `forceContextLoss()` means a context is released when its detached canvas
    // is collected rather than at once, and browsers keep only so many alive.
    // If the cycles leaked, the last one would be refused a context.
    for (let cycle = 0; cycle < 12; cycle += 1) {
      await unmount(page);
      await mount(page);
      const state = await inspect(page);
      expect(state.canvases, `cycle ${cycle}: a canvas was left behind`).toBe(1);
      expect(state.contextLost, `cycle ${cycle}: no live context`).toBe(false);
      expectPainted(await draw(page));
    }

    expect(problems).toEqual([]);
  });

  test("releases its animation frames and listeners on unmount", async ({ page }) => {
    const problems = await open(page);
    const before = await probe(page);

    await mount(page);
    // The drift loop runs at a twelfth of the display's rate; a couple of its
    // intervals is long enough to be sure it is really running.
    await page.waitForFunction(
      (baseline) =>
        (window as unknown as { probe: { requested: number } }).probe.requested > baseline + 2,
      before.requested,
    );

    const running = await probe(page);
    expect(running.outstanding, "the drift loop is not actually running").toBeGreaterThan(0);
    expect(running.listeners, "no context-loss listener was ever attached").toBeGreaterThan(0);

    await unmount(page);
    await page.waitForFunction(
      () =>
        (window as unknown as { probe: { outstanding: Set<number> } }).probe.outstanding.size === 0,
    );

    const after = await probe(page);
    expect(after.outstanding, "an animation frame outlived the component").toBe(0);
    expect(after.listeners, "a webglcontextlost listener outlived the component").toBe(
      before.listeners,
    );

    const settled = await probe(page);
    await page.waitForTimeout(250);
    const later = await probe(page);
    expect(later.requested, "the loop kept scheduling after unmount").toBe(settled.requested);

    expect(problems).toEqual([]);
  });

  test("stands down when the driver takes the context back", async ({ page }) => {
    const problems = await open(page);
    await mount(page);
    expectPainted(await draw(page));

    await page.evaluate(() => window.atmosphereFixture.loseContext());
    await page.waitForFunction(() => window.atmosphereFixture.inspect().canvasHidden);

    const state = await inspect(page);
    // Hidden rather than left in place: the canvas is opaque, so a dead one
    // would paint black over the world instead of letting the CSS wash show.
    expect(state.canvasHidden).toBe(true);
    expect(state.hasHandle, "still offering to draw with no context").toBe(false);

    // And nothing keeps spinning for a surface that is gone.
    await page.waitForFunction(
      () =>
        (window as unknown as { probe: { outstanding: Set<number> } }).probe.outstanding.size === 0,
    );

    expect(problems).toEqual([]);
  });

  test("draws nothing and starts no loop when the drift is frozen", async ({ page }) => {
    const problems = await open(page);
    await mount(page, { still: true });

    const baseline = await probe(page);
    await page.waitForTimeout(250);
    const after = await probe(page);

    expect(after.requested, "the drift loop ran while the presentation asked for stillness").toBe(
      baseline.requested,
    );

    // Still is not blank: the field is drawn, it simply stops moving.
    expectPainted(await draw(page));
    expect(problems).toEqual([]);
  });
});
