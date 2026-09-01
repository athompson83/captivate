import { describe, expect, it } from "vitest";
import { composeScene, layoutSlots, type LayoutContent } from "@/lib/editor/layouts";
import type { SceneLayout } from "@/lib/schema/presentation";

/**
 * A composition must never lose every word it was given.
 *
 * A deck generated in production came back with ten of its twenty-one scenes
 * blank. The model had written them; `composeScene` had thrown them away. The
 * generator does not choose the layout — `layoutFor` does, from the moment's
 * visual intent — so the model can write a good statement into `body` and hand
 * it to a layout whose only slot is `heading`, and every field without a slot
 * is dropped in silence. The author sees "This scene is empty" over content
 * that was written for them.
 *
 * Losing *supporting* content is by design: a statement scene is one idea with
 * air around it. Losing all of it is not.
 */

const LAYOUTS: SceneLayout[] = [
  "title",
  "cover",
  "section",
  "statement",
  "bullets",
  "split-left",
  "split-right",
  "media-full",
  "quote",
  "two-column",
  "three-up",
  "chart",
  "code",
  "closing",
  "custom",
];

/** The shapes a model actually returns, none of which name every field. */
const WRITINGS: { name: string; content: LayoutContent }[] = [
  {
    name: "prose only",
    content: { body: "A worksheet waits silently when a student gets stuck." },
  },
  { name: "a list only", content: { bullets: ["Shorter sentences", "The same core question"] } },
  { name: "a heading only", content: { heading: "The problem isn't your teaching" } },
  {
    name: "a quotation only",
    content: { quote: "You know this kid — not acting out, just quietly gone." },
  },
  { name: "a subheading only", content: { subheading: "Buying back time for what matters" } },
  {
    name: "a list under a heading",
    content: { heading: "One lesson, every reading level", bullets: ["Below", "At", "Above"] },
  },
  {
    name: "cards only",
    content: { cards: [{ title: "Draft", body: "AI writes a rough first pass" }] },
  },
];

describe("no layout discards a scene's entire content", () => {
  for (const layout of LAYOUTS) {
    for (const { name, content } of WRITINGS) {
      it(`${layout} keeps ${name}`, () => {
        const composed = composeScene(layout, content);

        expect(
          composed.elements.length,
          `${layout} given ${name} composed to nothing`,
        ).toBeGreaterThan(0);
      });
    }
  }
});

describe("the fold puts words in the slots a layout has", () => {
  it("promotes prose into the heading of a layout that shows only a heading", () => {
    // `statement` has one slot. Before the fold this composed to zero
    // elements, which is what the author saw as an empty scene.
    expect(Object.keys(layoutSlots("statement"))).toEqual(["heading"]);

    const composed = composeScene("statement", {
      body: "A worksheet waits silently when a student gets stuck.",
    });

    expect(composed.layout).toBe("statement");
    expect(composed.elements).toHaveLength(1);
    expect(JSON.stringify(composed.elements[0])).toContain("A worksheet waits silently");
  });

  it("draws a three-up's cards from its bullets", () => {
    const composed = composeScene("three-up", {
      heading: "Three ways in",
      bullets: ["Draft it", "Differentiate it", "Mark it"],
    });

    const callouts = composed.elements.filter((element) => element.type === "callout");
    expect(callouts).toHaveLength(3);
    expect(JSON.stringify(callouts)).toContain("Differentiate it");
  });

  it("does not print the same line twice", () => {
    // The promoted line is cleared from its source only where the layout would
    // otherwise show it in two places at once.
    const composed = composeScene("section", { body: "Getting your prep time back" });
    const text = JSON.stringify(composed.elements);

    expect(text.split("Getting your prep time back").length - 1).toBe(1);
  });

  it("keeps a bullets scene's list when its first item became the heading", () => {
    const composed = composeScene("bullets", { bullets: ["First claim", "Second claim"] });
    const text = JSON.stringify(composed.elements);

    expect(text).toContain("First claim");
    expect(text).toContain("Second claim");
  });

  it("keeps prose handed to a chart, as that layout's heading", () => {
    // `chart` has no slot for prose, but it does have one for a heading, so
    // the fold saves the scene without the last resort being reached.
    const composed = composeScene("chart", {
      body: "Forty per cent of a teacher's week is preparation.",
    });

    expect(composed.layout).toBe("chart");
    expect(JSON.stringify(composed.elements)).toContain("Forty per cent");
  });

  it("becomes the layout it fell back to rather than lying about its geometry", () => {
    // Code is drawn by one layout. Handed to any other it has no slot and no
    // sensible promotion — a function body is not a heading — so the last
    // resort re-composes, and the scene really becomes a code scene.
    const composed = composeScene("statement", {
      code: { code: "const hours = week * 0.4;", language: "ts" },
    });

    expect(composed.layout).toBe("code");
    expect(JSON.stringify(composed.elements)).toContain("const hours");
  });

  it("keeps an attribution that has nowhere else to go", () => {
    // Not a scene anyone would write on purpose, but the rule is that words
    // handed to a composition come out of it.
    const composed = composeScene("statement", { attribution: "— A teacher, year 9" });

    expect(JSON.stringify(composed.elements)).toContain("A teacher, year 9");
  });

  it("draws the scene's title when the model wrote the line only there", () => {
    // The shape nine of ten blank scenes in production actually had: a
    // `statement` layout, a title that *is* the statement, and no heading.
    // `title` labels the scene in the navigator and is drawn by no slot, so
    // the canvas was empty while the navigator read perfectly — which is why
    // the deck looked half-written rather than broken.
    const composed = composeScene("statement", {
      title: "Feedback two weeks late helps no one",
    });

    expect(composed.elements).toHaveLength(1);
    expect(JSON.stringify(composed.elements[0])).toContain("Feedback two weeks late");
  });

  it("prefers the heading the model wrote for the room", () => {
    // A title and a heading are usually different lengths for good reason.
    // The title is only ever the fallback.
    const composed = composeScene("statement", {
      title: "Feedback latency",
      heading: "Feedback two weeks late helps no one",
    });

    const text = JSON.stringify(composed.elements);
    expect(text).toContain("Feedback two weeks late");
    expect(text).not.toContain("Feedback latency");
  });

  it("keeps a title that has a heading and a body to sit behind", () => {
    // On a layout with room for both, the title stays out of the way entirely
    // rather than turning up as a third line nobody wrote.
    const composed = composeScene("bullets", {
      title: "Differentiation",
      heading: "One lesson, every reading level",
      bullets: ["Below grade level", "At grade level"],
    });

    expect(JSON.stringify(composed.elements)).not.toContain("Differentiation");
  });

  it("still composes nothing when there was nothing to compose", () => {
    // An author who has genuinely written nothing must still see the empty
    // state, not a scene invented on their behalf.
    expect(composeScene("statement", {}).elements).toHaveLength(0);
    expect(composeScene("bullets", { bullets: [] }).elements).toHaveLength(0);
  });
});
