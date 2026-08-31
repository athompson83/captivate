import { expect, test } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * The exported deck, built in a real browser and opened as a real file.
 *
 * `tests/unit/deck-export.test.ts` covers every decision the translation
 * makes. What it cannot cover is whether the file those decisions produce is
 * one PowerPoint and Keynote will open: a zip missing `ppt/presentation.xml`
 * is a corrupt deck, and a plan test passes happily either way.
 *
 * It also has to run in a browser rather than Node, because that is where the
 * export runs — pptxgenjs maps its Node-only `image-size` dependency to
 * `false` for the browser, and building the file client-side is what keeps
 * that package's two unfixed advisories out of the bundle entirely.
 *
 * No server and no account.
 */

const ENTRY = "tests/e2e/fixtures/deck-export-mount.tsx";

let pageUrl: Promise<string> | null = null;
const fixtureUrl = () => (pageUrl ??= bundleFixture(ENTRY));

test.describe("exporting a deck", () => {
  test("produces a file whose parts PowerPoint can find", async ({ page }) => {
    await page.goto(await fixtureUrl());
    // Attached, not visible: the fixture renders nothing — it exports a file.
    await page.waitForSelector("body[data-ready=true]", { state: "attached" });

    const result = await page.evaluate(() => window.exportDeck());
    const file = Buffer.from(result.bytes);

    // A zip, by its local file header. Anything else and the download is a
    // file the operating system cannot name.
    expect(file.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(file.byteLength).toBeGreaterThan(5_000);
    expect(result.name).toBe("Shock.pptx");

    // The central directory holds every part's name in plain text, so the
    // parts can be checked without unzipping.
    const listing = file.toString("latin1");
    expect(listing).toContain("ppt/presentation.xml");
    expect(listing).toContain("[Content_Types].xml");
    expect(listing).toContain("ppt/slides/slide1.xml");
    expect(listing).toContain("ppt/slides/slide2.xml");

    // Two scenes in, two slides out: the aside follows the scene that dives
    // into it rather than being dropped.
    expect(result.slides).toBe(2);
    expect(listing).not.toContain("ppt/slides/slide3.xml");

    // The speaker notes travelled with the slide.
    expect(listing).toContain("notesSlide");

    // The chart is data rather than a picture of data, which is most of the
    // reason somebody asked for PowerPoint.
    expect(listing).toContain("ppt/charts/");

    // The drawing was rasterised, so it renders in Keynote too.
    expect(listing).toMatch(/ppt\/media\/image[\d-]+\.png/);
  });
});
