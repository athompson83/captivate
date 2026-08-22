import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Atmosphere, type AtmosphereHandle } from "@/components/stage/atmosphere";
import { webglAvailable } from "@/lib/present/atmosphere";
import { paletteOf } from "@/lib/present/ambient";
import { getTheme } from "@/lib/schema/theme";

/**
 * The atmosphere's lifecycle, which is where a decorative layer does its
 * damage. A shader that looks right and leaks an animation frame on every
 * remount is worse than no shader: the cost is invisible until a presenter's
 * laptop is warm and the fans are audible in a quiet room.
 *
 * jsdom has no WebGL, which makes it exactly the environment for the half of
 * this that has to keep working when WebGL is absent.
 */

const base = paletteOf(getTheme("midnight"));

const props = {
  placements: [{ x: 0, y: 0, scale: 1, rotation: 0 }],
  palettes: [base],
  base,
  stage: { width: 1600, height: 900 },
  viewport: { width: 1440, height: 900 },
  depth: 0.55,
  still: false,
};

let rafSpy: ReturnType<typeof vi.spyOn>;
let cancelSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Say the quiet part explicitly rather than relying on jsdom's unimplemented
  // `getContext`: this suite is the no-WebGL browser, and it should read that
  // way instead of depending on what a stub happens to return.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  rafSpy = vi.spyOn(window, "requestAnimationFrame");
  cancelSpy = vi.spyOn(window, "cancelAnimationFrame");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the canvas it puts on the page", () => {
  it("is hidden from assistive technology and cannot be interacted with", () => {
    // It carries no information. Anything else would be a decorative layer
    // that a screen reader has to read out.
    const { container } = render(<Atmosphere {...props} />);
    const canvas = container.querySelector("canvas");

    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
    expect(canvas?.className).toContain("pointer-events-none");
  });

  it("renders exactly one canvas", () => {
    const { container } = render(<Atmosphere {...props} />);
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
  });
});

describe("when WebGL is unavailable", () => {
  it("mounts without throwing", () => {
    // jsdom gives no context at all, which is the same answer a blocklisted
    // driver gives. The page must be correct either way.
    expect(() => render(<Atmosphere {...props} />)).not.toThrow();
  });

  it("still registers a handle, and says plainly that it painted nothing", () => {
    // The world calls `draw` every frame and must not have to know whether the
    // GPU turned up — but it does need the answer, because it decides from it
    // whether the CSS wash underneath is still the thing doing the work.
    let handle: AtmosphereHandle | null = null;
    render(<Atmosphere {...props} onReady={(h) => (handle = h ?? handle)} />);

    expect(handle).not.toBeNull();
    expect(handle!.draw({ x: 0, y: 0, width: 1600, rotation: 0 })).toBe(false);
  });

  it("reports availability honestly rather than assuming", () => {
    expect(webglAvailable()).toBe(false);
    expect(webglAvailable(() => ({ getContext: () => null }) as unknown as HTMLCanvasElement)).toBe(
      false,
    );
    expect(
      webglAvailable(() => {
        throw new Error("blocked");
      }),
    ).toBe(false);
  });

  it("treats a context it can get as available, and gives it straight back", () => {
    // The probe must release its context: a canvas has one, and the real
    // canvas needs it.
    const lose = vi.fn();
    const fake = {
      getContext: () => ({ getExtension: () => ({ loseContext: lose }) }),
    } as unknown as HTMLCanvasElement;

    expect(webglAvailable(() => fake)).toBe(true);
    expect(lose).toHaveBeenCalledTimes(1);
  });
});

describe("the drift loop", () => {
  it("runs while the air is meant to move", () => {
    render(<Atmosphere {...props} />);
    expect(rafSpy).toHaveBeenCalled();
  });

  it("does not run at all under a reduced-motion preference", () => {
    // The colour field is not motion and stays; the drift is, and goes. A
    // loop that ticks anyway would be burning a frame budget to render the
    // same thing forever.
    render(<Atmosphere {...props} still />);
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it("does not run when the journey asks for no depth", () => {
    render(<Atmosphere {...props} depth={0} />);
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it("is cancelled on unmount", () => {
    const { unmount } = render(<Atmosphere {...props} />);
    expect(rafSpy).toHaveBeenCalled();
    unmount();
    expect(cancelSpy).toHaveBeenCalled();
  });

  it("leaves nothing running after a remount", () => {
    // React 19 development mounts, unmounts and mounts again. A loop started
    // on the first mount and never cancelled is a second loop forever.
    const first = render(<Atmosphere {...props} />);
    const started = rafSpy.mock.calls.length;
    first.unmount();
    const cancelled = cancelSpy.mock.calls.length;

    const second = render(<Atmosphere {...props} />);
    second.unmount();

    expect(cancelSpy.mock.calls.length).toBeGreaterThan(cancelled);
    expect(rafSpy.mock.calls.length).toBeGreaterThan(started);
    // Every loop this component started, it also stopped.
    expect(cancelSpy.mock.calls.length).toBe(2);
  });

  it("stops when the preference changes mid-life, without waiting for unmount", () => {
    const { rerender } = render(<Atmosphere {...props} />);
    const before = cancelSpy.mock.calls.length;
    rerender(<Atmosphere {...props} still />);
    expect(cancelSpy.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("handing the world its draw function", () => {
  it("registers on mount and withdraws on unmount", () => {
    // The world holds this in a ref and calls it every frame. A handle left
    // registered after unmount is a call into a disposed renderer.
    const onReady = vi.fn();
    const { unmount } = render(<Atmosphere {...props} onReady={onReady} />);

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0][0]).toMatchObject({ draw: expect.any(Function) });

    unmount();
    expect(onReady).toHaveBeenLastCalledWith(null);
  });

  it("does not require a caller that wants one", () => {
    expect(() => render(<Atmosphere {...props} />)).not.toThrow();
  });
});
