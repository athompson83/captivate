import { describe, expect, it } from "vitest";
import { composeDeck, layoutChoices, type Beat } from "@/lib/narrative/compose";
import { layoutSlots } from "@/lib/editor/layouts";
import type { NarrativeRole, VisualIntent } from "@/lib/schema/narrative";

/**
 * Composition is a deck-level decision, not a per-moment one.
 *
 * Every number in this file is read from production rather than imagined. Of
 * 343 moments generated over two weeks the model chose `statement` 152 times
 * and `auto` **once**; of 351 stored scenes, 143 are the bare `statement`
 * layout and the counts for `takeaway`, `action`, `figure`, `explainer` and
 * `quote` are all zero. Four compositions the engine ships had never once
 * reached an audience.
 *
 * Both halves of that are the same bug. `statement` is what the model says
 * when it has no opinion, and it was being read as an instruction that vetoed
 * the role's own answer — so `application` never became a call to action and
 * `evidence` never became a number. And the movement-ending take-home rule
 * required `auto`, an intent that has appeared once in the product's life.
 *
 * So these tests drive the composer with the distribution production actually
 * produces, not with the one that would make it look good.
 */

const beat = (role: NarrativeRole, visualIntent: VisualIntent = "statement"): Beat => ({
  role,
  visualIntent,
});

const hasPicture = (layout: string) => Boolean(layoutSlots(layout as never).media);

/** The role sequence of the deck the owner reported, in its own order. */
const REPORTED_DECK: NarrativeRole[] = [
  "hook",
  "context",
  "frame",
  "claim",
  "example",
  "reframe",
  "evidence",
  "provocation",
  "question",
  "callback",
  "application",
  "close",
];

describe("a weak intent no longer vetoes the role", () => {
  it("gives an application beat the call to action its role is", () => {
    expect(composeDeck([beat("claim"), beat("application")])[1]).toBe("action");
  });

  it("gives a close the same, rather than one more centred line", () => {
    expect(composeDeck([beat("claim"), beat("close")])[1]).toBe("action");
  });

  it("gives an evidence beat a number or a chart", () => {
    const layout = composeDeck([beat("claim"), beat("evidence")])[1];
    expect(["figure", "chart"]).toContain(layout);
  });

  it("gives a context beat the explanation composition", () => {
    expect(composeDeck([beat("claim"), beat("context")])[1]).toBe("explainer");
  });

  it("gives a callback the voice it returns to", () => {
    expect(composeDeck([beat("claim"), beat("callback")])[1]).toBe("quote");
  });

  it("hands over a movement's point without needing an intent nobody emits", () => {
    // The old rule required `auto`. Production has produced `auto` once, so
    // the take-home had never been composed in a real deck.
    const layouts = composeDeck([
      beat("claim"),
      { role: "synthesis", visualIntent: "statement", endsMovement: true },
    ]);
    expect(layouts[1]).toBe("takeaway");
  });

  it("still leaves the roles whose own answer is one line alone", () => {
    // A quiet scene is legitimate — it just has to be the role's answer
    // rather than the model's shrug.
    for (const role of ["provocation", "question", "frame"] as NarrativeRole[]) {
      expect(composeDeck([beat("claim"), beat(role)])[1], role).toBe("statement");
    }
  });
});

describe("an intent that names content still wins", () => {
  it("honours a comparison, a chart, a quotation and a list", () => {
    expect(composeDeck([beat("claim", "comparison")])[0]).toBe("two-column");
    expect(composeDeck([beat("claim", "data")])[0]).toBe("chart");
    expect(composeDeck([beat("claim", "quotation")])[0]).toBe("quote");
    expect(composeDeck([beat("claim", "enumeration")])[0]).toBe("bullets");
  });

  it("honours an author who genuinely wants one line on an application beat", () => {
    // `statement` is weak coming from the model and an instruction coming from
    // the author. Provenance is the difference, not the word: an author who
    // opens the picker and chooses "One statement" for a call to action means
    // it, and the deck's rhythm never overrules them.
    expect(
      composeDeck([{ role: "application", visualIntent: "statement", intentAuthored: true }])[0],
    ).toBe("statement");
  });
});

describe("the deck has a rhythm", () => {
  const layouts = composeDeck(REPORTED_DECK.map((role) => beat(role)));

  it("opens on a cover", () => {
    expect(layouts[0]).toBe("cover");
  });

  it("never repeats one composition three times running", () => {
    for (let i = 2; i < layouts.length; i++) {
      expect(
        layouts[i] === layouts[i - 1] && layouts[i - 1] === layouts[i - 2],
        `${layouts[i]} three times at ${i}`,
      ).toBe(false);
    }
  });

  it("never goes four scenes without somewhere to put a picture", () => {
    let dry = 0;
    for (const layout of layouts) {
      dry = hasPicture(layout) ? 0 : dry + 1;
      expect(dry, `${dry} scenes running with no picture in ${layouts.join(", ")}`).toBeLessThan(4);
    }
  });

  it("alternates which side a split lands on, from the last one placed", () => {
    const sides = layouts.filter((l) => l === "split-left" || l === "split-right");
    for (let i = 1; i < sides.length; i++) expect(sides[i]).not.toBe(sides[i - 1]);
  });

  it("reaches for more of the instrument than the reported deck did", () => {
    // The reported deck was five bare statements, six side-by-sides and a
    // cover: three compositions in twelve scenes.
    expect(new Set(layouts).size).toBeGreaterThanOrEqual(6);
    expect(layouts.filter((l) => l === "statement").length).toBeLessThanOrEqual(3);
  });

  it("is deterministic — the same map composes the same deck every time", () => {
    expect(composeDeck(REPORTED_DECK.map((role) => beat(role)))).toEqual(layouts);
  });
});

describe("ranked choices", () => {
  it("always offers at least one composition for every role", () => {
    for (const role of [
      "hook",
      "provocation",
      "question",
      "context",
      "frame",
      "claim",
      "reframe",
      "evidence",
      "example",
      "demonstration",
      "contrast",
      "application",
      "synthesis",
      "transition",
      "callback",
      "close",
    ] as NarrativeRole[]) {
      expect(layoutChoices({ role, visualIntent: "statement" }, 3).length, role).toBeGreaterThan(0);
    }
  });

  it("offers exactly one when the intent named the content", () => {
    expect(layoutChoices({ role: "claim", visualIntent: "comparison" }, 1)).toEqual(["two-column"]);
  });
});
