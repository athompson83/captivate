import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  SWIPE_MAX_MS,
  SWIPE_MIN_PX,
  isControl,
  swipeOf,
  useCoarsePointer,
  useSwipe,
  type SwipeDirection,
} from "@/lib/present/swipe";

/**
 * A swipe is a short, mostly horizontal journey. Anything else is a scroll
 * or a hesitation, and the page must not move under a reader who was only
 * steadying their thumb.
 */
describe("swipeOf", () => {
  const at = (x: number, y: number, t: number) => ({ x, y, t });

  it("reads a quick horizontal journey, either way", () => {
    expect(swipeOf(at(200, 100, 0), at(100, 104, 180))).toBe("left");
    expect(swipeOf(at(100, 100, 0), at(200, 96, 180))).toBe("right");
  });

  it("ignores a journey that is too short, too slow, or too vertical", () => {
    expect(swipeOf(at(100, 100, 0), at(100 + SWIPE_MIN_PX - 1, 100, 100))).toBeNull();
    expect(swipeOf(at(100, 100, 0), at(300, 100, SWIPE_MAX_MS + 1))).toBeNull();
    // A diagonal: horizontal travel does not dominate.
    expect(swipeOf(at(100, 100, 0), at(180, 160, 100))).toBeNull();
    expect(swipeOf(at(100, 100, 0), at(100, 300, 100))).toBeNull();
  });
});

describe("isControl", () => {
  it("knows a click on a hotspot or a link from a click on the open stage", () => {
    document.body.innerHTML = `<div id="stage"><button id="hot"><span id="in">x</span></button><a id="link" href="/">y</a><p id="text">z</p></div>`;
    expect(isControl(document.getElementById("in"))).toBe(true);
    expect(isControl(document.getElementById("link"))).toBe(true);
    expect(isControl(document.getElementById("text"))).toBe(false);
    expect(isControl(null)).toBe(false);
  });
});

function Surface({ onSwipe }: { onSwipe: (d: SwipeDirection) => void }) {
  const swipe = useSwipe(onSwipe);
  return (
    <div
      data-testid="surface"
      onPointerDown={swipe.onPointerDown}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      onClick={() => {
        if (swipe.consume()) return;
        onSwipe("left");
      }}
    />
  );
}

const pointer = (
  el: Element,
  type: "pointerDown" | "pointerUp",
  init: { clientX: number; clientY: number; timeStamp?: number; pointerId?: number },
) => {
  const event = new PointerEvent(type === "pointerDown" ? "pointerdown" : "pointerup", {
    bubbles: true,
    clientX: init.clientX,
    clientY: init.clientY,
    pointerId: init.pointerId ?? 1,
    pointerType: "touch",
    isPrimary: true,
  });
  if (init.timeStamp !== undefined) {
    Object.defineProperty(event, "timeStamp", { value: init.timeStamp });
  }
  fireEvent(el, event);
};

describe("useSwipe", () => {
  it("reports a swipe and swallows the click that follows it", () => {
    const onSwipe = vi.fn();
    render(<Surface onSwipe={onSwipe} />);
    const el = screen.getByTestId("surface");
    pointer(el, "pointerDown", { clientX: 300, clientY: 200, timeStamp: 1000 });
    pointer(el, "pointerUp", { clientX: 120, clientY: 210, timeStamp: 1200 });
    expect(onSwipe).toHaveBeenCalledTimes(1);
    expect(onSwipe).toHaveBeenLastCalledWith("left");

    // The synthetic click after a touch swipe: consumed, not a second move.
    fireEvent.click(el);
    expect(onSwipe).toHaveBeenCalledTimes(1);
    // A later, real click is a move again.
    fireEvent.click(el);
    expect(onSwipe).toHaveBeenCalledTimes(2);
  });

  it("does not swallow a tap because an earlier swipe's click never came", () => {
    // Pointer events dispatched by a test, or a swipe the browser chose not
    // to follow with a click, left the flag armed and a real tap was eaten.
    const onSwipe = vi.fn();
    render(<Surface onSwipe={onSwipe} />);
    const el = screen.getByTestId("surface");
    pointer(el, "pointerDown", { clientX: 300, clientY: 200, timeStamp: 1000 });
    pointer(el, "pointerUp", { clientX: 120, clientY: 210, timeStamp: 1200 });
    expect(onSwipe).toHaveBeenCalledTimes(1);

    // A tap: a new journey, then its own click.
    pointer(el, "pointerDown", { clientX: 40, clientY: 200, timeStamp: 3000 });
    pointer(el, "pointerUp", { clientX: 42, clientY: 201, timeStamp: 3080 });
    fireEvent.click(el);
    expect(onSwipe).toHaveBeenCalledTimes(2);
  });

  it("does nothing for a tap, a vertical scroll, or a second pointer", () => {
    const onSwipe = vi.fn();
    render(<Surface onSwipe={onSwipe} />);
    const el = screen.getByTestId("surface");
    pointer(el, "pointerDown", { clientX: 300, clientY: 200, timeStamp: 0 });
    pointer(el, "pointerUp", { clientX: 304, clientY: 202, timeStamp: 80 });
    pointer(el, "pointerDown", { clientX: 300, clientY: 200, timeStamp: 500 });
    pointer(el, "pointerUp", { clientX: 310, clientY: 500, timeStamp: 700 });
    pointer(el, "pointerDown", { clientX: 300, clientY: 200, timeStamp: 1000, pointerId: 1 });
    pointer(el, "pointerUp", { clientX: 100, clientY: 200, timeStamp: 1100, pointerId: 2 });
    expect(onSwipe).not.toHaveBeenCalled();
  });
});

describe("useCoarsePointer", () => {
  const original = globalThis.matchMedia;
  afterEach(() => {
    globalThis.matchMedia = original;
  });

  it("says whether the primary pointer is a finger", () => {
    const stub = (matches: boolean) =>
      ((query: string) => ({
        matches: matches && query.includes("coarse"),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof matchMedia;

    function Probe() {
      return <span>{useCoarsePointer() ? "finger" : "pointer"}</span>;
    }
    globalThis.matchMedia = stub(false);
    const { unmount } = render(<Probe />);
    expect(screen.getByText("pointer")).toBeInTheDocument();
    unmount();
    globalThis.matchMedia = stub(true);
    render(<Probe />);
    expect(screen.getByText("finger")).toBeInTheDocument();
  });
});
