import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SharedViewer } from "@/components/present/shared-viewer";
import { exampleDeck } from "@/lib/marketing/example-deck";
import { OPENING_MS } from "@/lib/present/opening";

/**
 * A share link opens and closes as the stage does: the whole argument for a
 * beat, then the first scene; past the last scene, the whole argument again,
 * named as the end. The browser suite walks the same deck for real; this pins
 * the state machine where it is cheap to do so.
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

const view = () => document.querySelector("[data-view]") as HTMLElement;
const press = (key: string) => fireEvent.keyDown(window, { key });

describe("the shared viewer", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens over the whole argument and settles on scene one", () => {
    render(<SharedViewer deck={exampleDeck()} />);
    expect(view()).toHaveAttribute("data-view", "world");
    expect(view()).toHaveAttribute("data-opening");
    act(() => {
      vi.advanceTimersByTime(OPENING_MS);
    });
    expect(view()).toHaveAttribute("data-view", "scene");
    expect(view()).not.toHaveAttribute("data-opening");
    expect(screen.getByText(/^Scene 1 of/)).toBeInTheDocument();
  });

  it("lands on the first press during the beat instead of stepping past it", () => {
    render(<SharedViewer deck={exampleDeck()} />);
    press("ArrowRight");
    expect(view()).toHaveAttribute("data-view", "scene");
    expect(screen.getByText(/^Scene 1 of/)).toBeInTheDocument();
  });

  it("names the end past the last scene, and only there", () => {
    const deck = exampleDeck();
    render(<SharedViewer deck={deck} />);
    act(() => {
      vi.advanceTimersByTime(OPENING_MS);
    });

    // Pulling back by hand on the last scene is not the end.
    press("End");
    press("o");
    expect(view()).toHaveAttribute("data-view", "world");
    expect(screen.queryByRole("status", { name: /^The end: / })).toBeNull();
    press("o");

    for (let i = 0; i < 12 && view().getAttribute("data-view") !== "world"; i += 1) {
      press("ArrowRight");
    }
    expect(view()).toHaveAttribute("data-view", "world");
    expect(screen.getByRole("status", { name: `The end: ${deck.title}` })).toBeInTheDocument();

    press("ArrowLeft");
    expect(view()).toHaveAttribute("data-view", "scene");
  });
});
