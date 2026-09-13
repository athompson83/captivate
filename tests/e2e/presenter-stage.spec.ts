import { expect, test, type Page } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * The presenter's own surface, in a real browser at a real size.
 *
 * `/present/[id]` is behind sign-in and a Supabase project, so the bar, the
 * signpost and the rail had only ever been rendered in jsdom, where nothing
 * has a width. Mounted alone (`fixtures/presenter-mount.tsx`) they can be
 * measured: what a phone's window holds, and what stands in front of what.
 */

const ENTRY = "tests/e2e/fixtures/presenter-mount.tsx";

let bundled: Promise<string> | null = null;
const fixtureUrl = () => (bundled ??= bundleFixture(ENTRY));

async function open(page: Page, width: number, height: number): Promise<string[]> {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  await page.setViewportSize({ width, height });
  await page.goto(await fixtureUrl());
  // Without the WebGL air (`?plain=1`, a real presenter option): under the
  // software renderer CI has, the air made every round trip to the page a
  // second long, and the bar's 2.6 s ran out between two steps of a test.
  // Nothing measured here is the air's.
  await page.evaluate(() => window.presenterFixture.mount({ plain: true }));
  await page.getByRole("heading", { name: "Hold the room" }).first().waitFor();
  return problems;
}

/**
 * The bar shows on pointer movement and goes 2.6 s after the last. It is
 * also up from the moment the stage mounts, on the same clock, so a test
 * that wants its own 2.6 s waits for that first showing to end and then
 * summons it: otherwise the bar it measured could be one about to go.
 */
async function showBar(page: Page, width: number, height: number) {
  const bar = page.getByRole("toolbar", { name: "Presenter controls" });
  await expect(bar).toBeHidden({ timeout: 8_000 });
  await page.mouse.move(width / 2, height / 2);
  await page.mouse.move(width / 2 + 40, height / 2 + 10);
  await expect(bar).toBeVisible();
  return bar;
}

test.describe("the presenter stage", () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await fixtureUrl();
  });

  test("the bar stays inside a phone's window", async ({ page }) => {
    const problems = await open(page, 390, 844);
    const bar = await showBar(page, 390, 844);

    // One row was 560px wide and centred, so at 390px the counter and the
    // arrows were lost off the left and the exit off the right — the jumper
    // could not be tapped at all. The bar wraps inside the window instead.
    const lost = await bar.evaluate((el) =>
      [...el.querySelectorAll<HTMLElement>("button, a")]
        .map((node) => ({ node, box: node.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && (box.left < -1 || box.right > window.innerWidth + 1))
        .map(
          ({ node, box }) =>
            `${node.getAttribute("aria-label")} [${Math.round(box.left)}, ${Math.round(box.right)}]`,
        ),
    );
    expect(lost, "controls outside a 390px window").toEqual([]);
    await expect(page.getByRole("button", { name: "Jump to a scene" })).toBeInViewport({
      ratio: 1,
    });
    await expect(page.getByRole("link", { name: "Exit presentation" })).toBeInViewport({
      ratio: 1,
    });
    expect(problems).toEqual([]);
  });

  test("the next-movement signpost lifts clear of the bar", async ({ page }) => {
    await open(page, 1440, 900);
    // The signpost stands on a movement's last scene. Walk forward to the
    // first one, since an advance is sometimes a build step or an
    // establishing shot rather than a scene.
    const signpost = page.locator("[data-signpost=next]");
    for (let i = 0; i < 8 && (await signpost.count()) === 0; i++) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(700);
    }
    await expect(signpost).toHaveCount(1);

    const bar = await showBar(page, 1440, 900);
    // The bar rises over 200ms and the signpost moves over another 200ms
    // once the bar has said its height; both are done well inside the 2.6 s
    // the bar stays for.
    await page.waitForTimeout(600);
    const s = await signpost.boundingBox();
    const b = await bar.boundingBox();
    expect(s, "the signpost's box").not.toBeNull();
    expect(b, "the bar's box").not.toBeNull();
    expect(
      b!.y - (s!.y + s!.height),
      "the signpost's bottom against the bar's top",
    ).toBeGreaterThanOrEqual(0);

    // And settles back once the bar has gone: it stood behind the bar
    // before, and lifting it for good would put it in the picture.
    await expect(bar).toBeHidden({ timeout: 6_000 });
    await expect
      .poll(async () => (await signpost.boundingBox())?.y ?? 0)
      .toBeGreaterThan(s!.y + 30);
  });

  test("the audience window has no bar to lose", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(await fixtureUrl());
    await page.evaluate(() => window.presenterFixture.mount({ audienceOnly: true }));
    await page.getByRole("heading", { name: "Hold the room" }).first().waitFor();
    await page.mouse.move(500, 400);
    await page.mouse.move(540, 420);
    await expect(page.getByRole("toolbar", { name: "Presenter controls" })).toHaveCount(0);
  });
});
