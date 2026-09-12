import { parseHex, toOklab } from "@/lib/utils/color";

/**
 * How a picture is coloured to belong to the deck.
 *
 * A photograph arrives in its own colour world — a stock library's, a
 * phone's — and a deck of them reads as a scrapbook. A grade lays the deck's
 * own light over the photograph, in the theme's tokens and nothing else.
 *
 * It is one colour matrix applied to the picture's pixels (an SVG
 * `feColorMatrix`, with grain composited inside the picture's own alpha),
 * not a coloured layer over the picture's box: a layer paints the gutters
 * of a contained picture and the transparent parts of a PNG, and a logo on
 * the bare canvas would have arrived with an accent-coloured rectangle
 * behind it. The matrix touches only what the picture painted.
 *
 * A tint is the colourist's oldest move: a little of the picture's own
 * saturation traded for the accent laid into its light. A duotone goes the
 * whole way — every pixel is somewhere between two inks. Which two depends on
 * the theme: on a dark theme the shadows are the canvas and the highlights
 * the accent; on a light theme the accent takes the shadows and the canvas
 * the highlights, because a `lighten` toward a white canvas is a white
 * rectangle, which is what the first cut did on every light theme.
 */

export type ImageGrade = "none" | "tint" | "duotone";

/** Grain over a graded picture, as an alpha: a print, not a screen. */
export const GRAIN: Record<ImageGrade, number> = { none: 0, tint: 0.16, duotone: 0.2 };

/** How much of the accent a tint lays into the light. */
const TINT = 0.3;
/** A tint's colourised light is brighter than the accent's own value. */
const TINT_LIFT = 1.55;
/** How much of its own saturation a tinted picture gives up. */
const DESATURATE = 0.22;
/** A duotone's contrast, around the middle grey. */
const DUOTONE_CONTRAST = 1.12;

const LUM = [0.2126, 0.7152, 0.0722] as const;

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  // `parseHex` already answers in 0–1.
  const { r, g, b } = parseHex(hex);
  return [r, g, b];
}

/**
 * The 4×5 colour matrix for a grade, row-major as `feColorMatrix` takes it,
 * or null for a picture left as shot.
 *
 * Every row is linear in the source pixel, so the tint's desaturation, its
 * colourised light and the duotone's contrast all fold into one matrix and
 * one pass. Alpha is untouched.
 */
export function gradeMatrix(
  grade: ImageGrade,
  canvasHex: string,
  accentHex: string,
): number[] | null {
  if (grade === "none") return null;
  const accent = rgb(accentHex);
  const canvas = rgb(canvasHex);
  const rows: number[] = [];

  if (grade === "tint") {
    // R' = (1-k)·[(1-s)·R + s·lum] + k·lift·accent_r·lum
    for (let channel = 0; channel < 3; channel += 1) {
      for (let source = 0; source < 3; source += 1) {
        const own = source === channel ? (1 - TINT) * (1 - DESATURATE) : 0;
        const light = LUM[source] * ((1 - TINT) * DESATURATE + TINT * TINT_LIFT * accent[channel]);
        rows.push(own + light);
      }
      rows.push(0, 0);
    }
  } else {
    // R' = shadow_r + lum'·(highlight_r - shadow_r), lum' contrast-stretched.
    const lightTheme = toOklab(canvasHex).L > 0.5;
    const shadow = lightTheme ? accent : canvas;
    const highlight = lightTheme ? canvas : accent;
    for (let channel = 0; channel < 3; channel += 1) {
      const span = highlight[channel] - shadow[channel];
      for (let source = 0; source < 3; source += 1) {
        rows.push(LUM[source] * DUOTONE_CONTRAST * span);
      }
      rows.push(0, shadow[channel] + (0.5 - 0.5 * DUOTONE_CONTRAST) * span);
    }
  }
  rows.push(0, 0, 0, 1, 0);
  return rows;
}

/** A matrix applied to one pixel, clamped — what the browser will paint. */
export function applyGrade(matrix: number[], pixel: Rgb): Rgb {
  const out = [0, 1, 2].map((channel) => {
    const row = matrix.slice(channel * 5, channel * 5 + 5);
    const value = row[0] * pixel[0] + row[1] * pixel[1] + row[2] * pixel[2] + row[4];
    return Math.min(1, Math.max(0, value));
  });
  return out as Rgb;
}

/** `feColorMatrix` wants its twenty numbers as one string. */
export function matrixValues(matrix: number[]): string {
  return matrix.map((n) => Number(n.toFixed(4))).join(" ");
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
