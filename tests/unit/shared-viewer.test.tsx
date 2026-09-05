import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SharedViewer } from "@/components/present/shared-viewer";
import type { SharedDeck } from "@/lib/data/shared-payload";
import type { Scene } from "@/lib/schema/presentation";
import { exampleDeck, exampleId } from "@/lib/marketing/example-deck";
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
const status = () => document.querySelector('[aria-live="polite"]')?.textContent ?? "";

/** A touch journey across the stage, as a browser delivers it. */
function swipe(dx: number) {
  const el = view();
  const at = (type: string, x: number, t: number) => {
    const event = new PointerEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: 400,
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
    });
    Object.defineProperty(event, "timeStamp", { value: t });
    fireEvent(el, event);
  };
  at("pointerdown", 600, 1000);
  at("pointerup", 600 + dx, 1180);
}

/** The example with one aside hung off a hotspot on the first heading. */
function deckWithAside(): SharedDeck {
  const deck = exampleDeck();
  const detailId = exampleId(901);
  const [first, ...rest] = deck.scenes;
  const detail: Scene = {
    ...first,
    id: detailId,
    position: deck.scenes.length,
    title: "The aside",
    flowRole: "detail",
  };
  const withHotspot: Scene = {
    ...first,
    content: {
      ...first.content,
      elements: first.content.elements.map((element, i) =>
        i === 0 ? { ...element, hotspot: { targetSceneId: detailId, label: "" } } : element,
      ),
    },
  };
  return { ...deck, scenes: [withHotspot, ...rest, detail] };
}

/** Renders a deck and lets the opening beat run out. */
function mount(deck: SharedDeck = exampleDeck()) {
  render(<SharedViewer deck={deck} />);
  act(() => {
    vi.advanceTimersByTime(OPENING_MS);
  });
}

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

  it("moves on a swipe: left for on, right for back, and not on the click after", () => {
    mount();
    expect(status()).toMatch(/^Scene 1 of/);
    for (let i = 0; i < 12 && /^Scene 1 of/.test(status()); i += 1) swipe(-160);
    expect(status()).toMatch(/^Scene 2 of/);

    // The click a browser synthesises after the swipe is not a second move.
    fireEvent.click(view(), { clientX: 1200, clientY: 400 });
    expect(status()).toMatch(/^Scene 2 of/);

    // Back to the previous scene, fully built, in one swipe.
    swipe(160);
    expect(status()).toMatch(/^Scene 1 of/);
  });

  it("does not move on a scroll or a tap that went nowhere", () => {
    mount();
    const before = status();
    const el = view();
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
      fireEvent(el, event);
    };
    at("pointerdown", 600, 300, 0);
    at("pointerup", 620, 700, 200);
    at("pointerdown", 600, 300, 500);
    at("pointerup", 610, 302, 600);
    expect(status()).toBe(before);
  });

  it("lets a tap on a hotspot dive without also stepping straight back out", () => {
    mount(deckWithAside());
    const hotspot = screen.getByRole("button", { name: /^Expand: / });
    fireEvent.click(hotspot, { clientX: 1200, clientY: 400 });
    // Dived, and still inside: a second, bubbled advance would have surfaced.
    expect(status()).toMatch(/^Detail/);
  });
});
