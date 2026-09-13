import { expect, test } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * Travel is the transition.
 *
 * There is no per-scene transition in Captivate: moving from one scene to the
 * next *is* the camera crossing the distance between two regions, and a deck
 * set to `fly` that arrives instantly is the product's central claim quietly
 * failing. Nothing in a unit test can see the difference — the flight is
 * written straight to `style.transform`, outside React, sixty times a second —
 * so this mounts the world in a real browser and reads back every transform it
 * wrote.
 *
 * The world alone, not the presenter: a presenter consumes an advance as a
 * build step before the camera moves at all, which makes "did it fly?" and
 * "did it advance?" the same question. Here they are separate.
 */

const ENTRY = "tests/e2e/fixtures/camera-flight-mount.tsx";

let pageUrl: Promise<string> | null = null;
function fixtureUrl(): Promise<string> {
  pageUrl ??= bundleFixture(ENTRY);
  return pageUrl;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** World coordinates the camera is centred on, read out of a transform. */
function centreX(transform: string): number {
  // `worldTransform` ends with the negated camera centre.
  const matches = [...transform.matchAll(/translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\)/g)];
  const last = matches[matches.length - 1];
  return last ? -Number(last[1]) : Number.NaN;
}

test.describe("the camera", () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await fixtureUrl();
  });

  test("travels between two regions rather than arriving at once", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(await fixtureUrl());
    await page.evaluate(() => window.cameraFixture.mount("fly"));
    await page.waitForSelector("[data-world]", { state: "attached" });
    // The first framing is written by an effect, after paint.
    await page.waitForFunction(() =>
      Boolean((document.querySelector("[data-world]") as HTMLElement)?.style.transform),
    );

    const arrival = await page.evaluate(() => window.cameraFixture.arrival);
    const seen = await page.evaluate(() => window.cameraFixture.samples(1, 3000));

    // Three is the smallest number that can distinguish travel from a cut:
    // where it started, somewhere it was on the way, and where it landed.
    // Asserted as a floor rather than a count because how many frames a
    // 500ms flight gets is a property of the machine, not of the camera.
    expect(seen.length, `transforms written:\n${seen.join("\n")}`).toBeGreaterThanOrEqual(3);

    expect(centreX(seen[0])).toBeCloseTo(0, 3);
    expect(centreX(seen[seen.length - 1])).toBeCloseTo(arrival, 3);

    // And it genuinely passed *between* the two, rather than jumping and
    // settling: at least one framing sits strictly between departure and
    // arrival, and none of them is outside the two.
    const centres = seen.map(centreX);
    const trace = `centres: ${centres.join(", ")}`;
    expect(
      centres.some((x) => x > 1 && x < arrival - 1),
      trace,
    ).toBe(true);
    expect(
      centres.every((x) => x >= -1 && x <= arrival + 1),
      trace,
    ).toBe(true);
  });

  test("cuts in one write when the deck asks for a cut", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(await fixtureUrl());
    await page.evaluate(() => window.cameraFixture.mount("cut"));
    await page.waitForSelector("[data-world]", { state: "attached" });
    await page.waitForFunction(() =>
      Boolean((document.querySelector("[data-world]") as HTMLElement)?.style.transform),
    );

    const arrival = await page.evaluate(() => window.cameraFixture.arrival);
    const seen = await page.evaluate(() => window.cameraFixture.samples(1, 1500));

    // Two: where it was, and where it now is. This is the control for the
    // test above — without it, "three or more transforms" would pass on a
    // camera that simply jittered.
    expect(seen.length, `transforms written:\n${seen.join("\n")}`).toBe(2);
    expect(centreX(seen[1])).toBeCloseTo(arrival, 3);
  });

  test("changes room with a crossfade on the plane, never a cut", async ({ page }) => {
    // A movement with a room of its own: the new picture comes in over the
    // old, fading, and the old is dropped once the fade is done. The fade is
    // a CSS animation, so only a browser can see it happen.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(await fixtureUrl());
    await page.evaluate(() => window.cameraFixture.mount("cut", true));
    await page.waitForSelector("[data-backdrop-picture] img", { state: "attached" });

    const frames = await page.evaluate(async () => {
      const read = () =>
        [...document.querySelectorAll<HTMLImageElement>("[data-backdrop-picture] img")].map(
          (img) => ({
            key: img.getAttribute("data-room-key"),
            opacity: Number(getComputedStyle(img).opacity),
          }),
        );
      const values: { key: string | null; opacity: number }[][] = [read()];
      window.flyTo(1);
      const deadline = performance.now() + 2500;
      await new Promise<void>((resolve) => {
        const tick = () => {
          values.push(read());
          if (performance.now() >= deadline) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return values;
    });
    const trace = frames.map((f) => f.map((l) => `${l.key}:${l.opacity.toFixed(2)}`).join("+"));
    // Before: the show's room alone, opaque.
    expect(frames[0], trace.join(" | ")).toEqual([{ key: "show", opacity: 1 }]);
    // During: both rooms on the plane, the new one coming in from nothing.
    const during = frames.slice(1).filter((f) => f.length === 2);
    expect(during.length, trace.join(" | ")).toBeGreaterThan(3);
    expect(during[0][1].key, trace.join(" | ")).toBe(uuid(302));
    expect(during[0][1].opacity, trace.join(" | ")).toBeLessThan(0.5);
    expect(
      during.every((f, i) => i === 0 || f[1].opacity >= during[i - 1][1].opacity - 1e-6),
      trace.join(" | "),
    ).toBe(true);
    // After: the movement's room alone, opaque; the old one dropped.
    const last = frames[frames.length - 1];
    expect(last, trace.join(" | ")).toEqual([{ key: uuid(302), opacity: 1 }]);
  });

  test("lifts the veil off the picture behind the show as it pulls back to the world", async ({
    page,
  }) => {
    // The picture is the room the show stands in: quiet behind a scene's
    // words, whole from the overview. The veil is written from the camera
    // loop, so only a browser can see it move.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(await fixtureUrl());
    await page.evaluate(() => window.cameraFixture.mount("fly", true));
    await page.waitForSelector("[data-backdrop-veil]", { state: "attached" });
    await page.waitForFunction(() =>
      Boolean((document.querySelector("[data-world]") as HTMLElement)?.style.transform),
    );
    const onScene = await page.evaluate(
      () => (document.querySelector("[data-backdrop-veil]") as HTMLElement).style.opacity,
    );
    expect(Number(onScene)).toBeCloseTo(0.4, 5);

    const seen = await page.evaluate(async () => {
      const veil = document.querySelector("[data-backdrop-veil]") as HTMLElement;
      const values: number[] = [];
      const read = () => {
        const v = Number(veil.style.opacity);
        if (values[values.length - 1] !== v) values.push(v);
      };
      read();
      window.pullBack();
      const deadline = performance.now() + 3000;
      await new Promise<void>((resolve) => {
        const tick = () => {
          read();
          if (performance.now() >= deadline) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return values;
    });
    const trace = `veil: ${seen.join(", ")}`;
    expect(seen[0], trace).toBeCloseTo(0.4, 5);
    expect(seen[seen.length - 1], trace).toBe(0);
    // Never back up. The easing between the two is the unit test's claim:
    // a world of two scenes is small enough that the camera's rise can cross
    // the whole band inside a frame.
    expect(
      seen.every((v, i) => i === 0 || v <= seen[i - 1]),
      trace,
    ).toBe(true);
  });
});
