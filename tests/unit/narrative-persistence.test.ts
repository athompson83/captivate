import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The narrative map has to survive a reload.
 *
 * This file exists because of a defect that shipped: renaming a section changed
 * the store, marked nothing dirty, and autosave never looked at sections — so
 * the server action that wrote them was dead code and the rename was gone on
 * reload. It looked completely fine until you refreshed.
 *
 * The map is a much larger surface for the same mistake — a moment has ten
 * editable fields, plus a movement, plus a position. So every editing entry
 * point is checked here for the thing that actually broke last time: does the
 * edit reach the server at all.
 */

type Sent = Record<string, unknown>;

type Ok<T> = { ok: true; data: T };
type Action<T> = (input: Sent) => Promise<Ok<T> | { ok: false; error: string }>;

const saveMoments = vi.fn<Action<{ written: number }>>(async () => ({
  ok: true,
  data: { written: 0 },
}));
const updateSection = vi.fn<Action<void>>(async () => ({ ok: true, data: undefined }));
const saveScene = vi.fn<Action<{ id: string; updatedAt: string }>>(async () => ({
  ok: true,
  data: { id: "scene-0", updatedAt: "2026-01-02T00:00:00Z" },
}));
const reorderScenes = vi.fn<Action<void>>(async () => ({ ok: true, data: undefined }));
const updatePresentation = vi.fn<Action<void>>(async () => ({ ok: true, data: undefined }));

vi.mock("@/lib/data/actions", () => ({
  saveMoments: (input: Sent) => saveMoments(input),
  updateSection: (input: Sent) => updateSection(input),
  saveScene: (input: Sent) => saveScene(input),
  reorderScenes: (input: Sent) => reorderScenes(input),
  updatePresentation: (input: Sent) => updatePresentation(input),
}));

const { flushEditor } = await import("@/lib/editor/autosave");
const {
  addMoment,
  editMoment,
  relocateMoment,
  removeMoment,
  replaceMap,
  updateSectionLocal,
  useEditor,
} = await import("@/lib/editor/store");
const { JOURNEY_DEFAULTS } = await import("@/lib/schema/presentation");
const { composeScene } = await import("@/lib/editor/layouts");

import type { PresentationDocument, Scene, Section } from "@/lib/schema/presentation";
import type { Moment } from "@/lib/schema/narrative";

const PRESENTATION = "00000000-0000-4000-8000-00000000aaaa";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function movement(id: string, label: string, position = 0): Section {
  return {
    id,
    presentationId: PRESENTATION,
    title: label,
    label,
    purpose: "",
    position,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function moment(overrides: Partial<Moment> & { id: string }): Moment {
  return {
    presentationId: PRESENTATION,
    movementId: null,
    title: "A beat",
    role: "claim",
    purpose: "",
    takeaway: "",
    estimatedSeconds: 60,
    evidence: [],
    visualIntent: "auto",
    instructions: "",
    locked: false,
    position: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function scene(id: string, position: number): Scene {
  return {
    id,
    presentationId: PRESENTATION,
    sectionId: null,
    placement: null,
    momentId: null,
    position,
    title: `Scene ${position}`,
    content: composeScene("statement", { heading: "A claim" }),
    speakerNotes: "",
    durationSeconds: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function document(moments: Moment[], movements: Section[] = []): PresentationDocument {
  return {
    presentation: {
      id: PRESENTATION,
      ownerId: uuid(2),
      folderId: null,
      title: "Sepsis",
      description: "",
      themeId: "midnight",
      themeOverrides: null,
      aspectRatio: "16:9",
      journey: JOURNEY_DEFAULTS,
      targetSeconds: 0,
      tags: [],
      isFavorite: false,
      thumbnailUrl: null,
      schemaVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      lastOpenedAt: null,
    },
    sections: movements,
    moments,
    scenes: [scene("scene-0", 0)],
  };
}

/** The moments the last flush actually sent to the server. */
function lastWrite(): { id: string; [key: string]: unknown }[] {
  const sent = saveMoments.mock.calls.at(-1)?.[0] as { moments?: unknown } | undefined;
  return (sent?.moments ?? []) as { id: string; [key: string]: unknown }[];
}

/** What the last `updateSection` call sent. */
function lastSection(): Sent {
  return (updateSection.mock.calls.at(-1)?.[0] ?? {}) as Sent;
}

beforeEach(() => {
  saveMoments.mockClear();
  updateSection.mockClear();
  useEditor
    .getState()
    .init(
      document(
        [
          moment({ id: uuid(11), movementId: uuid(1), position: 0, title: "First" }),
          moment({ id: uuid(12), movementId: uuid(1), position: 1, title: "Second" }),
        ],
        [movement(uuid(1), "OPEN")],
      ),
    );
});

afterEach(() => {
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */

describe("a moment edit reaches the server", () => {
  it("marks the edited moment dirty", () => {
    // The flag is the whole defect. Without it the store looks right, the
    // interface looks right, and nothing is ever written.
    editMoment(uuid(11), { title: "The call you remember" });
    expect([...useEditor.getState().dirtyMoments]).toEqual([uuid(11)]);
  });

  it("writes the whole map, not only the moment that changed", async () => {
    // `captivate_replace_moments` deletes any moment the payload omits,
    // because that is how a deletion is persisted. A partial write is
    // therefore indistinguishable from "the author deleted everything else" —
    // and a one-field edit silently destroyed the rest of the argument while
    // every visible thing about the edit looked correct.
    editMoment(uuid(11), { title: "Only this one changed" });
    await flushEditor(PRESENTATION, { force: true });

    expect(
      lastWrite()
        .map((m) => m.id)
        .sort(),
    ).toEqual([uuid(11), uuid(12)]);
  });

  it("writes the edit, then clears the flag", async () => {
    editMoment(uuid(11), { title: "The call you remember" });
    await flushEditor(PRESENTATION, { force: true });

    expect(saveMoments).toHaveBeenCalledTimes(1);
    expect(lastWrite().find((m) => m.id === uuid(11))?.title).toBe("The call you remember");
    expect(useEditor.getState().dirtyMoments.size).toBe(0);
    expect(useEditor.getState().saveState).toBe("saved");
  });

  it("writes every editable field, not only the title", async () => {
    // A field the interface offers but autosave does not send is the same bug
    // wearing a different hat.
    editMoment(uuid(11), {
      title: "The call",
      role: "hook",
      purpose: "Start inside a shift they have worked.",
      takeaway: "This is about my job.",
      estimatedSeconds: 95,
      visualIntent: "imagery",
      instructions: "Keep it to one sentence.",
      locked: true,
      evidence: [{ kind: "asset", id: uuid(50), label: "Audit.csv" }],
    });
    await flushEditor(PRESENTATION, { force: true });

    expect(lastWrite().find((m) => m.id === uuid(11))).toMatchObject({
      title: "The call",
      role: "hook",
      purpose: "Start inside a shift they have worked.",
      takeaway: "This is about my job.",
      estimatedSeconds: 95,
      visualIntent: "imagery",
      instructions: "Keep it to one sentence.",
      locked: true,
      evidence: [{ kind: "asset", id: uuid(50), label: "Audit.csv" }],
    });
  });

  it("does nothing when nothing changed", async () => {
    await flushEditor(PRESENTATION, { force: true });
    expect(saveMoments).not.toHaveBeenCalled();
  });

  it("keeps the flag set when the write fails, so the edit is not lost", async () => {
    saveMoments.mockResolvedValueOnce({ ok: false, error: "network" });
    editMoment(uuid(11), { title: "Unsaved" });
    await flushEditor(PRESENTATION, { force: true });

    expect(useEditor.getState().dirtyMoments.has(uuid(11))).toBe(true);
    expect(useEditor.getState().saveState).toBe("error");
  });
});

/* -------------------------------------------------------------------------- */

describe("structural edits reach the server too", () => {
  it("persists an added moment", async () => {
    addMoment(moment({ id: uuid(13), movementId: uuid(1), position: 2, title: "Third" }));
    await flushEditor(PRESENTATION, { force: true });
    expect(lastWrite().some((m) => m.id === uuid(13))).toBe(true);
  });

  it("persists a deletion by writing the map that survives it", async () => {
    // The stored procedure deletes moments absent from the payload, so a
    // deletion is a write of everything else — which means everything else has
    // to be in the payload.
    removeMoment(uuid(12));
    await flushEditor(PRESENTATION, { force: true });
    const written = lastWrite().map((m) => m.id);
    expect(written).toContain(uuid(11));
    expect(written).not.toContain(uuid(12));
  });

  it("persists a reorder, not just the moment that was dragged", async () => {
    relocateMoment(uuid(12), uuid(1), 0);
    await flushEditor(PRESENTATION, { force: true });

    const written = lastWrite();
    expect(written.find((m) => m.id === uuid(12))?.position).toBe(0);
    expect(written.find((m) => m.id === uuid(11))?.position).toBe(1);
  });

  it("persists a move between movements", async () => {
    relocateMoment(uuid(11), null, 0);
    await flushEditor(PRESENTATION, { force: true });
    expect(lastWrite().find((m) => m.id === uuid(11))?.movementId).toBeNull();
  });

  it("persists a whole map replaced by generation", async () => {
    replaceMap(
      [movement(uuid(2), "PROVE", 0)],
      [moment({ id: uuid(21), movementId: uuid(2), position: 0, title: "The data" })],
    );
    await flushEditor(PRESENTATION, { force: true });

    expect(lastWrite().map((m) => m.id)).toEqual([uuid(21)]);
    expect(updateSection).toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */

describe("a movement's own fields", () => {
  it("persists a movement rename — the original defect, on the map", async () => {
    updateSectionLocal(uuid(1), { title: "Why this matters", label: "OPEN" });
    await flushEditor(PRESENTATION, { force: true });

    expect(updateSection).toHaveBeenCalledTimes(1);
    expect(lastSection()).toMatchObject({
      id: uuid(1),
      title: "Why this matters",
      label: "OPEN",
    });
  });

  it("persists a movement's purpose, which is new and just as losable", async () => {
    updateSectionLocal(uuid(1), { purpose: "Earn attention before any content arrives." });
    await flushEditor(PRESENTATION, { force: true });

    expect(lastSection()).toMatchObject({
      purpose: "Earn attention before any content arrives.",
    });
  });
});

/* -------------------------------------------------------------------------- */

describe("a map derived from scenes", () => {
  it("writes the whole map on first save", async () => {
    useEditor.getState().init(document([]));
    expect(useEditor.getState().momentsDerived).toBe(true);

    replaceMap(
      [],
      [
        moment({ id: uuid(31), position: 0, title: "One" }),
        moment({ id: uuid(32), position: 1, title: "Two" }),
      ],
    );
    editMoment(uuid(31), { title: "One, edited" });
    await flushEditor(PRESENTATION, { force: true });

    expect(
      lastWrite()
        .map((m) => m.id)
        .sort(),
    ).toEqual([uuid(31), uuid(32)]);
  });

  it("stops being derived once it has been stored", async () => {
    useEditor.getState().init(document([]));
    addMoment(moment({ id: uuid(31), position: 0 }));
    await flushEditor(PRESENTATION, { force: true });
    expect(useEditor.getState().momentsDerived).toBe(false);
  });

  it("knows a loaded map is already stored", () => {
    // Presentations that already have moments must not be rewritten wholesale
    // every time one of them is nudged.
    expect(useEditor.getState().momentsDerived).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe("unsaved work is never reported as saved", () => {
  it("counts dirty moments in the has-unsaved-work check", () => {
    editMoment(uuid(11), { title: "Changed" });
    const state = useEditor.getState();
    expect(
      state.dirtyScenes.size ||
        state.dirtySections.size ||
        state.dirtyMoments.size ||
        state.dirtyOrder ||
        state.dirtyPresentation,
    ).toBeTruthy();
    expect(state.saveState).toBe("dirty");
  });

  it("stays dirty when an edit arrives while a save is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    saveMoments.mockImplementationOnce(async () => {
      await gate;
      return { ok: true, data: { written: 1 } };
    });

    editMoment(uuid(11), { title: "First edit" });
    // The flush snapshots the dirty set synchronously, so the second edit is
    // genuinely mid-flight rather than merely later.
    const flush = flushEditor(PRESENTATION, { force: true });
    editMoment(uuid(12), { title: "Arrived mid-flight" });
    release();
    await flush;

    expect(useEditor.getState().dirtyMoments.has(uuid(12))).toBe(true);
    expect(useEditor.getState().saveState).toBe("dirty");
  });
});

/* -------------------------------------------------------------------------- */

describe("undo covers the map", () => {
  it("restores a moment's previous wording and marks it dirty again", async () => {
    editMoment(uuid(11), { title: "The call you remember" });
    await flushEditor(PRESENTATION, { force: true });
    saveMoments.mockClear();

    useEditor.getState().undo();
    expect(useEditor.getState().document.moments.find((m) => m.id === uuid(11))?.title).toBe(
      "First",
    );

    await flushEditor(PRESENTATION, { force: true });
    expect(lastWrite().find((m) => m.id === uuid(11))?.title).toBe("First");
  });
});

describe("undo covers a movement rename", () => {
  it("re-saves the movement it reverted", async () => {
    updateSectionLocal(uuid(1), { title: "Why this matters" });
    await flushEditor(PRESENTATION, { force: true });
    updateSection.mockClear();

    useEditor.getState().undo();
    await flushEditor(PRESENTATION, { force: true });

    expect(updateSection).toHaveBeenCalledTimes(1);
    expect(lastSection()).toMatchObject({ title: "OPEN" });
  });
});
