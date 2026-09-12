/**
 * How a picture is coloured to belong to the deck.
 *
 * Pure: the CSS for each grade, so the renderer, a thumbnail and a test all
 * describe the same treatment. Everything here is a blend of the theme's own
 * tokens over the photograph — no colour that is not the deck's.
 *
 * A tint is the colourist's oldest move: the picture loses a little of its
 * own saturation and the theme's accent is laid over it in `color` blend, so
 * its hues lean the deck's way while its light stays photographic. A duotone
 * goes the whole way: greyscale, the highlights pulled to the accent by a
 * `multiply` and the shadows lifted to the canvas by a `lighten`, which is
 * the two-ink print art directors have reached for since the Sixties. Grain
 * over both, because a photograph without grain against a designed ground
 * looks like a screen; with it, it looks like a print.
 */

export type ImageGrade = "none" | "tint" | "duotone";

/** A grain field: fractal noise, black on transparent, tiled small. */
export const GRAIN_TILE_PX = 180;

const GRAIN_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='${GRAIN_TILE_PX}' height='${GRAIN_TILE_PX}'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(#g)'/></svg>`;

export const GRAIN_DATA_URL = `url("data:image/svg+xml;utf8,${encodeURIComponent(GRAIN_SVG)}")`;

export interface GradeLayer {
  background: string;
  mixBlendMode: "color" | "multiply" | "lighten";
  opacity: number;
}

export interface GradeCss {
  /** The filter on the photograph itself; empty for none. */
  filter: string;
  /** Colour layers over it, in order, each blended. */
  layers: GradeLayer[];
  /** Grain over everything, at this opacity; 0 for none. */
  grain: number;
}

/**
 * The treatment for a grade, in the theme's tokens.
 *
 * The tint is deliberately light: a room should feel that every picture
 * belongs and never notice why. The duotone is what it is.
 */
export function gradeCss(grade: ImageGrade): GradeCss {
  switch (grade) {
    case "tint":
      return {
        filter: "saturate(0.78) contrast(1.05)",
        layers: [{ background: "var(--stage-accent)", mixBlendMode: "color", opacity: 0.3 }],
        grain: 0.16,
      };
    case "duotone":
      return {
        filter: "grayscale(1) contrast(1.12)",
        layers: [
          { background: "var(--stage-accent)", mixBlendMode: "multiply", opacity: 1 },
          { background: "var(--stage-canvas)", mixBlendMode: "lighten", opacity: 1 },
        ],
        grain: 0.2,
      };
    default:
      return { filter: "", layers: [], grain: 0 };
  }
}

/**
 * Whether a picture's frame is the whole stage.
 *
 * A feathered edge on a full-bleed picture is a window: the veil over a
 * cover faded out at its rim and showed the title scene's own words through
 * the gap — ghost letters down the left of every generated cover. The
 * stage's own edge is edge enough.
 */
export function coversStage(frame: { x: number; y: number; w: number; h: number }): boolean {
  return frame.x <= 0.5 && frame.y <= 0.5 && frame.x + frame.w >= 99.5 && frame.y + frame.h >= 99.5;
}
