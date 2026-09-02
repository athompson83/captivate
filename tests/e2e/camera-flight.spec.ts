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
});
