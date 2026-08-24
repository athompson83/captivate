import { describe, expect, it } from "vitest";
import type { Scene } from "@/lib/schema/presentation";
import {
  jumpTargets,
  ordinalAt,
  runningOrder,
  runningOrderLength,
  runningOrderOrdinals,
} from "@/lib/present/running-order";

/**
 * The number the presenter is shown, wherever they are shown one.
 *
 * A detail scene is an aside: reached by clicking a hotspot, skipped by the
 * running order, possibly never opened. Several surfaces still numbered by
 * array position, so a deck with an aside stored third had a jumper counting
 * 1, 2, 4 while the progress bar beside it said "3 of 12" — two controls in the
 * same console, disagreeing, with no way for the presenter to reconcile them.
 *
 * The fix was to stop writing the one-line filter out again per surface.
 * `src/lib/present/running-order.ts` is the single answer, and the jumper, the
 * navigator, the console, the handout, the narrative map, the analysis and the
 * present session all import it — so these are tests on all of them, not on a
 * reimplementation that could quietly drift from what ships.
 */

function scene(id: string, flowRole: "main" | "detail"): Pick<Scene, "id" | "flowRole"> {
  return { id, flowRole };
}

const DECK = [
  scene("a", "main"),
  scene("b", "main"),
  scene("c", "detail"),
  scene("d", "main"),
  scene("e", "detail"),
  scene("f", "main"),
];

describe("the scene jumper", () => {
  it("lists only the running order", () => {
    expect(jumpTargets(DECK).map((t) => t.scene.id)).toEqual(["a", "b", "d", "f"]);
  });

  it("labels by the running order, not the array", () => {
    // The defect: 1, 2, 4, 6 — a sequence with holes in it that the presenter
    // cannot account for.
    expect(jumpTargets(DECK).map((t) => t.ordinal)).toEqual([1, 2, 3, 4]);
  });

  it("still jumps to the real array index", () => {
    // Renumbering the *target* would send the presenter to the wrong scene,
    // which is the reason the display number was wrong in the first place.
    expect(jumpTargets(DECK).map((t) => t.index)).toEqual([0, 1, 3, 5]);
  });

  it("agrees with the progress indicator's total", () => {
    // The two controls that disagreed. Same source now.
    expect(jumpTargets(DECK).at(-1)?.ordinal).toBe(runningOrderLength(DECK));
  });
});

describe("the scene navigator", () => {
  it("numbers main scenes by the running order", () => {
    const ordinals = runningOrderOrdinals(DECK);
    expect([...ordinals.entries()]).toEqual([
      ["a", 1],
      ["b", 2],
      ["d", 3],
      ["f", 4],
    ]);
  });

  it("gives an aside no number at all, because it has no place in the order", () => {
    const ordinals = runningOrderOrdinals(DECK);
    expect(ordinals.get("c")).toBeUndefined();
    expect(ordinals.get("e")).toBeUndefined();
  });

  it("counts a deck of only asides as no scenes rather than hiding it", () => {
    const asidesOnly = [scene("x", "detail"), scene("y", "detail")];
    expect(runningOrderOrdinals(asidesOnly).size).toBe(0);
    expect(asidesOnly.length - runningOrderOrdinals(asidesOnly).size).toBe(2);
  });
});

describe("recording chapters", () => {
  /** A mark carries both, and the label prefers the ordinal when it has one. */
  const label = (mark: { sceneIndex: number; ordinal?: number }) =>
    `Scene ${mark.ordinal ?? mark.sceneIndex + 1}`;

  it("labels a new recording by where the presenter was in the argument", () => {
    expect(label({ sceneIndex: 5, ordinal: 4 })).toBe("Scene 4");
  });

  it("leaves an older recording the label it already had", () => {
    // Inventing an ordinal for a recording made before the field existed would
    // be worse than the imperfect label it carries.
    expect(label({ sceneIndex: 5 })).toBe("Scene 6");
  });
});

describe("how far through the argument the presenter is", () => {
  it("counts the beats behind them, not the array positions", () => {
    expect(ordinalAt(DECK, 0)).toBe(1);
    expect(ordinalAt(DECK, 1)).toBe(2);
    expect(ordinalAt(DECK, 3)).toBe(3);
    expect(ordinalAt(DECK, 5)).toBe(4);
  });

  it("does not advance the talk when the presenter dives into an aside", () => {
    // Index 2 is the aside hanging off scene 2. The argument has not moved on,
    // and the progress bar must not say it has.
    expect(ordinalAt(DECK, 2)).toBe(ordinalAt(DECK, 1));
  });

  it("lists only the running order", () => {
    expect(runningOrder(DECK).map((s) => s.id)).toEqual(["a", "b", "d", "f"]);
  });
});
