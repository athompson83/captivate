import { ACCENT_TOKEN, type RichText } from "@/lib/schema/presentation";

/**
 * The phrase that matters, underlined by hand.
 *
 * A phrase set in the accent is a phrase in a different colour. A phrase
 * with a line drawn under it by hand is one somebody chose — the mark a
 * lecturer makes on a handout, the one the room copies down. So the run the
 * writer named (`bodyAccent`, and a heading's closing clause) carries an
 * underline drawn by the same hand as the drawings: one stroke per line the
 * phrase wraps onto, bent by the hand, sketched once the words are in.
 *
 * The geometry is here; the measuring is the renderer's (`HandMarks`), which
 * reads where the phrase's line fragments landed and draws a stroke under
 * each. Nothing is stored: the mark is the accent run's, on every stage.
 */

/** A run the writer marked: the accent token, not any accent-coloured run. */
export const isAccentRun = (run: RichText[number]): boolean =>
  run.color?.kind === "token" && run.color.token === ACCENT_TOKEN;

/** The stroke's width as a share of the phrase's font size. */
export const MARK_WEIGHT = 0.07;

/** Seconds after the scene performs before the first stroke starts. */
export const MARK_DELAY_S = 0.7;
/** Seconds between one line's stroke and the next. */
export const MARK_STAGGER_S = 0.25;
/** Seconds one stroke takes. */
export const MARK_DURATION_S = 0.45;

/** One line fragment of the phrase, in the host's own pixels. */
export interface Fragment {
  /** The fragment's left edge. */
  x: number;
  /** The fragment's bottom edge. */
  y: number;
  width: number;
}

const f = (n: number) => String(Math.round(n * 10) / 10);

/**
 * The stroke under one line of the phrase.
 *
 * Sits a tenth of the size above the fragment's bottom, through the
 * descenders as a pen does; runs a little uphill on one line and downhill
 * on the next, because a hand never draws level; and bows a touch towards
 * the middle. The hand's wobble is the renderer's filter, over this.
 */
export function underlinePath(fragment: Fragment, size: number, index: number): string {
  const lift = size * 0.1;
  const tilt = size * 0.05 * (index % 2 === 0 ? 1 : -1);
  const x0 = fragment.x;
  const x1 = fragment.x + fragment.width;
  const y0 = fragment.y - lift + tilt / 2;
  const y1 = fragment.y - lift - tilt / 2;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2 + size * 0.06;
  return `M ${f(x0)} ${f(y0)} Q ${f(cx)} ${f(cy)} ${f(x1)} ${f(y1)}`;
}
