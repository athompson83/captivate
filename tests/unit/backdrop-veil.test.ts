import { describe, expect, it } from "vitest";
import { VEIL_FAR, VEIL_NEAR, backdropVeil, veilBand } from "@/lib/present/backdrop";

/**
 * The veil over the picture behind the show: the author's dim on a scene,
 * lifting as the camera pulls back, gone where the camera is going.
 */

/** A scene's framing on a 1600-wide stage, and a world of many of them. */
const SCENE = 1600 * 1.08;
const WIDE = 1600 * 12;

describe("the veil over the picture", () => {
  it("is the author's dim on a scene, and nothing from the overview", () => {
    const band = veilBand(SCENE, null, WIDE);
    expect(backdropVeil(SCENE, band, 0.35)).toBe(0.35);
    expect(backdropVeil(SCENE * VEIL_NEAR, band, 0.35)).toBe(0.35);
    expect(backdropVeil(SCENE * VEIL_FAR, band, 0.35)).toBe(0);
    expect(backdropVeil(SCENE * 8, band, 0.35)).toBe(0);
  });

  it("measures against the scene's own framing, so an enlarged scene keeps its dim", () => {
    // Codex, reviewing the PR: a scene resized to three times its size in
    // the journey map is framed three times as wide, and measured against
    // the stage it had lost its veil while words were still on it.
    const big = veilBand(SCENE * 3.2, null, WIDE);
    expect(backdropVeil(SCENE * 3.2, big, 0.4)).toBe(0.4);
    expect(backdropVeil(SCENE * 3.2 * VEIL_FAR, big, 0.4)).toBe(0);
  });

  it("is gone where the camera is going when it pulls back, however near that is", () => {
    // A section of two scenes frames well under a few scene widths; the
    // promise is that the section view is unveiled when the camera lands.
    const section = SCENE * 2.1;
    const band = veilBand(SCENE, section, WIDE);
    expect(backdropVeil(section, band, 0.4)).toBe(0);
    expect(backdropVeil(SCENE, band, 0.4)).toBe(0.4);
    // The world of a two-scene deck, likewise.
    const two = SCENE * 2.16 * 1.12;
    expect(backdropVeil(two, veilBand(SCENE, two, two), 0.4)).toBe(0);
  });

  it("eases between the two as the camera widens, never rising again", () => {
    const band = veilBand(SCENE, null, WIDE);
    let previous = Infinity;
    for (let zoom = 1; zoom <= 5; zoom += 0.1) {
      const veil = backdropVeil(SCENE * zoom, band, 0.5);
      expect(veil).toBeLessThanOrEqual(previous);
      expect(veil).toBeGreaterThanOrEqual(0);
      previous = veil;
    }
    expect(backdropVeil((band.near + band.far) / 2, band, 0.5)).toBeCloseTo(0.25, 2);
  });

  it("keeps its veil on a deck of one scene, whose world is its scene", () => {
    const one = SCENE * (1.12 / 1.08);
    const band = veilBand(SCENE, null, one);
    expect(band.far).toBeGreaterThan(band.near);
    expect(backdropVeil(one, band, 0.4)).toBe(0.4);
    // And when the destination is that world.
    expect(backdropVeil(one, veilBand(SCENE, one, one), 0.4)).toBe(0.4);
  });

  it("is nothing when the author asked for no dim, whatever the camera", () => {
    const band = veilBand(SCENE, null, WIDE);
    expect(backdropVeil(SCENE, band, 0)).toBe(0);
    expect(backdropVeil(SCENE * 10, band, 0)).toBe(0);
    expect(backdropVeil(SCENE, veilBand(0, null, WIDE), 0.4)).toBe(0);
  });
});
