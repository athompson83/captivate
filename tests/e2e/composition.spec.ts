import { expect, test } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * Every layout and every theme, actually drawn.
 *
 * `tests/unit/layouts.test.ts` proves `composeScene` returns a valid
 * `SceneContent`. That is a different claim from "the scene is right on a
 * projector", and the gap between them is where three defects lived: a cover
 * that drew its title twice, a closing scene that discarded its bullets, and
 * body text composed at half the scale a room can read. Every one produced a
 * perfectly valid document, and every one was found by rendering the sheet
 * and looking at it.
 *
 * What is asserted here is the part a machine can judge: that every layout
 * and every theme draws something, without a console error, and that no text
 * is cut off by the box it sits in. The last is a real regression guard now:
 * a deck was presented with the last line of a bullet below the frame while
 * this passed, because it skipped every `overflow: visible` element — which a
 * `ul` is — and because the sheet's own bullets were phrases like "Cool
 * peripheries", content no fit can fail on. Both are fixed here, and between
 * them they caught two more overflows the arithmetic tests could not: the
 * per-glyph estimate is an average, and a heading in a narrow column wraps a
 * line further than an average predicts.
 *
 * Looking is still the point. The sheets are here to be rendered and read.
 *
 * No server and no account.
 */

const LAYOUTS = "tests/e2e/fixtures/layout-sheet-mount.tsx";
const THEMES = "tests/e2e/fixtures/theme-sheet-mount.tsx";

const urls = new Map<string, Promise<string>>();
const fixtureUrl = (entry: string) => {
  if (!urls.has(entry)) urls.set(entry, bundleFixture(entry));
  return urls.get(entry)!;
};

/**
 * Text that does not fit the box it was given.
 *
 * `fitTextSize` shrinks text to its element's frame, so an overflow means
 * either the estimate was wrong or the element was never fitted at all. A few
 * pixels of slack, because a descender legitimately paints past its line box.
 */
const OVERFLOWING = () =>
  [...document.querySelectorAll("[data-stage] *")]
    .filter((node) => {
      const el = node as HTMLElement;
      if (!el.childElementCount && !el.textContent?.trim()) return false;

      /*
       * Skipping every `overflow: visible` element is what let a list run off
       * the bottom of a scene unnoticed: a `ul` sets no overflow, so it is
       * `visible` by computed style and was never measured. The stage clips
       * further up, so the text was cut off on the projector while nothing
       * here reported a thing.
       *
       * A text box with a height of its own is measured whatever its overflow
       * is. What the skip is really for is the elements that paint outside
       * their box on purpose — a bare scene region on the world canvas — and
       * those are the ones with no fixed height to overflow.
       */
      const style = getComputedStyle(el);
      const fixedHeight = style.height !== "auto" && el.clientHeight > 0;
      if (style.overflow === "visible" && !fixedHeight) return false;

      return el.scrollHeight > el.clientHeight + 4 || el.scrollWidth > el.clientWidth + 4;
    })
    .map((node) => (node as HTMLElement).textContent?.slice(0, 60) ?? "");

test.describe("composition", () => {
  test("draws every layout, with nothing blank and nothing cut off", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text().slice(0, 160));
    });

    await page.goto(await fixtureUrl(LAYOUTS));
    await page.waitForSelector("body[data-ready=true]", { state: "attached" });

    // The fixture's own cells: a quote element renders a `figure` of its own,
    // and a bullets heading an `h2`, so the sheet labels its chrome.
    const figures = page.locator("[data-sheet-cell]");
    const count = await figures.count();
    expect(count).toBeGreaterThanOrEqual(15);

    // Every layout put something on the stage. A composer that returns no
    // elements renders a valid, empty scene.
    for (let i = 0; i < count; i += 1) {
      const name = (await figures.nth(i).locator("[data-sheet-label]").textContent()) ?? String(i);
      const painted = await figures.nth(i).locator("[data-stage] *").count();
      expect(painted, `${name} drew nothing`).toBeGreaterThan(0);
    }

    expect(await page.evaluate(OVERFLOWING)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("draws every theme without a console error", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text().slice(0, 160));
    });

    await page.goto(await fixtureUrl(THEMES));
    await page.waitForSelector("body[data-ready=true]", { state: "attached" });

    const sections = page.locator("[data-sheet-cell]");
    expect(await sections.count()).toBeGreaterThanOrEqual(12);
    for (let i = 0; i < (await sections.count()); i += 1) {
      const id = (await sections.nth(i).locator("[data-sheet-label]").textContent()) ?? String(i);
      expect(await sections.nth(i).locator("[data-stage]").count(), id).toBe(3);
    }

    expect(await page.evaluate(OVERFLOWING)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
