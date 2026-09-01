import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeScene, layoutSlots } from "@/lib/editor/layouts";
import { fitListSize, listHeightAt, textMetrics } from "@/lib/present/fit-text";
import { stageRem, stageSize } from "@/lib/present/stage";
import { THEMES } from "@/lib/schema/theme";

/**
 * A list must fit the box it was given.
 *
 * A twenty-minute deck was presented with the last line of a bullet cut off by
 * the bottom of the scene, on more than one slide. The auto-fit was running;
 * it was simply wrong about lists. It budgeted `items + items / 2` lines for
 * the whole list, so three bullets of a sentence each were allowed four lines
 * when they wrap to eight, and it spent nothing at all on the bullet glyph,
 * the space after it, or the gaps between items.
 *
 * The numbers below are the real ones: the `two-column` body slot on a 1600px
 * stage, the size `composeScene` gives a list, and three bullets from the deck
 * that was being presented when this was reported.
 */

const STAGE = stageSize("16:9");
const REM = stageRem(STAGE.width);
const SCALE = THEMES[0].scale;

/** The bullets from the scene that was cut off, verbatim. */
const REPORTED = [
  "It starts from the tool, not the problem.",
  "It treats AI as a feature to bolt on somewhere convenient.",
  "It ends in a chatbot, a summary button, or an AI-powered badge.",
];

function listIn(layout: "bullets" | "two-column", items: string[]) {
  const scene = composeScene(layout, { heading: "A heading", bullets: items });
  const list = scene.elements.find((element) => element.type === "list");
  if (!list || list.type !== "list") throw new Error(`${layout} composed no list`);
  return list;
}

function boxOf(frame: { w: number; h: number }) {
  return { width: (frame.w / 100) * STAGE.width, height: (frame.h / 100) * STAGE.height };
}

describe("a list fits the box it was given", () => {
  it("uses the real slot geometry, not a guess at it", () => {
    // If the layout's body slot stops existing the assertions below would be
    // measuring nothing, so the shape is asserted before it is used.
    const body = layoutSlots("two-column").body;
    expect(body, "two-column has a body slot").toBeTruthy();
    expect(body!.w).toBeGreaterThan(0);
    expect(body!.h).toBeGreaterThan(0);
  });

  for (const layout of ["bullets", "two-column"] as const) {
    it(`keeps the reported bullets inside the ${layout} body slot`, () => {
      const list = listIn(layout, REPORTED);
      const box = boxOf(list.frame);
      const desired = SCALE.h2 * REM * list.style.size;

      const options = {
        items: REPORTED.map((item) => textMetrics(item)),
        boxWidth: box.width,
        boxHeight: box.height,
        desiredSize: desired,
        lineHeight: list.style.lineHeight,
        family: "sans" as const,
        ordered: list.ordered,
      };

      const fitted = fitListSize(options);

      // The claim, stated as height rather than as a font size: whatever the
      // fit returns, laying the list out at that size stays inside the box.
      expect(
        listHeightAt(fitted, options),
        `${layout}: laid out taller than its ${box.height.toFixed(0)}px box`,
      ).toBeLessThanOrEqual(box.height);
    });
  }

  it("shows the two-column case really did overflow before the fix", () => {
    // The old estimate, reproduced here so the regression is a number and not
    // a memory: four lines budgeted, eight needed, 656px asked of a 558px box.
    const list = listIn("two-column", REPORTED);
    const box = boxOf(list.frame);
    const desired = SCALE.h2 * REM * list.style.size;
    const options = {
      items: REPORTED.map((item) => textMetrics(item)),
      boxWidth: box.width,
      boxHeight: box.height,
      desiredSize: desired,
      lineHeight: list.style.lineHeight,
      family: "sans" as const,
      ordered: false,
    };

    expect(listHeightAt(desired, options)).toBeGreaterThan(box.height);
    expect(fitListSize(options)).toBeLessThan(desired);
  });

  it("does not shrink a list that already fits", () => {
    const list = listIn("bullets", ["One", "Two", "Three"]);
    const box = boxOf(list.frame);
    const desired = SCALE.h2 * REM * list.style.size;

    expect(
      fitListSize({
        items: ["One", "Two", "Three"].map((item) => textMetrics(item)),
        boxWidth: box.width,
        boxHeight: box.height,
        desiredSize: desired,
        lineHeight: list.style.lineHeight,
        family: "sans",
      }),
    ).toBe(desired);
  });

  it("counts an item that wraps as the lines it wraps to", () => {
    // The specific arithmetic error: one long item is not one line.
    const single = [{ characters: 400, longestWord: 9 }];
    const options = {
      items: single,
      boxWidth: 600,
      boxHeight: 1000,
      desiredSize: 50,
      lineHeight: 1.5,
      family: "sans" as const,
    };
    // 400 characters at 50px in a 600px column is far more than one line.
    expect(listHeightAt(50, options)).toBeGreaterThan(50 * 1.5 * 5);
  });

  it("is what the renderer actually calls, and spends what it budgeted", () => {
    // Everything above exercises the fit directly. Reverting the renderer to
    // the old estimate would leave all of it passing and put the cut-off text
    // straight back, so the wiring is asserted from the source.
    const source = readFileSync("src/components/stage/element-view.tsx", "utf8");

    expect(source, "the list case no longer calls fitListSize").toContain("fitListSize({");
    expect(source, "the discarded per-list line estimate is back").not.toContain("estimatedLines");

    // The fit budgets the marker and the gaps; the render must spend exactly
    // those, or the fit is confidently wrong again. Hard-coded multiples of
    // `base` in the list markup are how they drift apart.
    for (const name of [
      "LIST_ITEM_GAP_EMS",
      "LIST_MARKER_GAP_EMS",
      "LIST_MARKER_WIDTH_EMS",
      "LIST_ORDERED_MARKER_WIDTH_EMS",
    ]) {
      expect(source, `${name} is imported but not used in the list markup`).toContain(
        `base * ${name}`,
      );
    }
  });

  it("never shrinks past the readable floor", () => {
    const tooMuch = Array.from({ length: 12 }, () => textMetrics("A".repeat(200)));
    const fitted = fitListSize({
      items: tooMuch,
      boxWidth: 400,
      boxHeight: 200,
      desiredSize: 50,
      lineHeight: 1.5,
      family: "sans",
    });
    // Past this the honest answer is that there is too much text on the scene.
    expect(fitted).toBeCloseTo(50 * 0.45, 5);
  });
});
