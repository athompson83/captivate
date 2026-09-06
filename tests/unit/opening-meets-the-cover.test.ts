import { describe, expect, it } from "vitest";
import type { Scene } from "@/lib/schema/presentation";
import { createSession } from "@/lib/present/session";
import { composeScene } from "@/lib/editor/layouts";
import { buildStepCount } from "@/lib/present/motion";

/**
 * Two openings, and how many clicks it costs to get past them.
 *
 * Captivate has two things that happen before the first idea is on screen, and
 * they were designed a fortnight apart:
 *
 *  - **the opening beat** — the camera holds over the whole argument, then
 *    dives to the first scene. Time-driven: it resolves on its own after
 *    `OPENING_MS`, and a press during it *is* the dive;
 *  - **the cover's veil** — a full-bleed photograph with a display title over
 *    it, which the first advance on that scene lifts to reveal the title
 *    slide beneath.
 *
 * Nobody had written down what happens when both are in front of a presenter,
 * and the failure mode if they compound is specific: two clicks that look like
 * they do nothing, in the first ten seconds of a talk, in front of a room.
 *
 * They do not compound in the case that matters. A presenter who lets the beat
 * play — which is what the beat is for — spends their first press lifting the
 * cover. A presenter who is impatient spends it landing, which is the ordinary
 * "click to skip the intro" idiom rather than an extra advance: the beat was
 * going to end by itself either way.
 *
 * This is a contract test rather than a change. It exists so that neither half
 * can be adjusted later without someone noticing what it costs the other.
 */

const cover = (): Scene["content"] =>
  composeScene("cover", {
    eyebrow: "A lecture",
    heading: "Ninety seconds without oxygen",
    subheading: "What the first responder does before anyone else arrives.",
    media: { url: "https://example.test/hero.jpg", alt: "A road at dusk" },
  });

function scene(index: number, content: Scene["content"]): Scene {
  return {
    id: `00000000-0000-4000-8000-00000000000${index}`,
    presentationId: "22222222-2222-4222-8222-222222222222",
    sectionId: null,
    position: index,
    flowRole: "main",
    title: `Scene ${index}`,
    content,
    placement: { x: index * 120, y: 0, scale: 1, rotation: 0 },
    momentId: null,
    speakerNotes: "",
    durationSeconds: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const deck = () => [
  scene(0, cover()),
  scene(1, composeScene("statement", { heading: "It is a delivery problem" })),
];

const session = () =>
  createSession({
    presentationId: "33333333-3333-4333-8333-333333333333",
    scenes: deck(),
    role: "stage",
    establishSections: false,
  });

describe("the opening beat and the cover", () => {
  it("gives the cover a step to spend, so the veil has something to lift on", () => {
    // If the composed cover had no exit step, the "first advance lifts the
    // image" contract would be describing nothing.
    expect(buildStepCount(cover().elements)).toBeGreaterThan(1);
  });

  it("holds over the whole argument before the cover is even reached", () => {
    const api = session();
    expect(api.store.getState().opening).toBe(true);
    expect(api.store.getState().sceneIndex).toBe(0);
    expect(api.store.getState().step).toBe(0);
  });

  it("spends an impatient first press on landing, not on the veil", () => {
    const api = session();
    api.send("next");
    const state = api.store.getState();
    expect(state.opening).toBe(false);
    // The cover is still whole. Lifting it here would mean a presenter who
    // clicked early never saw the image at all.
    expect(state.step).toBe(0);
  });

  it("lifts the veil on the first press once the beat has played", () => {
    const api = session();
    // What the timer does when nobody touches anything.
    api.store.setState({ opening: false });
    api.send("next");
    expect(api.store.getState().step).toBe(1);
    expect(api.store.getState().sceneIndex).toBe(0);
  });

  it("costs a presenter who waits exactly one press to reach the title slide", () => {
    const api = session();
    api.store.setState({ opening: false });
    api.send("next");
    const state = api.store.getState();
    expect(state.sceneIndex).toBe(0);
    expect(state.step).toBe(1);
    // And the next press leaves the cover for the argument, rather than
    // finding one more thing to dismiss.
    api.send("next");
    expect(api.store.getState().sceneIndex).toBe(1);
  });
});
