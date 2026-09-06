/**
 * What a deck can say about its own generation, after the person who asked for
 * it has gone.
 *
 * Generating a deck is a single request that can run for five minutes. A phone
 * screen locks well before that, and an author who has just described a talk
 * has no reason to sit and watch a spinner.
 *
 * The good news, established from Vercel's own documentation rather than
 * assumed: request cancellation is **opt-in** (`supportsCancellation` in
 * `vercel.json`, which this project does not have), so a function keeps
 * running when the client disconnects. The work is not abandoned when a device
 * sleeps — `create-from-map` writes the movements, the moments and then the
 * scenes regardless of whether anyone is still listening.
 *
 * What was missing is the deck's ability to *say* any of that. The author came
 * back to a presentation with no way to tell whether it was mid-generation,
 * finished, or finished badly — and, faced with that, pressed create again.
 * Two decks called "How to Build a Side Hustle With AI" a minute apart in
 * production on 2026-09-06 are what that looks like.
 *
 * So the row records where it got to, and this decides what to show. The one
 * subtlety is that `generating` is a claim about the future: a runtime that is
 * killed outright leaves the row saying "generating" with nothing left to
 * finish it. So the claim expires. Past the window in which the writing route
 * could still be running, a deck that never reported back is *stalled* rather
 * than generating — which is the truth, and is also the state that should
 * offer to finish the job.
 */

/** What the row stores. Anything unrecognised reads as `ready`. */
export type GenerationStatus = "ready" | "generating" | "partial" | "failed";

/** What a reader is told. `stalled` is derived; it is never stored. */
export type GenerationState = "ready" | "generating" | "stalled" | "partial" | "failed";

/**
 * How long a deck may claim to be generating.
 *
 * The writing route's own ceiling (`maxDuration = 300`) plus a minute for the
 * final writes and the clock disagreeing between two machines. Shorter than
 * this and a deck that is genuinely still being written offers to restart
 * itself; much longer and a dead one sits there claiming to be busy.
 */
export const GENERATING_WINDOW_MS = 360_000;

export function generationState(
  status: string | null | undefined,
  startedAt: string | null | undefined,
  nowMs: number,
): GenerationState {
  if (status === "partial" || status === "failed") return status;
  if (status !== "generating") return "ready";

  const started = startedAt ? Date.parse(startedAt) : NaN;
  // No timestamp at all is not evidence of being busy: a row that says
  // `generating` and cannot say since when has nothing to expire, and the
  // honest reading is that nobody is coming back for it.
  if (!Number.isFinite(started)) return "stalled";

  return nowMs - started < GENERATING_WINDOW_MS ? "generating" : "stalled";
}

/** Whether the deck is worth offering to finish. */
export function canFinish(state: GenerationState): boolean {
  return state === "stalled" || state === "partial" || state === "failed";
}

/** What to tell the author, in their own terms. */
export function generationLabel(state: GenerationState): string | null {
  switch (state) {
    case "generating":
      return "Writing the scenes…";
    case "stalled":
      return "Never finished writing";
    case "partial":
      return "Placeholder scenes";
    case "failed":
      return "The scenes couldn't be written";
    case "ready":
      return null;
  }
}
