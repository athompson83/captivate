import "server-only";

/**
 * One line for the operator when a failure is handled rather than thrown.
 *
 * Captivate returns failures as values — `{ ok: false, error }` — which is the
 * right shape for the caller and invisible to everybody else. A *thrown* error
 * reaches the platform's runtime log with a digest the user can quote; a
 * *returned* one reaches nothing at all. The sign-in outage that opened this
 * release had to be root-caused from the database's own edge log, because the
 * application recorded nothing about the read that had failed.
 *
 * So a handled failure still says so once, on stderr, where the hosting
 * platform collects it. Deliberately not a logging framework: one function, a
 * greppable prefix, and no transport to configure or fail.
 *
 * What it must never carry is the material the failure was about. An operator
 * needs to know that saving a deck failed and what the database said; they do
 * not need the deck. Callers pass an operation label and the error — never a
 * prompt, a scene, a note, a token, or a key.
 */

const PREFIX = "captivate:failure";

/** Bounded so one enormous provider message cannot flood the log. */
const MAX_DETAIL = 300;

/**
 * Reduces anything a caller might hand over to a short, printable string.
 *
 * Errors arrive here from three sources with three shapes — a thrown `Error`, a
 * PostgREST object with a `message`, and the occasional bare string — and a log
 * line that reads `[object Object]` is the same as no log line at all.
 */
function detailOf(error: unknown): string {
  try {
    return describe(error);
  } catch {
    // Reading the error threw. Three real shapes do it: an object with no
    // prototype, one whose `toString` throws, and one whose `message` is a
    // getter that throws. Since the refactor that moved this call out of the
    // writer's guard, any of them would have turned a *handled* failure into an
    // unhandled one — the exact thing this module promises never to do, from
    // inside the code meant to observe it.
    return "(unprintable error)";
  }
}

/** The shapes an error actually arrives in, before anything defends them. */
function describe(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);

  const collapsed = raw.replace(/\s+/g, " ").trim();
  // The ellipsis counts. Slicing to the maximum and *then* adding it produced
  // 301 characters against a documented bound of 300 — and the first test
  // written for it asserted 301, so the number in the comment and the number in
  // the code disagreed with nobody to notice.
  return collapsed.length > MAX_DETAIL ? `${collapsed.slice(0, MAX_DETAIL - 1)}…` : collapsed;
}

/**
 * Records that `operation` failed, and why, without recording what it was on.
 *
 * Never throws: an observability call that can fail the request it is observing
 * is worse than no observability, and this runs inside failure paths that are
 * already going badly.
 */
export function logFailure(operation: string, error: unknown): void {
  emit(operation, detailOf(error));
}

/**
 * The one place a line is written, so a detail is bounded exactly once.
 *
 * Composing a message and passing it back through `logFailure` ran `detailOf`
 * over it a second time, and a detail already at its limit lost whatever had
 * been appended — which was the suppressed count, the very part that keeps a
 * throttle from being a way to hide things. Bounding the error and adding the
 * bookkeeping are different jobs; only the first one truncates.
 *
 * Never throws: this runs inside failure paths that are already going badly,
 * and an observability call that can fail the request it is observing is worse
 * than no observability at all.
 */
function emit(operation: string, detail: string): void {
  try {
    console.error(`${PREFIX} ${operation}: ${detail}`);
  } catch {
    // Nothing sensible remains to do if stderr itself is unavailable, and
    // throwing here would replace a handled failure with an unhandled one.
  }
}

/**
 * The same line, but bounded when the thing failing is reachable by anyone.
 *
 * `logFailure` assumes a failure is worth a line each time, which holds for the
 * paths behind a session. It does not hold on a public endpoint: the Stripe
 * webhook takes an unauthenticated POST, so a bot sending rubbish signatures
 * can mint log lines without limit and bury the genuine signal underneath its
 * own noise — turning an observability improvement into a way to hide things.
 *
 * So repeats inside `windowMs` are counted rather than printed, and the next
 * line through carries how many it stood in for. The count is what keeps this
 * honest: a burst still says it was a burst, at one line instead of thousands.
 *
 * Best-effort by construction. The state is per-instance and a serverless
 * instance is short-lived, so this bounds the volume one worker can emit rather
 * than the volume the fleet can. That is the part that costs money, and a
 * shared counter would need a store that can itself fail inside a failure path.
 *
 * Keyed by the operation label, which is always a constant in this codebase and
 * never anything a caller supplies — a map keyed by attacker-supplied strings
 * would be a leak wearing a throttle's clothes.
 */
const seen = new Map<string, { at: number; suppressed: number }>();

export function logFailureSampled(operation: string, error: unknown, windowMs = 60_000): void {
  const now = Date.now();
  const previous = seen.get(operation);

  if (previous && now - previous.at < windowMs) {
    previous.suppressed += 1;
    return;
  }

  const suppressed = previous?.suppressed ?? 0;
  seen.set(operation, { at: now, suppressed: 0 });
  emit(
    operation,
    suppressed > 0
      ? `${detailOf(error)} (+${suppressed} more in the last ${Math.round(windowMs / 1000)}s)`
      : detailOf(error),
  );
}

/** Exposed so the redaction rules can be tested without capturing stderr. */
export const __detailOfForTests = detailOf;

/** Exposed so the sampling window can be tested without waiting for it. */
export function __resetSamplingForTests(): void {
  seen.clear();
}
