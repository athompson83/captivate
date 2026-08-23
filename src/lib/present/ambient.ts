import type { Scene, ScenePlacement } from "@/lib/schema/presentation";
import { getTheme, type PresentationTheme } from "@/lib/schema/theme";
import { blendOklab, oklabCss, toOklab, type Oklab } from "@/lib/utils/color";
import type { Camera, Size } from "./camera";

/**
 * Atmosphere.
 *
 * The world is one continuous surface, so it has one continuous background —
 * not a background per scene, which is what makes scenes read as cards sitting
 * on a wall. Instead each region of the canvas has a *mood*, taken from the
 * theme its scenes use, and the colour between two regions is the blend of
 * them. Flying from a cold region to a warm one warms the whole screen on the
 * way, because that is what moving through a place looks like.
 *
 * Weighting is sharp inverse-distance over the nearest few scenes rather than
 * an average over all of them: averaging everything pulls every position toward
 * the same muddy mean, and the point is that different parts of a presentation
 * should feel different.
 */

export interface Palette {
  canvas: Oklab;
  accent: Oklab;
  surface: Oklab;
}

export interface Ambient {
  canvas: string;
  accent: string;
  surface: string;
  /** A soft glow colour for the region the camera is over. */
  glow: string;
}

/** How many nearby scenes contribute. Beyond three it just averages out. */
const NEIGHBOURS = 3;

/** Distances are measured in scene-widths, so this is "half a scene away". */
const FALLOFF = 0.5;

export function paletteOf(theme: PresentationTheme): Palette {
  return {
    canvas: toOklab(theme.tokens.canvas),
    accent: toOklab(theme.tokens.accent),
    surface: toOklab(theme.tokens.surface),
  };
}

/**
 * The palette for each scene: its own theme override where it has one, and the
 * presentation's theme otherwise. Computed once per document, not per frame.
 */
export function scenePalettes(scenes: Scene[], fallback: PresentationTheme): Palette[] {
  const cache = new Map<string, Palette>();
  return scenes.map((scene) => {
    const id = scene.content.themeOverride ?? fallback.id;
    let palette = cache.get(id);
    if (!palette) {
      palette = paletteOf(scene.content.themeOverride ? getTheme(id) : fallback);
      cache.set(id, palette);
    }
    return palette;
  });
}

/**
 * The atmosphere at a camera position.
 *
 * Called once per animation frame, so it stays O(number of scenes) with no
 * allocation beyond the result — the alternative, re-rendering React to change
 * a colour, is exactly what the camera loop exists to avoid.
 */
export function ambientAt(
  camera: Camera,
  placements: ScenePlacement[],
  palettes: Palette[],
  stage: Size,
  base: Palette,
): Ambient {
  if (placements.length === 0) {
    return {
      canvas: oklabCss(base.canvas),
      accent: oklabCss(base.accent),
      surface: oklabCss(base.surface),
      glow: oklabCss(base.accent, 0.16),
    };
  }

  // Distance in scene-widths, so the blend behaves the same in a tight
  // arrangement as in a sprawling one.
  const scored = placements.map((placement, index) => {
    const dx = (camera.x - placement.x) / stage.width;
    const dy = (camera.y - placement.y) / stage.width;
    return { index, distance: Math.hypot(dx, dy) };
  });

  scored.sort((a, b) => a.distance - b.distance);
  const nearest = scored.slice(0, NEIGHBOURS);

  const entries = nearest.map(({ index, distance }) => ({
    index,
    // Inverse square, floored so standing exactly on a scene is finite rather
    // than infinite, and so a scene never wins by an unbounded margin.
    weight: 1 / (FALLOFF * FALLOFF + distance * distance),
  }));

  const canvas = blendOklab(
    entries.map((e) => ({ color: palettes[e.index]?.canvas ?? base.canvas, weight: e.weight })),
  );
  const accent = blendOklab(
    entries.map((e) => ({ color: palettes[e.index]?.accent ?? base.accent, weight: e.weight })),
  );
  const surface = blendOklab(
    entries.map((e) => ({ color: palettes[e.index]?.surface ?? base.surface, weight: e.weight })),
  );

  return {
    canvas: oklabCss(canvas),
    accent: oklabCss(accent),
    surface: oklabCss(surface),
    glow: oklabCss(accent, 0.18),
  };
}
