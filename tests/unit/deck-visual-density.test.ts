import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutFor } from "@/lib/narrative/generate";
import { composeScene } from "@/lib/editor/layouts";
import { drawableScenes, drawingCap, imagePromptFor } from "@/lib/editor/place-drawing";
import type { NarrativeRole, VisualIntent } from "@/lib/schema/narrative";

/**
 * A generated deck has to open on something, and carry pictures through.
 *
 * Reported from a real twenty-minute talk: no title slide, and one drawing in
 * sixteen scenes. Both come from `layoutFor`, and neither is a model problem.
 *
 * - the cover rule required an `auto` or `imagery` intent. A hook written as
 *   one sentence carries `statement`, so the commonest opening there is fell
 *   through to a bare centred line;
 * - `claim`, `reframe` and `synthesis` — the spine of any argument, and most
 *   of a deck's scenes — all returned `statement`, which has no media slot.
 *   `drawableScenes` can only draw on a scene that has one, so the drawing
 *   budget went unspent no matter how long the talk was.
 */

const opener = (intent: VisualIntent, role: NarrativeRole = "hook") => layoutFor(intent, role, 0);

describe("a deck opens on a cover", () => {
  it("covers a hook whatever way the moment states its intent", () => {
    // `statement` is the case that was broken and is the common one.
    for (const intent of ["auto", "imagery", "statement", "enumeration"] as VisualIntent[]) {
      expect(opener(intent), `a hook with a ${intent} intent`).toBe("cover");
    }
  });

  it("covers a provocation and a question too", () => {
    for (const role of ["provocation", "question"] as NarrativeRole[]) {
      expect(opener("statement", role)).toBe("cover");
    }
  });

  it("still yields to an intent that names specific content", () => {
    // A chart or a pull quote is a thing the author asked for. "Say one line"
    // is not, and a line over a photograph is the same line.
    expect(opener("data")).toBe("chart");
    expect(opener("quotation")).toBe("quote");
    expect(opener("comparison")).toBe("two-column");
    expect(opener("sequence")).toBe("three-up");
  });

  it("does not turn every later hook into a cover", () => {
    // Only the deck's first scene opens it.
    expect(layoutFor("statement", "hook", 3)).not.toBe("cover");
  });
});

describe("a talk long enough for several drawings has somewhere to put them", () => {
  /** A deck's worth of moments, shaped like the one that was reported. */
  const SPINE: NarrativeRole[] = [
    "hook",
    "claim",
    "reframe",
    "claim",
    "evidence",
    "synthesis",
    "claim",
    "reframe",
    "application",
    "synthesis",
    "claim",
    "close",
  ];

  /**
   * Built the way the generator builds one: the layout comes from the moment,
   * the image prompt from `imagePromptFor`, and the placeholder exists only
   * where that prompt is non-empty — which is exactly the chain that was
   * broken. Composing with a media placeholder unconditionally would make this
   * pass against the defect.
   */
  function deck(modelWrotePrompts = false) {
    return SPINE.map((role, index) => {
      const layout = layoutFor("auto", role, index);
      const heading = `Moment ${index}`;
      const imagePrompt = imagePromptFor({
        imagePrompt: modelWrotePrompts ? `a drawing for moment ${index}` : "",
        layout,
        heading,
      });
      return {
        content: composeScene(layout, {
          heading,
          body: "A line that carries the argument forward.",
          media: imagePrompt ? { url: "", alt: imagePrompt } : undefined,
        }),
        imagePrompt,
      };
    });
  }

  it("spends the drawing budget a twenty-minute talk earns", () => {
    const twentyMinutes = 20 * 60;
    const cap = drawingCap(twentyMinutes, true);
    expect(cap, "a twenty-minute talk should earn several drawings").toBeGreaterThanOrEqual(4);

    const drawable = drawableScenes(deck(), cap);

    // The reported deck got one. The budget is only real if enough scenes have
    // a slot to draw into.
    expect(
      drawable.length,
      `only ${drawable.length} of ${cap} drawings had a scene to land on`,
    ).toBe(cap);
  });

  it("does not make the whole deck side-by-side", () => {
    // A deck of nothing but split scenes is as monotonous as a deck of nothing
    // but centred lines.
    const layouts = SPINE.map((role, index) => layoutFor("auto", role, index));
    const split = layouts.filter((l) => l === "split-left" || l === "split-right").length;

    expect(split).toBeGreaterThan(0);
    expect(split).toBeLessThan(layouts.length / 2);
  });

  it("asks for a picture only where the layout has somewhere to put one", () => {
    // The slot is what decides, not the model. A statement scene gets no
    // prompt, so no phantom placeholder is created and the drawing budget is
    // not spent on a scene that cannot show it.
    expect(
      imagePromptFor({ imagePrompt: "", layout: "split-right", heading: "A claim" }),
    ).toContain("A claim");
    expect(imagePromptFor({ imagePrompt: "", layout: "statement", heading: "A claim" })).toBe("");
    expect(imagePromptFor({ imagePrompt: "", layout: "bullets", heading: "A claim" })).toBe("");
  });

  it("prefers the prompt the model wrote", () => {
    expect(
      imagePromptFor({ imagePrompt: "a lighthouse at dusk", layout: "split-right", heading: "A" }),
    ).toBe("a lighthouse at dusk");
  });

  it("has nothing to illustrate when the scene says nothing", () => {
    expect(imagePromptFor({ imagePrompt: "", layout: "split-right" })).toBe("");
  });

  it("is what the generator actually calls", () => {
    // Reverting `materialise` to `scene.imagePrompt` would leave every
    // assertion above passing and put the empty half-scenes straight back.
    const source = readFileSync("src/lib/ai/service.ts", "utf8");
    expect(source, "materialise no longer derives the prompt").toContain("imagePromptFor(scene)");
    expect(source, "the placeholder is conditional on the model again").not.toContain(
      "scene.imagePrompt ? { url:",
    );
  });

  it("leaves enumerations where they are", () => {
    // The split body slot is 38x34 against `bullets`' 72x62 — an enumeration
    // moved there would be crushed, which is the reason the promotion is
    // limited to the single-line roles.
    expect(layoutFor("enumeration", "claim", 1)).toBe("bullets");
  });
});
