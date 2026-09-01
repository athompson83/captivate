/**
 * Deterministic text auto-fit.
 *
 * A heading that is longer than its author expected must not spill over the
 * element below it — that is the single most common way a generated or
 * hand-edited deck ends up looking broken on a projector.
 *
 * The size is *estimated* rather than measured, on purpose:
 *
 *  - it is a pure function of the content and the box, so the 1600px stage and
 *    a 96px navigator thumbnail agree exactly, and a recording reproduces what
 *    the audience saw;
 *  - there is no measure-then-re-render cycle, so nothing reflows mid-drag or
 *    mid-transition.
 *
 * The estimate is conservative: it only ever shrinks text, never grows it, and
 * will not shrink past `minScale` — past that point the honest answer is that
 * there is too much text, which is a content problem the author should see.
 */

/** Rough advance width of an average glyph, as a fraction of the font size. */
const WIDTH_RATIO: Record<"display" | "sans" | "mono", number> = {
  // Editorial serifs are a little narrower per glyph than a grotesque.
  display: 0.46,
  sans: 0.5,
  mono: 0.6,
};

export interface FitOptions {
  /** Total characters of text to lay out. */
  characters: number;
  /** Longest unbreakable run, which sets a hard floor on the width. */
  longestWord?: number;
  boxWidth: number;
  boxHeight: number;
  desiredSize: number;
  lineHeight: number;
  family?: "display" | "sans" | "mono";
  /** Explicit line count, for lists where each item is its own line. */
  lines?: number;
  minScale?: number;
}

export function fitTextSize(options: FitOptions): number {
  const {
    characters,
    longestWord = 0,
    boxWidth,
    boxHeight,
    desiredSize,
    lineHeight,
    family = "sans",
    lines,
    minScale = 0.45,
  } = options;

  if (characters <= 0 || boxWidth <= 0 || boxHeight <= 0 || desiredSize <= 0) {
    return desiredSize;
  }

  const ratio = WIDTH_RATIO[family];
  const floor = desiredSize * minScale;

  // Height constraint.
  //
  // At font size `s`, a line holds `w / (s * ratio)` characters, so the text
  // occupies `n * s * ratio / w` lines — plus up to one more, because the last
  // line is almost never full. Requiring
  //
  //     (n * s * ratio / w + 1) * s * lineHeight <= h
  //
  // is a quadratic in `s`; solving it exactly is what keeps the estimate on the
  // safe side of the box instead of overshooting by a line.
  const a = (characters * ratio * lineHeight) / boxWidth;
  const areaLimited =
    a > 0
      ? (-lineHeight + Math.sqrt(lineHeight * lineHeight + 4 * a * boxHeight)) / (2 * a)
      : Infinity;

  // When the caller knows the line count (a list), height is simply divided.
  const lineLimited = lines && lines > 0 ? boxHeight / (lines * lineHeight) : Infinity;

  // A single unbreakable word should still fit across the box where that can be
  // achieved without going below the readable floor. Past that point CSS
  // `overflow-wrap: break-word` on the element breaks the word instead, which
  // is a better outcome than 12pt type on a projector.
  const wordLimited = longestWord > 0 ? boxWidth / (longestWord * ratio) : Infinity;

  const fitted = Math.min(areaLimited, lineLimited, wordLimited);

  // Only ever shrink, and never below the readable floor.
  return Math.max(floor, Math.min(desiredSize, fitted));
}

/** Characters and longest word of a plain string. */
export function textMetrics(text: string): { characters: number; longestWord: number } {
  const trimmed = text.trim();
  if (!trimmed) return { characters: 0, longestWord: 0 };

  let longestWord = 0;
  for (const word of trimmed.split(/\s+/)) {
    if (word.length > longestWord) longestWord = word.length;
  }
  return { characters: trimmed.length, longestWord };
}

/**
 * A list's own geometry, in multiples of the fitted font size.
 *
 * Exported because `element-view` lays the list out with these same numbers.
 * When the fit and the render disagree about how much room a bullet and a gap
 * take, the fit is confidently wrong — and the only symptom is text running
 * off the bottom of a scene in front of a room.
 */
export const LIST_MARKER_WIDTH_EMS = 0.24;
export const LIST_ORDERED_MARKER_WIDTH_EMS = 0.9;
export const LIST_MARKER_GAP_EMS = 0.6;
export const LIST_ITEM_GAP_EMS = 0.55;

export interface ListFitOptions {
  /** One entry per item, in order. */
  items: { characters: number; longestWord: number }[];
  boxWidth: number;
  boxHeight: number;
  desiredSize: number;
  lineHeight: number;
  family?: "display" | "sans" | "mono";
  ordered?: boolean;
  minScale?: number;
}

/**
 * The height a list actually occupies at a given font size.
 *
 * Counted per item, because that is where the estimate this replaces went
 * wrong: it budgeted `items + items / 2` lines for the whole list, so three
 * bullets of a sentence each were allowed four lines when they wrap to eight.
 * It also spent nothing on the bullet, the space after it, or the gaps between
 * items, all three of which are real height.
 *
 * Separate from `fitListSize` so a test can state the thing that matters —
 * that what is laid out fits the box it was given — rather than reproducing
 * the search and asserting a number.
 */
export function listHeightAt(size: number, options: ListFitOptions): number {
  const { items, boxWidth, lineHeight, family = "sans", ordered = false } = options;
  if (items.length === 0 || size <= 0) return 0;

  const ratio = WIDTH_RATIO[family];
  const markerEms =
    (ordered ? LIST_ORDERED_MARKER_WIDTH_EMS : LIST_MARKER_WIDTH_EMS) + LIST_MARKER_GAP_EMS;
  const textWidth = boxWidth - markerEms * size;
  if (textWidth <= 0) return Infinity;

  const charactersPerLine = textWidth / (size * ratio);
  let lines = 0;
  for (const item of items) {
    // An item always occupies at least one line, however short it is.
    lines += Math.max(1, Math.ceil(item.characters / charactersPerLine));
  }

  return lines * size * lineHeight + LIST_ITEM_GAP_EMS * size * (items.length - 1);
}

/**
 * The largest size at which a list still fits its box.
 *
 * Found by bisection rather than solved: the height is a step function of the
 * size — a line appears all at once when a word stops fitting — so there is no
 * closed form, and the quadratic used for flowing prose does not describe it.
 * Bisection is valid because the height never decreases as the size grows, and
 * it stays a pure function of the content and the box, which is what lets a
 * 96px thumbnail and a 4K projector agree.
 *
 * Like `fitTextSize` this only ever shrinks, and never past `minScale`: below
 * that the honest answer is that there is too much text on the scene, and the
 * author should be able to see that rather than have it hidden at six points.
 */
export function fitListSize(options: ListFitOptions): number {
  const { items, boxWidth, boxHeight, desiredSize, minScale = 0.45 } = options;

  if (items.length === 0 || boxWidth <= 0 || boxHeight <= 0 || desiredSize <= 0) {
    return desiredSize;
  }

  const floor = desiredSize * minScale;
  if (listHeightAt(desiredSize, options) <= boxHeight) return desiredSize;

  let low = floor;
  let high = desiredSize;
  // Thirty halvings takes the interval below a millionth of the desired size,
  // which is far finer than a pixel at any stage scale.
  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2;
    if (listHeightAt(mid, options) <= boxHeight) low = mid;
    else high = mid;
  }
  return low;
}
