import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SWIPE_DISTANCE, classifySwipe, useSwipe } from "@/lib/present/swipe";

/**
 * A phone reads a shared deck by swiping, the way every carousel has taught
 * a thumb to; the tap convention stays for everyone else. What has to hold:
 * only a deliberate horizontal touch counts, a vertical drag is a scroll and
 * is left alone, and a swipe the browser also reports as a click moves the
 * deck once, not twice.
 */
describe("classifySwipe", () => {
  it("reads a leftward finger as forward and a rightward one as back", () => {
    expect(classifySwipe(-SWIPE_DISTANCE, 0)).toBe("forward");
    expect(classifySwipe(SWIPE_DISTANCE, 4)).toBe("back");
  });

  it("ignores a tap with a wobble", () => {
    expect(classifySwipe(-(SWIPE_DISTANCE - 1), 0)).toBeNull();
    expect(classifySwipe(10, -3)).toBeNull();
  });

  it("leaves a vertical drag to the page", () => {
    expect(classifySwipe(-60, 80)).toBeNull();
    expect(classifySwipe(-60, -50)).toBeNull();
    expect(classifySwipe(-90, 40)).toBe("forward");
  });
});

function Stage({ onSwipe, onTap }: { onSwipe: (s: string) => void; onTap: () => void }) {
  const swipe = useSwipe(onSwipe);
  return (
    <div
      data-testid="stage"
      onPointerDown={swipe.onPointerDown}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      onClick={() => {
        if (swipe.consumeSwipe()) return;
        onTap();
      }}
    />
  );
}

describe("useSwipe", () => {
  it("turns a touch swipe into a move and swallows the click that follows it", () => {
    const onSwipe = vi.fn();
    const onTap = vi.fn();
    render(<Stage onSwipe={onSwipe} onTap={onTap} />);
    const stage = screen.getByTestId("stage");

    fireEvent.pointerDown(stage, {
      pointerType: "touch",
      pointerId: 1,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerUp(stage, { pointerType: "touch", pointerId: 1, clientX: 180, clientY: 210 });
    fireEvent.click(stage);
    expect(onSwipe).toHaveBeenCalledWith("forward");
    expect(onTap).not.toHaveBeenCalled();

    // The next tap is a tap again: the swipe was consumed, not remembered.
    fireEvent.click(stage);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("does not answer a mouse drag, which is the presenter's ink or laser", () => {
    const onSwipe = vi.fn();
    render(<Stage onSwipe={onSwipe} onTap={() => {}} />);
    const stage = screen.getByTestId("stage");
    fireEvent.pointerDown(stage, {
      pointerType: "mouse",
      pointerId: 2,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerUp(stage, { pointerType: "mouse", pointerId: 2, clientX: 100, clientY: 200 });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it("forgets a touch that was cancelled or belongs to another pointer", () => {
    const onSwipe = vi.fn();
    render(<Stage onSwipe={onSwipe} onTap={() => {}} />);
    const stage = screen.getByTestId("stage");
    fireEvent.pointerDown(stage, {
      pointerType: "touch",
      pointerId: 3,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerCancel(stage);
    fireEvent.pointerUp(stage, { pointerType: "touch", pointerId: 3, clientX: 100, clientY: 200 });
    fireEvent.pointerDown(stage, {
      pointerType: "touch",
      pointerId: 4,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerUp(stage, { pointerType: "touch", pointerId: 5, clientX: 100, clientY: 200 });
    expect(onSwipe).not.toHaveBeenCalled();
  });
});
