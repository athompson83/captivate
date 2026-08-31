import { expect, test } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * A real deck, read back into the author's words.
 *
 * `tests/unit/reference-ingest.test.ts` covers every extraction rule against
 * XML strings. This covers the half it cannot: that a file PowerPoint really
 * wrote — a zip whose parts are named and ordered the way the format names
 * them — comes back as the author's words in the author's order.
 *
 * It runs in a browser because that is where the reading happens: the file
 * never leaves the tab it was dropped into, which keeps document parsing off
 * the server entirely.
 */

const ENTRY = "tests/e2e/fixtures/reference-read-mount.tsx";

let pageUrl: Promise<string> | null = null;
const fixtureUrl = () => (pageUrl ??= bundleFixture(ENTRY));

test.describe("reading a reference deck", () => {
  test("recovers the words, in the order the deck put them", async ({ page }) => {
    await page.goto(await fixtureUrl());
    // Attached, not visible: the fixture renders nothing — it reads a file.
    await page.waitForSelector("body[data-ready=true]", { state: "attached" });

    const result = await page.evaluate(() => window.roundTrip());
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.name).toBe("Lecture 4.pptx");

    expect(result.text).toContain("Shock is a clinical diagnosis");
    expect(result.text).toContain("Perfusion, not pressure");

    // The ampersand came back as an ampersand, not as "&amp;".
    expect(result.text).toContain("Compensation & its limits");
    expect(result.text).not.toContain("&amp;");

    // Slide boundaries survive: they are the argument's own structure.
    expect(result.text).toContain("--- Slide 1 ---");
    expect(result.text).toContain("--- Slide 10 ---");

    // And slide 10 comes after slide 2, which sorting the zip's parts as
    // strings would get wrong — silently reordering the author's argument.
    expect(result.text.indexOf("--- Slide 2 ---")).toBeLessThan(
      result.text.indexOf("--- Slide 10 ---"),
    );
    expect(result.text.indexOf("Beat number 3")).toBeLessThan(
      result.text.indexOf("Beat number 10"),
    );
  });

  test("reads a plain text file as itself", async ({ page }) => {
    await page.goto(await fixtureUrl());
    await page.waitForSelector("body[data-ready=true]", { state: "attached" });
    const result = await page.evaluate(() =>
      window.readBytes("notes.md", "# Shock\n\nPerfusion, not pressure."),
    );
    expect(result.ok).toBe(true);
    expect(result.text).toContain("Perfusion, not pressure.");
  });

  test("refuses a file whose name lies about its format", async ({ page }) => {
    await page.goto(await fixtureUrl());
    await page.waitForSelector("body[data-ready=true]", { state: "attached" });

    // Named .pptx, but the bytes are not a zip. The name is the weaker of two
    // unreliable signals, so the reader checks the bytes before trusting it.
    const result = await page.evaluate(() => window.readBytes("trap.pptx", "not a zip at all"));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/isn't the format its name says/i);
  });
});
