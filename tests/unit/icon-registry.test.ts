import { describe, expect, it } from "vitest";
import { ICON_NAMES, DEFAULT_ICON } from "@/lib/schema/icons";
import { iconFor } from "@/components/stage/element-view";
import { GeneratedScene } from "@/lib/ai/schemas";

/**
 * The list and the drawing of it have to be the same set.
 *
 * They are deliberately in two modules — the names are plain data the
 * generation schema reads, the components are a client-only map — and that
 * separation has exactly one failure mode: a name in one and not the other.
 * It is silent in both directions. A name with no component falls back to a
 * circle, which is indistinguishable from a model that chose a circle; a
 * component with no name is simply unreachable, and looks like a rendering bug
 * when somebody wonders why the icon they added never appears.
 */
describe("the curated icon set", () => {
  it("draws something specific for every name it offers", () => {
    const fallback = iconFor("a name that is definitely not in the set");
    const missing = ICON_NAMES.filter(
      (name) => name !== DEFAULT_ICON && iconFor(name) === fallback,
    );
    expect(
      missing,
      "these names resolve to the fallback, so they render as a plain circle",
    ).toEqual([]);
  });

  it("still falls back rather than throwing on a name from an older deck", () => {
    // Stored content outlives the registry. An icon removed from the set must
    // degrade to a circle, not take the scene down with it.
    expect(() => iconFor("some-icon-we-retired")).not.toThrow();
    expect(iconFor("some-icon-we-retired")).toBe(iconFor(DEFAULT_ICON));
  });

  it("offers enough range that three cards need not repeat one", () => {
    // The complaint this set was widened for was "use more interesting icons".
    // Twenty-three, most of them generic UI furniture, could not carry a
    // clinical point and a trend and a risk on the same scene.
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(ICON_NAMES).size, "a duplicate name is a silently dead key").toBe(
      ICON_NAMES.length,
    );
  });
});

describe("what a generated card may ask for", () => {
  const card = (icon: unknown) => ({ title: "A claim", body: "What it rests on.", icon });

  it("accepts an icon the renderer can actually draw", () => {
    const parsed = GeneratedScene.safeParse({
      title: "Three things",
      layout: "three-up",
      heading: "Three things",
      cards: [card("trending-down"), card("shield"), card("stethoscope")],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.cards[0].icon).toBe("trending-down");
  });

  it("refuses one it cannot, rather than quietly drawing a circle", () => {
    // The whole reason this is an enum. A free string would let the model
    // invent `"heartbeat"`, resolve to the fallback, and look exactly like
    // success — which is the state every generated card was already in.
    const parsed = GeneratedScene.safeParse({
      title: "Three things",
      layout: "three-up",
      heading: "Three things",
      cards: [card("heartbeat")],
    });
    expect(parsed.success, "an invented name must fail and earn the retry").toBe(false);
  });

  it("lets a model that has no opinion say so", () => {
    // Null is a real answer — some cards are genuinely not about anything an
    // icon can say — and the composer falls back for it. What must not happen
    // is the field being absent because it was never offered.
    const parsed = GeneratedScene.safeParse({
      title: "Three things",
      layout: "three-up",
      heading: "Three things",
      cards: [{ title: "A claim", body: "What it rests on." }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.cards[0].icon).toBeNull();
  });
});
