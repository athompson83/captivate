import type { Palette } from "./ambient";
import type { BackdropGraphic } from "@/lib/schema/presentation";
import { oklabCss } from "@/lib/utils/color";
import type { Oklab } from "@/lib/utils/color";

/**
 * A backdrop that is drawn rather than photographed.
 *
 * `JourneyBackdrop` already puts one picture behind the whole show, and a
 * photograph is the right answer when the author has one. Most decks do not:
 * the generator can find a stock photograph for a cover and there is nothing
 * behind the other scenes but the air, which is a colour field and reads —
 * correctly — as air. The room itself had no design in it.
 *
 * So this is the other kind of backdrop: a composition in the presentation's
 * own palette, at the same plane and the same depth, so a flight slides it
 * slower than the scenes and a scene sits perfectly still against it.
 *
 * Three rules it keeps, all of them the repository's:
 *
 *  - **no rectangles, no grids, no dots.** Every form here is a soft radial or
 *    a wide band with no visible edge. A grid of dots is the visual language
 *    of a design tool and the moment a presentation looks like one, it is one;
 *  - **colour comes from the theme**, in OKLab, so a graphic backdrop cannot
 *    fight the air blended from the regions in front of it. There is no hex
 *    here and no colour that is not derived from `Palette`;
 *  - **it is the room, not the content.** Everything is low-contrast against
 *    the canvas by construction, and `JourneyBackdrop.dim` still lays the
 *    canvas over the top, so a heading stays readable wherever it lands.
 *
 * Pure, and CSS rather than a canvas: it costs one painted layer that the
 * compositor already has to move for the parallax, no second WebGL context on
 * a device that may only give the page one, and it renders identically where
 * WebGL is unavailable — which is the case the atmosphere already falls back
 * from.
 */

/** Nudges a palette colour without leaving the theme: lightness and chroma only. */
function shift(color: Oklab, lightness: number, chroma = 1): Oklab {
  return {
    L: Math.min(1, Math.max(0, color.L + lightness)),
    a: color.a * chroma,
    b: color.b * chroma,
  };
}

/**
 * Whether the theme reads as a dark room or a lit page.
 *
 * A wash that lifts a midnight canvas is the same wash that dirties paper, so
 * every form below moves *away* from the canvas rather than in a fixed
 * direction — the rule the atmosphere's motes already follow.
 */
function away(canvas: Oklab): number {
  return canvas.L < 0.5 ? 1 : -1;
}

export interface GraphicBackdrop {
  /** Painted under everything else on the layer, so no seam can show. */
  backgroundColor: string;
  /** One or more soft forms, front to back, as a `background-image` value. */
  backgroundImage: string;
}

/**
 * The CSS for a graphic backdrop, or `null` where there is none.
 *
 * Deterministic: the same theme and style always give the same composition, so
 * a deck looks the same in the editor, on the projector, in a thumbnail and in
 * a recording. Nothing here reads the clock or a random seed.
 */
export function graphicBackdrop(
  graphic: BackdropGraphic,
  palette: Palette,
): GraphicBackdrop | null {
  if (graphic === "none") return null;

  const lift = away(palette.canvas);
  // The canvas stays the canvas. Lifting the ground as well as laying washes
  // over it is what turns a composition into a haze: the forms need somewhere
  // dark to be light against.
  const ground = oklabCss(palette.canvas);
  const accent = (alpha: number, lightness = 0) =>
    oklabCss(shift(palette.accent, lift * lightness, 0.85), alpha);
  const surface = (alpha: number, lightness = 0) =>
    oklabCss(shift(palette.surface, lift * lightness, 0.7), alpha);

  switch (graphic) {
    case "aurora":
      // Four washes that cross. Placed on a diagonal and at different sizes so
      // the eye finds no repeat, and none of them reaches an edge at full
      // strength — a wash with a visible boundary is a shape, and shapes on
      // the backdrop are the thing this file exists to avoid.
      return {
        backgroundColor: ground,
        backgroundImage: [
          // Tighter than they look like they should be. A wash wide enough to
          // reach the far corner stops being a form and becomes a tint over
          // everything, which is the haze this replaced: each of these is
          // gone by half its own radius, so there is dark canvas between them
          // and the eye reads light rather than dirt.
          `radial-gradient(38% 34% at 16% 18%, ${accent(0.42, 0.1)} 0%, transparent 55%)`,
          `radial-gradient(30% 30% at 84% 30%, ${surface(0.36, 0.08)} 0%, transparent 58%)`,
          `radial-gradient(46% 26% at 66% 92%, ${accent(0.24, 0.05)} 0%, transparent 60%)`,
          `radial-gradient(26% 34% at 6% 86%, ${surface(0.2, 0.06)} 0%, transparent 62%)`,
        ].join(", "),
      };

    case "strata":
      // Distance, seen through air: bands that get lighter and closer together
      // toward the horizon. A linear gradient with soft stops rather than
      // separate elements, so there is no line anywhere in it.
      return {
        backgroundColor: ground,
        backgroundImage: [
          `linear-gradient(176deg, ${surface(0.3, 0.08)} 0%, transparent 22%, ` +
            `${accent(0.14, 0.04)} 44%, transparent 58%, ${surface(0.24, 0.06)} 82%, ` +
            `transparent 96%)`,
          `radial-gradient(70% 30% at 50% 4%, ${accent(0.3, 0.1)} 0%, transparent 62%)`,
        ].join(", "),
      };

    case "halo":
      // One source of light, off-centre, and the room falling away from it.
      // The counter-wash on the opposite corner stops the fall reading as a
      // vignette, which is a frame, which is a rectangle.
      return {
        backgroundColor: ground,
        backgroundImage: [
          `radial-gradient(34% 40% at 70% 24%, ${accent(0.55, 0.13)} 0%, ` +
            `${accent(0.16, 0.05)} 42%, transparent 66%)`,
          `radial-gradient(52% 46% at 20% 94%, ${surface(0.26, 0.06)} 0%, transparent 68%)`,
        ].join(", "),
      };
  }
}
