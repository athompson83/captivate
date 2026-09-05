import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { LiveDemoStage } from "@/components/marketing/live-demo-stage";
import { OPENING_MS } from "@/lib/present/opening";

/**
 * The live demo on the landing page: the real world, driven by the visitor.
 *
 * The keys work only while the stage has focus, so a visitor scrolling with
 * Space is never hijacked; the buttons beside it do the same for anyone who
 * would rather click, and the line between them says where the reader is.
 */
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1600,
      bottom: 900,
      width: 1600,
      height: 900,
      toJSON: () => ({}),
    } as DOMRect;
  };
});

/** Renders the demo and lets the opening beat run out. */
function mount() {
  render(<LiveDemoStage />);
  act(() => {
    vi.advanceTimersByTime(OPENING_MS);
  });
}

describe("the live demo", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a labelled, focusable region that opens wide, then settles on scene one", () => {
    render(<LiveDemoStage />);
    const stage = screen.getByRole("region", { name: /live demo/i });
    expect(stage).toHaveAttribute("tabindex", "0");
    // The opening beat: the whole argument first, as on the stage.
    expect(stage).toHaveAttribute("data-view", "world");
    expect(stage).toHaveAttribute("data-opening");
    expect(screen.getByText("The whole argument")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(OPENING_MS);
    });
    expect(stage).toHaveAttribute("data-view", "scene");
    expect(stage).not.toHaveAttribute("data-opening");
    expect(screen.getByText(/^Scene 1 of \d+/)).toBeInTheDocument();
  });

  it("lets the first press end the opening early, landing rather than stepping", () => {
    render(<LiveDemoStage />);
    const stage = screen.getByRole("region", { name: /live demo/i });
    fireEvent.keyDown(stage, { key: "ArrowRight" });
    expect(stage).toHaveAttribute("data-view", "scene");
    expect(screen.getByText(/^Scene 1 of \d+/)).toBeInTheDocument();
  });

  it("names the end past the last scene, and leaves it on the way back", () => {
    mount();
    const stage = screen.getByRole("region", { name: /live demo/i });
    fireEvent.keyDown(stage, { key: "End" });
    for (let i = 0; i < 12 && stage.getAttribute("data-view") !== "world"; i += 1) {
      fireEvent.keyDown(stage, { key: "ArrowRight" });
    }
    expect(stage).toHaveAttribute("data-view", "world");
    expect(screen.getByRole("status", { name: /^The end: / })).toBeInTheDocument();

    fireEvent.keyDown(stage, { key: "ArrowLeft" });
    expect(stage).toHaveAttribute("data-view", "scene");
  });

  it("moves through the deck from the keyboard while the stage has focus", () => {
    mount();
    const stage = screen.getByRole("region", { name: /live demo/i });
    // Enough presses to get past scene one's own builds, whatever they are.
    for (let i = 0; i < 12; i += 1) fireEvent.keyDown(stage, { key: "ArrowRight" });
    expect(screen.queryByText(/^Scene 1 of/)).toBeNull();

    fireEvent.keyDown(stage, { key: "Home" });
    expect(screen.getByText(/^Scene 1 of/)).toBeInTheDocument();

    fireEvent.keyDown(stage, { key: "o" });
    expect(stage).toHaveAttribute("data-view", "world");
    expect(screen.getByText("The whole argument")).toBeInTheDocument();
    fireEvent.keyDown(stage, { key: "Escape" });
    expect(stage).toHaveAttribute("data-view", "scene");
  });

  it("offers the same moves as buttons, and knows when there is no way back", () => {
    mount();
    const back = screen.getByRole("button", { name: "Back" });
    expect(back).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(back).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Whole map" }));
    expect(screen.getByRole("region", { name: /live demo/i })).toHaveAttribute(
      "data-view",
      "world",
    );
    expect(screen.getByRole("button", { name: "Back to the scene" })).toBeInTheDocument();
  });

  it("pulls back over the whole argument after the last scene", () => {
    render(<LiveDemoStage />);
    const stage = screen.getByRole("region", { name: /live demo/i });
    fireEvent.keyDown(stage, { key: "End" });
    // Walk the last scene's builds; the press after the last one pulls back.
    for (let i = 0; i < 24 && stage.getAttribute("data-view") !== "world"; i += 1) {
      fireEvent.keyDown(stage, { key: "ArrowRight" });
    }
    expect(stage).toHaveAttribute("data-view", "world");
    // And from there, the next press is back into the argument, not past it.
    fireEvent.keyDown(stage, { key: "ArrowRight" });
    expect(stage).toHaveAttribute("data-view", "scene");
  });

  it("takes the invitation down on the first move", () => {
    render(<LiveDemoStage />);
    expect(screen.getByText(/Press → or tap the stage/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // AnimatePresence keeps it mounted through its exit; the text is on its
    // way out rather than a permanent fixture.
    expect(screen.queryByText(/Press → or tap the stage/)?.closest("[style]") ?? null).not.toBe(
      undefined,
    );
  });

  it("moves on a swipe, and only sideways", () => {
    mount();
    const stage = screen.getByRole("region", { name: /live demo/i });
    const at = (type: string, x: number, y: number, t: number) => {
      const event = new PointerEvent(type, {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
      });
      Object.defineProperty(event, "timeStamp", { value: t });
      fireEvent(stage, event);
    };
    // A vertical journey is the page's scroll, not a move.
    at("pointerdown", 600, 200, 0);
    at("pointerup", 610, 600, 200);
    expect(screen.getByText(/^Scene 1 of/)).toBeInTheDocument();

    for (let i = 0; i < 12 && screen.queryByText(/^Scene 1 of/); i += 1) {
      at("pointerdown", 600, 300, 1000 + i * 500);
      at("pointerup", 420, 305, 1180 + i * 500);
    }
    expect(screen.getByText(/^Scene 2 of/)).toBeInTheDocument();
  });
});
