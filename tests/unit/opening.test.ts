import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Scene } from "@/lib/schema/presentation";
import { createSession } from "@/lib/present/session";
import { OPENING_MS, opensWide, reducedMotion, useOpening } from "@/lib/present/opening";

/**
 * The show opens and closes on the whole of itself.
 *
 * On load the camera holds over the whole argument for a beat and dives to
 * the first scene; past the last scene the pull-back is marked as the end so
 * the stage can dress it. Both are session state, because the console and a
 * phone must agree with the stage about where the camera is.
 */

function scene(index: number, flowRole: Scene["flowRole"] = "main"): Scene {
  return {
    id: `00000000-0000-4000-8000-00000000000${index}`,
    presentationId: "22222222-2222-4222-8222-222222222222",
    sectionId: null,
    position: index,
    flowRole,
    title: `Scene ${index}`,
    content: { layout: "title", elements: [] } as unknown as Scene["content"],
    placement: { x: index * 120, y: 0, scale: 1, rotation: 0 },
    momentId: null,
    speakerNotes: "",
    durationSeconds: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const deck = () => [scene(0), scene(1), scene(2)];

const stage = (scenes: Scene[]) =>
  createSession({
    presentationId: "33333333-3333-4333-8333-333333333333",
    scenes,
    role: "stage",
    establishSections: false,
  });

const originalMatchMedia = globalThis.matchMedia;

function preferReducedMotion(matches: boolean) {
  globalThis.matchMedia = ((query: string) => ({
    matches: matches && query.includes("reduce"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof matchMedia;
}

afterEach(() => {
  vi.useRealTimers();
  globalThis.matchMedia = originalMatchMedia;
});

describe("the opening beat in the session", () => {
  it("holds over the whole argument, then dives to the first scene", () => {
    vi.useFakeTimers();
    const api = stage(deck());
    expect(api.store.getState().opening).toBe(true);
    expect(api.store.getState().overview).toBe(false);

    const detach = api.attach();
    vi.advanceTimersByTime(OPENING_MS - 1);
    expect(api.store.getState().opening).toBe(true);
    vi.advanceTimersByTime(1);

    const landed = api.store.getState();
    expect(landed.opening).toBe(false);
    expect(landed.sceneIndex).toBe(0);
    expect(landed.step).toBe(0);
    detach();
  });

  it("is ended at once by the first press, which lands rather than steps", () => {
    vi.useFakeTimers();
    const api = stage(deck());
    const detach = api.attach();

    api.send("next");
    const state = api.store.getState();
    expect(state.opening).toBe(false);
    expect(state.sceneIndex).toBe(0);
    expect(state.step).toBe(0);

    // The next press is a real advance.
    api.send("next");
    expect(api.store.getState().sceneIndex).toBe(1);
    detach();
  });

  it("does not dive out from under a presenter who pulled back during it", () => {
    vi.useFakeTimers();
    const api = stage(deck());
    const detach = api.attach();

    api.send("overview");
    expect(api.store.getState().overview).toBe(true);
    expect(api.store.getState().opening).toBe(false);

    vi.advanceTimersByTime(OPENING_MS * 2);
    expect(api.store.getState().overview).toBe(true);
    detach();
  });

  it("is a cut under reduced motion", () => {
    vi.useFakeTimers();
    preferReducedMotion(true);
    const api = stage(deck());
    const detach = api.attach();
    vi.advanceTimersByTime(0);
    expect(api.store.getState().opening).toBe(false);
    detach();
  });

  it("has nothing to show for a single scene", () => {
    expect(opensWide(1)).toBe(false);
    expect(opensWide(2)).toBe(true);
    expect(stage([scene(0)]).store.getState().opening).toBe(false);
    // Asides are not part of the running order, so they do not count.
    expect(stage([scene(0), scene(1, "detail")]).store.getState().opening).toBe(false);
  });

  it("is torn down with the session", () => {
    vi.useFakeTimers();
    const api = stage(deck());
    const detach = api.attach();
    detach();
    vi.advanceTimersByTime(OPENING_MS * 2);
    // Nothing fired after teardown; the next attach schedules its own beat.
    expect(api.store.getState().opening).toBe(true);
    const again = api.attach();
    vi.advanceTimersByTime(OPENING_MS);
    expect(api.store.getState().opening).toBe(false);
    again();
  });
});

describe("the end of the show", () => {
  it("marks the pull-back past the last scene as the end, and any move clears it", () => {
    const api = stage(deck());
    api.send("last");
    api.send("next");
    expect(api.store.getState()).toMatchObject({ overview: true, ended: true });

    api.send("prev");
    expect(api.store.getState()).toMatchObject({ overview: false, ended: false, sceneIndex: 2 });

    api.send("next");
    expect(api.store.getState().ended).toBe(true);
    api.send("goto", 0);
    expect(api.store.getState()).toMatchObject({ ended: false, sceneIndex: 0 });
  });

  it("is not the same as pulling back on the last scene", () => {
    const api = stage(deck());
    api.send("last");
    api.send("overview");
    expect(api.store.getState()).toMatchObject({ overview: true, ended: false });
    api.send("overview");
    expect(api.store.getState().overview).toBe(false);
  });

  it("does not survive an advance from the closing image", () => {
    const api = stage(deck());
    api.send("last");
    api.send("next");
    api.send("next");
    expect(api.store.getState()).toMatchObject({ overview: false, ended: false });
  });
});

describe("reducedMotion", () => {
  it("reads the media query, and is false without one", () => {
    preferReducedMotion(false);
    expect(reducedMotion()).toBe(false);
    preferReducedMotion(true);
    expect(reducedMotion()).toBe(true);
  });
});

describe("useOpening", () => {
  it("opens, settles on its own after the beat, and settles early on demand", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useOpening(5));
    expect(result.current.opening).toBe(true);
    act(() => {
      vi.advanceTimersByTime(OPENING_MS);
    });
    expect(result.current.opening).toBe(false);

    const early = renderHook(() => useOpening(5));
    act(() => early.result.current.settle());
    expect(early.result.current.opening).toBe(false);
    act(() => {
      vi.advanceTimersByTime(OPENING_MS * 2);
    });
    expect(early.result.current.opening).toBe(false);
  });

  it("never opens a one-scene deck", () => {
    const { result } = renderHook(() => useOpening(1));
    expect(result.current.opening).toBe(false);
  });
});
