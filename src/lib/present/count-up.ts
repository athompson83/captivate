/**
 * A figure that counts up to itself.
 *
 * A one-number scene puts the largest thing on the screen in the audience's
 * eye, and a number that arrives already finished is read once and forgotten.
 * One that climbs to its value in a second is watched — the room is waiting
 * for it to stop — and the stopping point is the point.
 *
 * Pure: what to count and how to write it. The stage runs the clock and
 * writes the text through a ref, because a number changing sixty times a
 * second must not pass through React.
 */

export interface FigureSpec {
  /** Text before the number: a currency sign, a word. */
  prefix: string;
  /** Text after it: a unit, a percent sign, the rest of the sentence. */
  suffix: string;
  value: number;
  /** Decimal places the author wrote; kept for every intermediate value. */
  decimals: number;
  /** Whether the author grouped thousands with commas. */
  grouped: boolean;
}

/** How long the climb takes. Long enough to watch, short enough to wait for. */
export const COUNT_MS = 1100;

/**
 * Below this a count is a flicker rather than a climb — "1 in 4" counting
 * from zero to one says nothing — so small figures arrive as they are.
 */
const MIN_COUNTED = 5;

/** A plain number, or one grouped in threes. A comma anywhere else is punctuation. */
const NUMBER = /-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;

/**
 * The one number in a figure, or nothing.
 *
 * Exactly one: "1 in 4" and "3 of 10" are ratios whose parts are not
 * independent quantities, and counting either half misreads them. And only a
 * number this can write back exactly as the author did — "007" would land
 * on "7", and a figure is the author's, not the formatter's.
 */
export function parseFigure(text: string): FigureSpec | null {
  const matches = [...text.matchAll(NUMBER)];
  if (matches.length !== 1) return null;
  const match = matches[0];
  const raw = match[0];
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value) || Math.abs(value) < MIN_COUNTED) return null;
  const start = match.index ?? 0;
  const spec: FigureSpec = {
    prefix: text.slice(0, start),
    suffix: text.slice(start + raw.length),
    value,
    decimals: raw.includes(".") ? raw.split(".")[1].length : 0,
    grouped: raw.includes(","),
  };
  return formatFigure(spec, value) === raw ? spec : null;
}

/** The number as the author would have written it, at any intermediate value. */
export function formatFigure(spec: FigureSpec, value: number): string {
  const fixed = Math.abs(value).toFixed(spec.decimals);
  const [whole, fraction] = fixed.split(".");
  const grouped = spec.grouped ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : whole;
  const sign = value < 0 || (value === 0 && spec.value < 0) ? "-" : "";
  return `${sign}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Where the count is at progress `t` in [0, 1].
 *
 * Ease-out: fast through the numbers nobody is reading, slowing into the
 * last few so the eye can settle on the answer as it lands.
 */
export function figureAt(spec: FigureSpec, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const eased = 1 - Math.pow(1 - clamped, 3);
  return spec.value * eased;
}
