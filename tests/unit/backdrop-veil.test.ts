import { describe, expect, it } from "vitest";
import { VEIL_FAR, VEIL_NEAR, backdropVeil } from "@/lib/present/backdrop";
import { FRAME_PADDING } from "@/lib/present/camera";

/**
 * The veil over the picture behind the show: the author's dim on a scene,
 * lifting as the camera pulls back, gone from the overview.
 */

const STAGE = 1600;
/** A world of many scenes: its framing is far wider than the veil's far edge. */
const WIDE = STAGE * 12;

describe("the veil over the picture", () => {
  it("is the author's dim on a scene, and nothing from the overview", () => {
    // On a scene the camera is the stage plus the frame's padding.
    expect(backdropVeil(STAGE * (1 + FRAME_PADDING), STAGE, WIDE, 0.35)).toBe(0.35);
    expect(backdropVeil(STAGE * VEIL_NEAR, STAGE, WIDE, 0.35)).toBe(0.35);
    // The whole world of a dozen scenes is many scene widths across.
    expect(backdropVeil(STAGE * 8, STAGE, WIDE, 0.35)).toBe(0);
    expect(backdropVeil(STAGE * VEIL_FAR, STAGE, WIDE, 0.35)).toBe(0);
  });

  it("eases between the two as the camera widens, never rising again", () => {
    let previous = Infinity;
    for (let zoom = 1; zoom <= 5; zoom += 0.1) {
      const veil = backdropVeil(STAGE * zoom, STAGE, WIDE, 0.5);
      expect(veil).toBeLessThanOrEqual(previous);
      expect(veil).toBeGreaterThanOrEqual(0);
      previous = veil;
    }
    const mid = backdropVeil(STAGE * ((VEIL_NEAR + VEIL_FAR) / 2), STAGE, WIDE, 0.5);
    expect(mid).toBeCloseTo(0.25, 2);
  });

  it("is nothing when the author asked for no dim, whatever the camera", () => {
    expect(backdropVeil(STAGE, STAGE, WIDE, 0)).toBe(0);
    expect(backdropVeil(STAGE * 10, STAGE, WIDE, 0)).toBe(0);
    expect(backdropVeil(STAGE, 0, WIDE, 0.4)).toBe(0);
  });

  it("is gone by the whole world's framing where that comes sooner than a few scene widths", () => {
    // A deck of two scenes side by side is not three and a half scene
    // widths across; from its overview the room is still seen whole.
    const two = STAGE * 2.16 * 1.12;
    expect(backdropVeil(two, STAGE, two, 0.4)).toBe(0);
    expect(backdropVeil(STAGE * (1 + FRAME_PADDING), STAGE, two, 0.4)).toBe(0.4);
    // A deck of one scene has nothing to pull back to, and keeps its veil.
    const one = STAGE * 1.12;
    expect(backdropVeil(one, STAGE, one, 0.4)).toBe(0.4);
  });
});
