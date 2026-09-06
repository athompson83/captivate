import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutFor } from "@/lib/narrative/generate";
import { composeDeck } from "@/lib/narrative/compose";
import { composeScene, layoutSlots } from "@/lib/editor/layouts";
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
    const composed = composeDeck(SPINE.map((role) => ({ role, visualIntent: "auto" as const })));
    return SPINE.map((role, index) => {
      const layout = composed[index];
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
    const layouts = composeDeck(SPINE.map((role) => ({ role, visualIntent: "auto" as const })));
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

/**
 * The intent the model actually sends.
 *
 * The suite above proves the spine carries pictures when the moment's intent
 * is `auto`, and every one of its cases passed while real decks came back with
 * one picture in fourteen scenes. Read out of production: of 315 moments
 * generated over ten days, `statement` was chosen 140 times and `auto` once.
 * So `auto` is the one input the generator almost never sees, and a suite that
 * only ever passes it is a suite that cannot fail.
 *
 * These cases pass `statement` — the model's default, and its commonest answer
 * — and they fail against the defect.
 */
describe("the spine carries pictures on the intent the model really sends", () => {
  const DECK: NarrativeRole[] = [
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

  const layouts = (intent: VisualIntent) =>
    composeDeck(DECK.map((role) => ({ role, visualIntent: intent })));
  const withMedia = (list: ReturnType<typeof layouts>) =>
    list.filter((layout) => Boolean(layoutSlots(layout).media));

  it("gives a statement-intent deck somewhere to put several pictures", () => {
    const slots = withMedia(layouts("statement"));
    // The reported deck had one picture in fourteen scenes. A deck this long
    // earns at least three drawings before a photograph is even considered.
    expect(
      slots.length,
      `only ${slots.length} of ${DECK.length} scenes had a slot for a picture`,
    ).toBeGreaterThanOrEqual(3);
  });

  it("spends the drawing budget on a statement-intent deck", () => {
    const cap = drawingCap(20 * 60, true);
    const composed = layouts("statement");
    const scenes = DECK.map((role, index) => {
      const layout = composed[index];
      const heading = `Moment ${index}`;
      const imagePrompt = imagePromptFor({ imagePrompt: "", layout, heading });
      return {
        content: composeScene(layout, {
          heading,
          media: imagePrompt ? { url: "", alt: imagePrompt } : undefined,
        }),
        imagePrompt,
      };
    });
    expect(drawableScenes(scenes, cap).length).toBe(cap);
  });

  it("still leaves a statement-intent deck plenty of air", () => {
    // A deck of nothing but side-by-side scenes is the other failure, so the
    // spine alternates: every other claim keeps its centred line, and half the
    // deck is still a single sentence with air around it.
    const list = layouts("statement");
    const split = list.filter((l) => l === "split-left" || l === "split-right");
    expect(split.length).toBeGreaterThan(0);
    expect(split.length).toBeLessThan(list.length / 2);
    // Measured as *quiet screens* rather than as the `statement` layout. Air
    // is a scene carrying one idea with space around it, and a take-home, a
    // single number and a pull quote are all that; before the composer could
    // reach them, `statement` was the only one it had, so counting the layout
    // and counting the property were the same number. They are not any more,
    // and the property is the one worth protecting.
    const QUIET = ["statement", "section", "quote", "takeaway", "figure", "closing"];
    expect(list.filter((layout) => QUIET.includes(layout)).length).toBeGreaterThanOrEqual(
      list.length / 3,
    );
  });

  it("still yields to an intent that names specific content", () => {
    // Only `statement` is weak. A claim the author marked as a comparison is
    // a comparison, and a one-line intent never turns evidence into a chart
    // it has no numbers for.
    expect(layoutFor("comparison", "claim", 1)).toBe("two-column");
    expect(layoutFor("data", "claim", 1)).toBe("chart");
    expect(layoutFor("quotation", "claim", 1)).toBe("quote");
    expect(layoutFor("enumeration", "claim", 1)).toBe("bullets");
  });

  it("no longer silences the roles whose own answer is richer than a line", () => {
    // This test used to assert the opposite, and asserting it is what kept the
    // defect alive through two releases: every role but the spine was pinned
    // to `statement` because the *model* had said `statement`, and production
    // shows the model says that 44% of the time with nothing behind it. Four
    // of this engine's compositions had therefore never reached an audience.
    const answers = new Map<NarrativeRole, string>([
      ["evidence", "figure"],
      ["context", "explainer"],
      ["contrast", "two-column"],
      ["application", "action"],
      ["close", "action"],
    ]);
    for (const [role, expected] of answers) {
      // Second in a short deck, so no rhythm rule has anything to push against.
      const composed = composeDeck([
        { role: "claim", visualIntent: "statement" },
        { role, visualIntent: "statement" },
      ]);
      expect(composed[1], role).toBe(expected);
    }
  });

  it("still honours an author who asked for one line", () => {
    // Provenance, not vocabulary: the same word means one thing from a model
    // and another from the person giving the talk.
    expect(
      composeDeck([{ role: "close", visualIntent: "statement", intentAuthored: true }])[0],
    ).toBe("statement");
  });
});
