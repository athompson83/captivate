"use client";

/**
 * The element a recording should contain: the show, not the cockpit.
 *
 * Tab capture records the whole viewport, presenter chrome and all — the
 * bar, the timer, a toast that happens to fire. The present view registers
 * the wrapper around its audience-facing layers here, and the recorder asks
 * the browser to restrict capture to that subtree where Element Capture
 * exists. A module-level slot rather than context, because the recorder is
 * not a React component and has no tree to read one from.
 */

let surface: HTMLElement | null = null;

export function setCaptureSurface(el: HTMLElement | null): void {
  surface = el;
}

export function getCaptureSurface(): HTMLElement | null {
  return surface;
}

/** What ends up in the file. `element` is the stage subtree alone. */
export type CaptureMode = "element" | "tab" | "screen";

interface RestrictableTrack extends MediaStreamTrack {
  restrictTo?: (target: unknown) => Promise<void>;
}

/**
 * Asks the browser to record only the registered surface.
 *
 * Element Capture is Chromium-only and the registered element must be
 * eligible (a flattenable subtree); both are checked by attempting, not by
 * sniffing versions. Every failure path lands on plain tab capture — the
 * behaviour every recording had before this existed — and says so in the
 * returned mode rather than pretending.
 */
export async function restrictCaptureToSurface(stream: MediaStream): Promise<CaptureMode> {
  const track = stream.getVideoTracks()[0] as RestrictableTrack | undefined;
  if (!track) return "tab";
  if (track.getSettings().displaySurface !== "browser") return "screen";

  const el = getCaptureSurface();
  const RestrictionTarget = (
    window as unknown as { RestrictionTarget?: { fromElement(el: Element): Promise<unknown> } }
  ).RestrictionTarget;
  if (!el || !RestrictionTarget?.fromElement || typeof track.restrictTo !== "function") {
    return "tab";
  }

  try {
    await track.restrictTo(await RestrictionTarget.fromElement(el));
    return "element";
  } catch {
    // An ineligible element or a mid-call surface change; undo best-effort so
    // a half-applied restriction cannot blank the recording.
    try {
      await track.restrictTo(null);
    } catch {
      // Nothing was applied.
    }
    return "tab";
  }
}
