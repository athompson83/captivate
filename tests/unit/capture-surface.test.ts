// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCaptureSurface,
  restrictCaptureToSurface,
  setCaptureSurface,
} from "@/lib/record/capture-surface";

/**
 * The decision tree that narrows a recording to the stage subtree.
 *
 * Element Capture cannot run in this environment, so what is tested is the
 * contract around it: when restriction is attempted, when it is skipped, and
 * that every failure lands on plain tab capture — the behaviour every
 * recording had before this existed — rather than a half-applied state.
 */

function trackStream(
  displaySurface: string | undefined,
  restrictTo?: (target: unknown) => Promise<void>,
): MediaStream {
  const track = {
    getSettings: () => (displaySurface ? { displaySurface } : {}),
    restrictTo,
  };
  return { getVideoTracks: () => [track] } as unknown as MediaStream;
}

function withRestrictionTarget(fromElement: (el: Element) => Promise<unknown>) {
  (window as unknown as Record<string, unknown>).RestrictionTarget = { fromElement };
}

afterEach(() => {
  setCaptureSurface(null);
  delete (window as unknown as Record<string, unknown>).RestrictionTarget;
});

describe("restrictCaptureToSurface", () => {
  it("reports a whole screen or window as such and touches nothing", async () => {
    expect(await restrictCaptureToSurface(trackStream("monitor"))).toBe("screen");
    expect(await restrictCaptureToSurface(trackStream("window"))).toBe("screen");
  });

  it("falls back to tab capture when the browser has no Element Capture", async () => {
    setCaptureSurface(document.createElement("div"));
    expect(await restrictCaptureToSurface(trackStream("browser"))).toBe("tab");
  });

  it("falls back to tab capture when no surface is registered", async () => {
    withRestrictionTarget(async () => ({}));
    const restrictTo = vi.fn(async () => {});
    expect(await restrictCaptureToSurface(trackStream("browser", restrictTo))).toBe("tab");
    expect(restrictTo).not.toHaveBeenCalled();
  });

  it("restricts to the registered surface when everything lines up", async () => {
    const el = document.createElement("div");
    setCaptureSurface(el);
    const target = { token: true };
    withRestrictionTarget(async (given) => {
      expect(given).toBe(el);
      return target;
    });
    const restrictTo = vi.fn(async () => {});
    expect(await restrictCaptureToSurface(trackStream("browser", restrictTo))).toBe("element");
    expect(restrictTo).toHaveBeenCalledWith(target);
  });

  it("undoes and falls back when the element is ineligible", async () => {
    setCaptureSurface(document.createElement("div"));
    withRestrictionTarget(async () => ({}));
    const calls: unknown[] = [];
    const restrictTo = vi.fn(async (t: unknown) => {
      calls.push(t);
      if (t !== null) throw new DOMException("NotSupportedError");
    });
    expect(await restrictCaptureToSurface(trackStream("browser", restrictTo))).toBe("tab");
    // The undo: a half-applied restriction must not blank the recording.
    expect(calls[calls.length - 1]).toBeNull();
  });

  it("clears the registry through the same ref callback that fills it", () => {
    const el = document.createElement("div");
    setCaptureSurface(el);
    expect(getCaptureSurface()).toBe(el);
    setCaptureSurface(null);
    expect(getCaptureSurface()).toBeNull();
  });
});
