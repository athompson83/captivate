import { expect, test } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * The decoded weight of a deck's photographs, on a phone.
 *
 * See `fixtures/picture-weight-mount.tsx` for why this exists. The short
 * version: a browser dying mid-presentation has been reported five times from
 * a phone, the WebGL field measured 1.3 MB and cannot explain it, and a
 * decoded photograph costs width x height x 4 bytes however small its file is.
 *
 * This asserts the contract the world is supposed to keep — that culling holds
 * the number of live photographs to the handful actually near the camera,
 * whatever the deck's length — and it prints the numbers, because the numbers
 * are the point.
 */

const FIXTURE = "tests/e2e/fixtures/picture-weight-mount.tsx";

let url: Promise<string> | null = null;
const fixtureUrl = () => (url ??= bundleFixture(FIXTURE));

test.describe("what a phone holds while presenting", () => {
  test("culling holds the live photographs to a handful, however long the deck", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(await fixtureUrl());

    const readings: Record<number, { images: number; imageBytes: number; at: number }> = {};
    for (const count of [4, 12, 24]) {
      await page.reload();
      await page.evaluate((n) => window.pictureWeight.mount(n), count);
      await page.waitForSelector("[data-stage] img");
      const worst = await page.evaluate((n) => window.pictureWeight.walk(n), count);
      readings[count] = { images: worst.images, imageBytes: worst.imageBytes, at: worst.at };
      console.log(
        `${count} scenes: worst ${worst.images} live photographs, ` +
          `${(worst.imageBytes / 1e6).toFixed(1)} MB decoded, ` +
          `${worst.stages} stages, ${(worst.canvasBytes / 1e6).toFixed(1)} MB of canvas`,
      );
    }

    // The claim: a deck six times longer does not hold six times the pictures.
    // Without culling this is linear and a long deck is a memory bomb.
    expect(readings[24].images).toBeLessThanOrEqual(readings[4].images * 2);
    expect(readings[24].imageBytes).toBeLessThan(readings[4].imageBytes * 2);
  });
});
