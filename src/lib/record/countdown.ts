/**
 * Three, two, one.
 *
 * The streams are acquired while the presenter is still looking at a dialog;
 * the file should not begin while they are still looking at it. Between the
 * two there is a beat of counting — long enough to close the dialog, look up
 * and take a breath, short enough to stay a beat — and the recording starts
 * on zero, so the first second of the film is the presenter, not the click.
 *
 * Cancelling resolves rather than throwing: not recording is an outcome, not
 * a failure, and the caller releases the streams the same way it would on an
 * error.
 */

/** Where the count begins. */
export const COUNTDOWN_FROM = 3;
/** One number a second: the pace a room counts at. */
export const COUNTDOWN_STEP_MS = 1000;

/**
 * Counts down from `from` to one, reporting each number as it shows, and
 * resolves true a step after the last — or false at once if cancelled.
 */
export function countdown(
  from: number,
  onTick: (remaining: number) => void,
  signal?: AbortSignal,
  stepMs = COUNTDOWN_STEP_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      resolve(false);
    };
    signal?.addEventListener("abort", cancel, { once: true });

    const tick = (remaining: number) => {
      if (remaining <= 0) {
        signal?.removeEventListener("abort", cancel);
        resolve(true);
        return;
      }
      onTick(remaining);
      timer = setTimeout(() => tick(remaining - 1), stepMs);
    };
    tick(Math.max(0, Math.floor(from)));
  });
}
