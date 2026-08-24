import { expect, test, type Page } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * What the exported file actually is.
 *
 * "The video file that exported is low definition." The two causes are both
 * invisible from the source — a capture resampled below the display, and an
 * encoder handed too small a budget or too weak a profile for hard-edged text
 * — and both only show up in the file. So this encodes one at 1440p and reads
 * it back through a decoder.
 */

const ENTRY = "tests/e2e/fixtures/recording-quality-mount.ts";

let pageUrl: Promise<string> | null = null;
function fixtureUrl(): Promise<string> {
  pageUrl ??= bundleFixture(ENTRY);
  return pageUrl;
}

async function open(page: Page) {
  await page.goto(await fixtureUrl());
  await page.waitForFunction(() => typeof window.encode === "function");
}

test.describe("the recorded file", () => {
  test("never chooses Baseline H.264 while a High profile is available", async ({ page }) => {
    await open(page);
    // `avc1.42E01E` is Baseline level 3.0 — no CABAC, no B-frames — and it
    // used to be the *first* candidate, so any Chrome with H.264 took it.
    const chosen = await page.evaluate(() => {
      const support = window.codecSupport();
      return { support, chosen: window.chosenMimeType() };
    });
    expect(chosen.chosen).not.toBeNull();
    const high = Object.entries(chosen.support).some(
      ([type, ok]) => ok && type.includes("avc1.6400"),
    );
    if (high) expect(chosen.chosen).toContain("avc1.6400");
    else expect(chosen.chosen).not.toContain("avc1.42E01E");
  });

  test("scales the budget with the pixels being encoded", async ({ page }) => {
    await open(page);
    const rates = await page.evaluate(() => ({
      p1080: window.bitrateFor(1920, 1080, 30),
      p1440: window.bitrateFor(2560, 1440, 30),
      p2160: window.bitrateFor(3840, 2160, 30),
      tiny: window.bitrateFor(320, 240, 30),
      huge: window.bitrateFor(7680, 4320, 60),
    }));
    // The flat 4 Mbit/s this replaced was under a tenth of a bit per pixel at
    // 1440p, which is why a sharp presentation came back soft.
    expect(rates.p1080).toBeGreaterThan(8_000_000);
    expect(rates.p1440).toBeGreaterThan(rates.p1080);
    expect(rates.p2160).toBeGreaterThan(rates.p1440);
    expect(rates.tiny).toBe(6_000_000); // floor: a small capture is not starved
    expect(rates.huge).toBe(40_000_000); // ceiling: nobody can upload more
  });

  test("encodes 1440p at 1440p and decodes back at the same size", async ({ page }) => {
    test.setTimeout(90_000);
    await open(page);
    const result = await page.evaluate(() => window.encode(2560, 1440, 30, 2500));
    // The whole complaint in one assertion: what went in is what came out.
    expect(result.decodedWidth).toBe(2560);
    expect(result.decodedHeight).toBe(1440);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.requestedBitrate).toBeGreaterThan(15_000_000);
    console.log("1440p encode:", JSON.stringify(result));
  });

  test("encodes 1080p at 1080p", async ({ page }) => {
    test.setTimeout(90_000);
    await open(page);
    const result = await page.evaluate(() => window.encode(1920, 1080, 30, 2000));
    expect(result.decodedWidth).toBe(1920);
    expect(result.decodedHeight).toBe(1080);
    console.log("1080p encode:", JSON.stringify(result));
  });
});
