import { expect, test } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * A picture that lives, in a real browser.
 *
 * jsdom can say what style a photograph was given; only a browser can say
 * whether it moves. The world is mounted with real photographs (the
 * picture-weight fixture, which already has them) and the camera lands on
 * the first: its picture's computed transform leaves the identity and keeps
 * going; the next scene's, not yet landed on, stays put; and under a
 * reduced-motion preference nothing moves at all.
 */

const FIXTURE = "tests/e2e/fixtures/picture-weight-mount.tsx";

let url: Promise<string> | null = null;
const fixtureUrl = () => (url ??= bundleFixture(FIXTURE));

/** The x scale of a picture's computed transform: 1 at the identity. */
async function scaleOf(page: import("@playwright/test").Page, alt: string) {
  return page.evaluate((alt) => {
    const img = document.querySelector<HTMLImageElement>(`img[alt="${alt}"]`);
    if (!img) return null;
    const transform = getComputedStyle(img).transform;
    if (transform === "none") return 1;
    const match = /^matrix\(([^,]+),/.exec(transform);
    return match ? Number(match[1]) : null;
  }, alt);
}

test.describe("a picture that lives", () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await fixtureUrl();
  });

  test("the landed picture drifts, the next stays put, and it comes back on leaving", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(await fixtureUrl());
    await page.evaluate(() => window.pictureWeight.mount(3));
    await page.waitForSelector('img[alt="Photograph 1"][data-living]');

    // Slow enough never to be seen moving, and yet moving: past the identity
    // within a couple of seconds and further on after a couple more.
    await expect
      .poll(() => scaleOf(page, "Photograph 1"), { timeout: 10_000 })
      .toBeGreaterThan(1.001);
    const early = (await scaleOf(page, "Photograph 1"))!;
    await page.waitForTimeout(1_500);
    const later = (await scaleOf(page, "Photograph 1"))!;
    expect(later).toBeGreaterThan(early);
    expect(later).toBeLessThan(1.06);

    // The scene beside it is not being performed and does not move.
    expect(await scaleOf(page, "Photograph 2")).toBe(1);

    // Leaving: the first comes back to the identity over the flight away,
    // the second sets off.
    await page.evaluate(() => window.goToScene(1));
    await expect.poll(() => scaleOf(page, "Photograph 1"), { timeout: 10_000 }).toBe(1);
    await expect
      .poll(() => scaleOf(page, "Photograph 2"), { timeout: 10_000 })
      .toBeGreaterThan(1.001);
  });

  test("under a reduced-motion preference the picture is simply still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(await fixtureUrl());
    await page.evaluate(() => window.pictureWeight.mount(2));
    await page.waitForSelector('img[alt="Photograph 1"]');
    await page.waitForTimeout(2_000);
    expect(await scaleOf(page, "Photograph 1")).toBe(1);
    expect(await page.locator("[data-living]").count()).toBe(0);
  });
});
