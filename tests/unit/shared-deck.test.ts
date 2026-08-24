import { describe, expect, it } from "vitest";
import { parseSharedPayload } from "@/lib/data/shared-payload";
import { JOURNEY_DEFAULTS } from "@/lib/schema/presentation";

/**
 * The share-link payload parser is a public boundary: whatever the RPC hands
 * back is rendered to strangers with no session and no second check. These
 * tests pin the two properties that matter — a malformed payload dies as a
 * dead link rather than a crash, and nothing presenter-private can ride
 * through the parser even if a future RPC change were to leak it.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const sceneRow = (n: number, extra: Record<string, unknown> = {}) => ({
  id: uuid(n),
  sectionId: null,
  position: n,
  title: `Scene ${n}`,
  content: {
    version: 1,
    layout: "statement",
    background: { kind: "theme" },
    elements: [],
    transition: { type: "fade", duration: 0.6, direction: "left" },
    themeOverride: null,
  },
  placement: null,
  ...extra,
});

const payload = (overrides: Record<string, unknown> = {}) => ({
  presentation: {
    id: uuid(1),
    title: "Shared deck",
    description: "A deck",
    themeId: "midnight",
    aspectRatio: "16:9",
    journey: {},
  },
  sections: [{ id: uuid(2), title: "Open", label: "OPEN", position: 0 }],
  scenes: [sceneRow(3)],
  ...overrides,
});

describe("parseSharedPayload", () => {
  it("parses a well-formed payload into a viewable deck", () => {
    const deck = parseSharedPayload(payload());
    expect(deck).not.toBeNull();
    expect(deck!.title).toBe("Shared deck");
    expect(deck!.scenes).toHaveLength(1);
    expect(deck!.scenes[0].content.layout).toBe("statement");
    expect(deck!.sections[0].label).toBe("OPEN");
  });

  it("refuses payloads that are not deck-shaped", () => {
    expect(parseSharedPayload(null)).toBeNull();
    expect(parseSharedPayload("nope")).toBeNull();
    expect(parseSharedPayload({})).toBeNull();
    expect(parseSharedPayload(payload({ scenes: "not-an-array" }))).toBeNull();
    expect(
      parseSharedPayload({
        ...payload(),
        presentation: { title: "No id" },
      }),
    ).toBeNull();
  });

  it("never carries speaker notes, whatever the payload claims", () => {
    // The RPC does not select notes today; this pins that a future change
    // leaking them would still be stripped at the parse boundary.
    const deck = parseSharedPayload(
      payload({
        scenes: [
          sceneRow(3, { speakerNotes: "PRIVATE", speaker_notes: "ALSO PRIVATE" }),
        ],
      }),
    );
    expect(deck).not.toBeNull();
    expect(deck!.scenes[0].speakerNotes).toBe("");
    expect(JSON.stringify(deck)).not.toContain("PRIVATE");
  });

  it("salvages a corrupt scene body instead of dropping the deck", () => {
    const deck = parseSharedPayload(
      payload({ scenes: [sceneRow(3, { content: { layout: 999, elements: "??" } })] }),
    );
    expect(deck).not.toBeNull();
    expect(deck!.scenes).toHaveLength(1);
    // Whatever survived is schema-valid; the viewer never sees the corruption.
    expect(Array.isArray(deck!.scenes[0].content.elements)).toBe(true);
  });

  it("falls back to journey defaults when the stored journey is garbage", () => {
    const deck = parseSharedPayload(
      payload({
        presentation: {
          ...payload().presentation,
          journey: { travel: "teleport", pace: "NaN" },
        },
      }),
    );
    expect(deck).not.toBeNull();
    expect(deck!.journey.travel).toBe(JOURNEY_DEFAULTS.travel);
  });

  it("carries flowRole through, so the viewer can tell an aside from a beat", () => {
    const deck = parseSharedPayload(
      payload({ scenes: [sceneRow(3), sceneRow(4, { flowRole: "detail" })] }),
    );
    expect(deck!.scenes.map((s) => s.flowRole)).toEqual(["main", "detail"]);
  });

  it("reads a scene with no flowRole as part of the running order", () => {
    // A deck shared before detail scenes existed. Defaulting the other way
    // would empty out its running order and strand the reader on scene one.
    const deck = parseSharedPayload(payload({ scenes: [sceneRow(3)] }));
    expect(deck!.scenes[0].flowRole).toBe("main");
  });

  it("reads an unrecognised flowRole as part of the running order", () => {
    const deck = parseSharedPayload(payload({ scenes: [sceneRow(3, { flowRole: "sidebar" })] }));
    expect(deck!.scenes[0].flowRole).toBe("main");
  });

  it("drops an unusable placement rather than the scene", () => {
    const deck = parseSharedPayload(
      payload({ scenes: [sceneRow(3, { placement: { x: "wide", y: [] } })] }),
    );
    expect(deck).not.toBeNull();
    expect(deck!.scenes[0].placement).toBeNull();
  });
});
