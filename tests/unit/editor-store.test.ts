import { beforeEach, describe, expect, it } from "vitest";
import {
  addElementToScene,
  duplicateElements,
  editElement,
  editSceneContent,
  insertScene,
  moveScene,
  removeElements,
  removeScene,
  reorderElement,
  updatePresentationMeta,
  updateSceneMeta,
  useEditor,
} from "@/lib/editor/store";
import { createElement } from "@/lib/editor/element-factory";
import { composeScene } from "@/lib/editor/layouts";
import { JOURNEY_DEFAULTS, type PresentationDocument, type Scene } from "@/lib/schema/presentation";

const PRESENTATION_ID = "00000000-0000-4000-8000-00000000aaaa";

function makeScene(id: string, position: number, title = `Scene ${position + 1}`): Scene {
  return {
    id,
    presentationId: PRESENTATION_ID,
    sectionId: null,
    placement: null,
    momentId: null,
    position,
    title,
    content: composeScene("bullets", { heading: title, bullets: ["a", "b"] }),
    speakerNotes: "",
    durationSeconds: null,
    flowRole: "main" as const,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function makeDocument(sceneCount = 3): PresentationDocument {
  return {
    presentation: {
      id: PRESENTATION_ID,
      ownerId: "00000000-0000-4000-8000-00000000bbbb",
      folderId: null,
      title: "Test deck",
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
    sections: [],
    moments: [],
    scenes: Array.from({ length: sceneCount }, (_, i) => makeScene(`scene-${i}`, i)),
  };
}

beforeEach(() => {
  useEditor.getState().init(makeDocument());
});

describe("initialisation", () => {
  it("selects the first scene and starts clean", () => {
    const state = useEditor.getState();
    expect(state.selection.sceneId).toBe("scene-0");
    expect(state.dirtyScenes.size).toBe(0);
    expect(state.past).toHaveLength(0);
    expect(state.saveState).toBe("idle");
  });
});

describe("mutations mark work dirty", () => {
  it("marks only the edited scene dirty", () => {
    updateSceneMeta("scene-1", { title: "Renamed" }, { label: "Rename scene" });

    const state = useEditor.getState();
    expect([...state.dirtyScenes]).toEqual(["scene-1"]);
    expect(state.saveState).toBe("dirty");
    expect(state.document.scenes[1].title).toBe("Renamed");
  });

  it("bumps the scene revision on every edit", () => {
    const before = useEditor.getState().revisionOf("scene-0");
    updateSceneMeta("scene-0", { title: "A" }, { label: "Rename" });
    updateSceneMeta("scene-0", { title: "B" }, { label: "Rename" });
    expect(useEditor.getState().revisionOf("scene-0")).toBe(before + 2);
  });

  it("marks presentation-level changes separately from scenes", () => {
    updatePresentationMeta({ themeId: "paper" }, { label: "Change theme" });
    const state = useEditor.getState();
    expect(state.dirtyPresentation).toBe(true);
    expect(state.dirtyScenes.size).toBe(0);
  });

  it("marks an undone journey change dirty so the revert is written", () => {
    // Autosave writes `journey` and `targetSeconds`, but the undo/redo diff
    // did not look at either — so reverting an arrangement or a running time
    // updated the store, looked right, and was gone on reload. Exactly the
    // shape of the section-rename and moment-edit losses before it.
    const before = useEditor.getState().document.presentation.journey.arrangement;
    updatePresentationMeta(
      { journey: { ...useEditor.getState().document.presentation.journey, arrangement: "spiral" } },
      { label: "Arrange" },
    );
    useEditor.getState().markPresentationSaved();
    expect(useEditor.getState().dirtyPresentation).toBe(false);

    useEditor.getState().undo();

    expect(useEditor.getState().document.presentation.journey.arrangement).toBe(before);
    expect(useEditor.getState().dirtyPresentation).toBe(true);
  });

  it("marks an undone target-duration change dirty too", () => {
    updatePresentationMeta({ targetSeconds: 2700 }, { label: "Set running time" });
    useEditor.getState().markPresentationSaved();

    useEditor.getState().undo();

    expect(useEditor.getState().dirtyPresentation).toBe(true);
  });
});

describe("save acknowledgement is revision-guarded", () => {
  it("clears the dirty flag when nothing changed during the save", () => {
    updateSceneMeta("scene-0", { title: "Saved" }, { label: "Rename" });
    const revision = useEditor.getState().revisionOf("scene-0");

    useEditor.getState().markSceneSaved("scene-0", revision, "2026-02-02T00:00:00Z");

    const state = useEditor.getState();
    expect(state.dirtyScenes.has("scene-0")).toBe(false);
    expect(state.document.scenes[0].updatedAt).toBe("2026-02-02T00:00:00Z");
  });

  it("keeps the scene dirty when a newer edit landed mid-flight", () => {
    // This is the data-loss case the guard exists for: a slow save must not
    // mark a scene clean that the user has since changed again.
    updateSceneMeta("scene-0", { title: "First" }, { label: "Rename" });
    const inFlightRevision = useEditor.getState().revisionOf("scene-0");

    updateSceneMeta("scene-0", { title: "Second" }, { label: "Rename" });

    useEditor.getState().markSceneSaved("scene-0", inFlightRevision, "2026-02-02T00:00:00Z");

    const state = useEditor.getState();
    expect(state.dirtyScenes.has("scene-0")).toBe(true);
    expect(state.document.scenes[0].title).toBe("Second");
    // The stale response must not stamp updatedAt either.
    expect(state.document.scenes[0].updatedAt).toBe("2026-01-01T00:00:00Z");
  });
});

describe("history", () => {
  it("undoes and redoes a single change", () => {
    updateSceneMeta("scene-0", { title: "Changed" }, { label: "Rename" });
    expect(useEditor.getState().document.scenes[0].title).toBe("Changed");

    useEditor.getState().undo();
    expect(useEditor.getState().document.scenes[0].title).toBe("Scene 1");

    useEditor.getState().redo();
    expect(useEditor.getState().document.scenes[0].title).toBe("Changed");
  });

  it("coalesces a typing burst into one history entry", () => {
    for (const title of ["S", "Sh", "Sho", "Shoc", "Shock"]) {
      updateSceneMeta("scene-0", { title }, { label: "Rename", coalesceKey: "title-scene-0" });
    }

    expect(useEditor.getState().past).toHaveLength(1);
    useEditor.getState().undo();
    expect(useEditor.getState().document.scenes[0].title).toBe("Scene 1");
  });

  it("does not coalesce edits with different keys", () => {
    updateSceneMeta("scene-0", { title: "A" }, { label: "Rename", coalesceKey: "k1" });
    updateSceneMeta("scene-1", { title: "B" }, { label: "Rename", coalesceKey: "k2" });
    expect(useEditor.getState().past).toHaveLength(2);
  });

  it("clears the redo stack once a new change is made", () => {
    updateSceneMeta("scene-0", { title: "A" }, { label: "Rename" });
    useEditor.getState().undo();
    expect(useEditor.getState().future).toHaveLength(1);

    updateSceneMeta("scene-0", { title: "B" }, { label: "Rename" });
    expect(useEditor.getState().future).toHaveLength(0);
  });

  it("re-marks scenes dirty after undo so the revert is persisted", () => {
    updateSceneMeta("scene-2", { title: "Changed" }, { label: "Rename" });
    const revision = useEditor.getState().revisionOf("scene-2");
    useEditor.getState().markSceneSaved("scene-2", revision, "2026-02-02T00:00:00Z");
    expect(useEditor.getState().dirtyScenes.size).toBe(0);

    useEditor.getState().undo();

    // Undo is a change like any other: it has to reach the database.
    expect(useEditor.getState().dirtyScenes.has("scene-2")).toBe(true);
    expect(useEditor.getState().saveState).toBe("dirty");
  });

  it("is a no-op when there is nothing to undo", () => {
    const before = useEditor.getState().document;
    useEditor.getState().undo();
    expect(useEditor.getState().document).toBe(before);
  });
});

describe("element operations", () => {
  it("adds an element and selects it", () => {
    const element = createElement("heading");
    addElementToScene("scene-0", element);

    const state = useEditor.getState();
    expect(state.document.scenes[0].content.elements.some((e) => e.id === element.id)).toBe(true);
    expect(state.selection.elementIds).toEqual([element.id]);
  });

  it("deletes selected elements and clears the selection", () => {
    const ids = useEditor.getState().document.scenes[0].content.elements.map((e) => e.id);
    removeElements("scene-0", ids);

    const state = useEditor.getState();
    expect(state.document.scenes[0].content.elements).toHaveLength(0);
    expect(state.selection.elementIds).toEqual([]);
  });

  it("duplicates with new ids and a visible offset", () => {
    const [original] = useEditor.getState().document.scenes[0].content.elements;
    duplicateElements("scene-0", [original.id]);

    const elements = useEditor.getState().document.scenes[0].content.elements;
    const copy = elements.find((e) => e.id !== original.id && e.type === original.type);

    expect(elements.length).toBeGreaterThan(1);
    expect(copy).toBeDefined();
    expect(copy!.id).not.toBe(original.id);
    expect(copy!.frame.x).toBeGreaterThan(original.frame.x);
  });

  it("edits one element without touching its siblings", () => {
    const elements = useEditor.getState().document.scenes[0].content.elements;
    const target = elements[0];
    const untouched = elements[1];

    editElement("scene-0", target.id, (el) => ({ ...el, opacity: 0.5 }), { label: "Opacity" });

    const after = useEditor.getState().document.scenes[0].content.elements;
    expect(after.find((e) => e.id === target.id)!.opacity).toBe(0.5);
    expect(after.find((e) => e.id === untouched.id)!.opacity).toBe(untouched.opacity);
  });

  it("reorders z-order without dropping elements", () => {
    const before = useEditor.getState().document.scenes[0].content.elements;
    const last = before[before.length - 1];

    reorderElement("scene-0", last.id, "back");

    const after = useEditor.getState().document.scenes[0].content.elements;
    expect(after).toHaveLength(before.length);
    expect(after[0].id).toBe(last.id);
  });

  it("marks a scene custom only through explicit geometry edits", () => {
    // Editing content should not silently detach a scene from its layout.
    editSceneContent("scene-0", (c) => ({ ...c, elements: c.elements.slice(0, 1) }), {
      label: "Trim",
    });
    expect(useEditor.getState().document.scenes[0].content.layout).toBe("bullets");
  });
});

describe("scene ordering", () => {
  it("inserts a scene after the anchor and renumbers", () => {
    const scene = makeScene("scene-new", 0, "Inserted");
    insertScene(scene, "scene-0");

    const scenes = useEditor.getState().document.scenes;
    expect(scenes.map((s) => s.id)).toEqual(["scene-0", "scene-new", "scene-1", "scene-2"]);
    expect(scenes.map((s) => s.position)).toEqual([0, 1, 2, 3]);
    expect(useEditor.getState().dirtyOrder).toBe(true);
  });

  it("appends when there is no anchor", () => {
    insertScene(makeScene("scene-new", 0, "Appended"), null);
    expect(useEditor.getState().document.scenes.at(-1)!.id).toBe("scene-new");
  });

  it("moves a scene and renumbers every position", () => {
    moveScene("scene-2", 0);
    const scenes = useEditor.getState().document.scenes;
    expect(scenes.map((s) => s.id)).toEqual(["scene-2", "scene-0", "scene-1"]);
    expect(scenes.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it("reassigns the section when a move specifies one", () => {
    moveScene("scene-0", 2, "section-x");
    const moved = useEditor.getState().document.scenes.find((s) => s.id === "scene-0");
    expect(moved!.sectionId).toBe("section-x");
    expect(useEditor.getState().dirtyScenes.has("scene-0")).toBe(true);
  });

  it("selects a neighbour after deleting the current scene", () => {
    useEditor.getState().select({ sceneId: "scene-1" });
    removeScene("scene-1");

    const state = useEditor.getState();
    expect(state.document.scenes.map((s) => s.id)).toEqual(["scene-0", "scene-2"]);
    expect(state.selection.sceneId).toBe("scene-2");
  });

  it("selects the previous scene when deleting the last one", () => {
    useEditor.getState().select({ sceneId: "scene-2" });
    removeScene("scene-2");
    expect(useEditor.getState().selection.sceneId).toBe("scene-1");
  });
});
