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
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);

  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_DETAIL ? `${collapsed.slice(0, MAX_DETAIL)}…` : collapsed;
}

/**
 * Records that `operation` failed, and why, without recording what it was on.
 *
 * Never throws: an observability call that can fail the request it is observing
 * is worse than no observability, and this runs inside failure paths that are
 * already going badly.
 */
export function logFailure(operation: string, error: unknown): void {
  try {
    console.error(`${PREFIX} ${operation}: ${detailOf(error)}`);
  } catch {
    // Nothing sensible remains to do if stderr itself is unavailable, and
    // throwing here would replace a handled failure with an unhandled one.
  }
}

/** Exposed so the redaction rules can be tested without capturing stderr. */
export const __detailOfForTests = detailOf;
