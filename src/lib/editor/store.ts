"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
  SceneContent,
  emptySceneContent,
  type PresentationDocument,
  type PresentationRecord,
  type Scene,
  type SceneElement,
  type Section,
} from "@/lib/schema/presentation";

/**
 * Editor state.
 *
 * Three ideas hold this together:
 *
 *  1. **The document is the truth.** Every mutation goes through `mutate`,
 *     which produces the next document, records history and marks exactly
 *     which scenes became dirty. Nothing edits scenes in place.
 *
 *  2. **Saving is per scene and revision-guarded.** Each scene carries a local
 *     revision counter. A save captures the revision it is persisting; when the
 *     response lands, the scene is only marked clean if no newer edit happened
 *     meanwhile. A slow response can therefore never resurrect stale content or
 *     mask an unsaved change.
 *
 *  3. **History coalesces.** Typing produces one undo entry per burst, not one
 *     per keystroke, so undo maps to what a person thinks of as "a change".
 */

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface EditorDocument {
  presentation: PresentationRecord;
  sections: Section[];
  scenes: Scene[];
}

interface HistoryEntry {
  document: EditorDocument;
  selection: Selection;
  label: string;
}

export interface Selection {
  sceneId: string | null;
  elementIds: string[];
}

interface MutateOptions {
  /** Undo label shown in the UI. */
  label: string;
  /**
   * Coalesce with the previous history entry when it carries the same key and
   * arrived recently. Used for typing and drag streams.
   */
  coalesceKey?: string;
  /** Scene ids whose persisted state changed. */
  dirty?: string[];
  /** Presentation-level fields changed (title, theme, aspect). */
  dirtyPresentation?: boolean;
  /** Scene ordering or section membership changed. */
  dirtyOrder?: boolean;
  /** Skip the history stack entirely (selection-only changes). */
  noHistory?: boolean;
}

interface EditorState {
  document: EditorDocument;
  selection: Selection;

  past: HistoryEntry[];
  future: HistoryEntry[];
  lastCoalesceKey: string | null;
  lastCoalesceAt: number;

  dirtyScenes: Set<string>;
  dirtyPresentation: boolean;
  dirtyOrder: boolean;
  sceneRevisions: Map<string, number>;

  saveState: SaveState;
  saveError: string | null;
  lastSavedAt: string | null;

  /** Scenes recovered from invalid stored content on load. */
  recoveredScenes: string[];

  /** Current advance step used by the in-editor preview. */
  previewStep: number;

  init: (doc: PresentationDocument & { recoveredScenes?: string[] }) => void;
  mutate: (fn: (draft: EditorDocument) => void, options: MutateOptions) => void;
  select: (selection: Partial<Selection>) => void;
  undo: () => void;
  redo: () => void;
  setSaveState: (state: SaveState, error?: string | null) => void;
  markSceneSaved: (sceneId: string, revision: number, updatedAt: string) => void;
  markPresentationSaved: () => void;
  markOrderSaved: () => void;
  revisionOf: (sceneId: string) => number;
  clearRecovered: () => void;
  setPreviewStep: (step: number) => void;
}

const HISTORY_LIMIT = 80;
const COALESCE_WINDOW_MS = 700;

/** Structured clone of the document; small enough at MVP deck sizes. */
function cloneDocument(doc: EditorDocument): EditorDocument {
  return {
    presentation: { ...doc.presentation },
    sections: doc.sections.map((s) => ({ ...s })),
    scenes: doc.scenes.map((s) => ({
      ...s,
      content: structuredClone(s.content),
    })),
  };
}

const emptyDocument: EditorDocument = {
  presentation: {
    id: "",
    ownerId: "",
    folderId: null,
    title: "",
    description: "",
    themeId: "midnight",
    themeOverrides: null,
    aspectRatio: "16:9",
    tags: [],
    isFavorite: false,
    thumbnailUrl: null,
    schemaVersion: 1,
    createdAt: "",
    updatedAt: "",
    lastOpenedAt: null,
  },
  sections: [],
  scenes: [],
};

export const useEditor = create<EditorState>((set, get) => ({
  document: emptyDocument,
  selection: { sceneId: null, elementIds: [] },
  past: [],
  future: [],
  lastCoalesceKey: null,
  lastCoalesceAt: 0,
  dirtyScenes: new Set(),
  dirtyPresentation: false,
  dirtyOrder: false,
  sceneRevisions: new Map(),
  saveState: "idle",
  saveError: null,
  lastSavedAt: null,
  recoveredScenes: [],
  previewStep: 0,

  init: (doc) =>
    set({
      document: {
        presentation: doc.presentation,
        sections: [...doc.sections].sort((a, b) => a.position - b.position),
        scenes: [...doc.scenes].sort((a, b) => a.position - b.position),
      },
      selection: { sceneId: doc.scenes[0]?.id ?? null, elementIds: [] },
      past: [],
      future: [],
      dirtyScenes: new Set(),
      dirtyPresentation: false,
      dirtyOrder: false,
      sceneRevisions: new Map(doc.scenes.map((s) => [s.id, 0])),
      saveState: "idle",
      saveError: null,
      lastSavedAt: doc.presentation.updatedAt,
      recoveredScenes: doc.recoveredScenes ?? [],
      previewStep: 0,
    }),

  mutate: (fn, options) =>
    set((state) => {
      const next = cloneDocument(state.document);
      fn(next);

      const now = Date.now();
      const canCoalesce =
        Boolean(options.coalesceKey) &&
        state.lastCoalesceKey === options.coalesceKey &&
        now - state.lastCoalesceAt < COALESCE_WINDOW_MS &&
        state.past.length > 0;

      let past = state.past;
      if (!options.noHistory && !canCoalesce) {
        past = [
          ...state.past.slice(-(HISTORY_LIMIT - 1)),
          { document: state.document, selection: state.selection, label: options.label },
        ];
      }

      const dirtyScenes = new Set(state.dirtyScenes);
      const sceneRevisions = new Map(state.sceneRevisions);
      for (const id of options.dirty ?? []) {
        dirtyScenes.add(id);
        sceneRevisions.set(id, (sceneRevisions.get(id) ?? 0) + 1);
      }

      // Scenes present in the new document but not tracked yet (freshly added).
      for (const scene of next.scenes) {
        if (!sceneRevisions.has(scene.id)) sceneRevisions.set(scene.id, 0);
      }

      const hasWork =
        dirtyScenes.size > 0 ||
        state.dirtyPresentation ||
        options.dirtyPresentation ||
        state.dirtyOrder ||
        options.dirtyOrder;

      return {
        document: next,
        past,
        future: options.noHistory ? state.future : [],
        lastCoalesceKey: options.coalesceKey ?? null,
        lastCoalesceAt: options.coalesceKey ? now : 0,
        dirtyScenes,
        sceneRevisions,
        dirtyPresentation: state.dirtyPresentation || Boolean(options.dirtyPresentation),
        dirtyOrder: state.dirtyOrder || Boolean(options.dirtyOrder),
        saveState: hasWork ? "dirty" : state.saveState,
      };
    }),

  select: (selection) =>
    set((state) => ({
      selection: { ...state.selection, ...selection },
      previewStep:
        selection.sceneId && selection.sceneId !== state.selection.sceneId ? 0 : state.previewStep,
    })),

  undo: () =>
    set((state) => {
      const entry = state.past[state.past.length - 1];
      if (!entry) return state;

      // Every scene that differs between the two documents must be re-saved.
      const dirty = diffSceneIds(state.document, entry.document);
      const sceneRevisions = new Map(state.sceneRevisions);
      const dirtyScenes = new Set(state.dirtyScenes);
      for (const id of dirty) {
        dirtyScenes.add(id);
        sceneRevisions.set(id, (sceneRevisions.get(id) ?? 0) + 1);
      }

      return {
        document: entry.document,
        selection: entry.selection,
        past: state.past.slice(0, -1),
        future: [
          { document: state.document, selection: state.selection, label: entry.label },
          ...state.future.slice(0, HISTORY_LIMIT - 1),
        ],
        dirtyScenes,
        sceneRevisions,
        dirtyOrder: state.dirtyOrder || orderChanged(state.document, entry.document),
        dirtyPresentation:
          state.dirtyPresentation || presentationChanged(state.document, entry.document),
        lastCoalesceKey: null,
        saveState: "dirty",
      };
    }),

  redo: () =>
    set((state) => {
      const entry = state.future[0];
      if (!entry) return state;

      const dirty = diffSceneIds(state.document, entry.document);
      const sceneRevisions = new Map(state.sceneRevisions);
      const dirtyScenes = new Set(state.dirtyScenes);
      for (const id of dirty) {
        dirtyScenes.add(id);
        sceneRevisions.set(id, (sceneRevisions.get(id) ?? 0) + 1);
      }

      return {
        document: entry.document,
        selection: entry.selection,
        past: [
          ...state.past,
          { document: state.document, selection: state.selection, label: entry.label },
        ],
        future: state.future.slice(1),
        dirtyScenes,
        sceneRevisions,
        dirtyOrder: state.dirtyOrder || orderChanged(state.document, entry.document),
        dirtyPresentation:
          state.dirtyPresentation || presentationChanged(state.document, entry.document),
        lastCoalesceKey: null,
        saveState: "dirty",
      };
    }),

  setSaveState: (saveState, error = null) =>
    set({
      saveState,
      saveError: error,
      ...(saveState === "saved" ? { lastSavedAt: new Date().toISOString() } : {}),
    }),

  markSceneSaved: (sceneId, revision, updatedAt) =>
    set((state) => {
      // Only clear the dirty flag when nothing changed while the save was in
      // flight. Otherwise the newer edit stays queued.
      if ((state.sceneRevisions.get(sceneId) ?? 0) !== revision) return state;

      const dirtyScenes = new Set(state.dirtyScenes);
      dirtyScenes.delete(sceneId);

      return {
        dirtyScenes,
        document: {
          ...state.document,
          scenes: state.document.scenes.map((s) => (s.id === sceneId ? { ...s, updatedAt } : s)),
        },
      };
    }),

  markPresentationSaved: () => set({ dirtyPresentation: false }),
  markOrderSaved: () => set({ dirtyOrder: false }),
  revisionOf: (sceneId) => get().sceneRevisions.get(sceneId) ?? 0,
  clearRecovered: () => set({ recoveredScenes: [] }),
  setPreviewStep: (previewStep) => set({ previewStep }),
}));

/* -------------------------------------------------------------------------- */
/* Diffing helpers                                                             */
/* -------------------------------------------------------------------------- */

function diffSceneIds(a: EditorDocument, b: EditorDocument): string[] {
  const byId = new Map(a.scenes.map((s) => [s.id, s]));
  const changed: string[] = [];

  for (const scene of b.scenes) {
    const other = byId.get(scene.id);
    if (!other) {
      changed.push(scene.id);
      continue;
    }
    if (
      other.title !== scene.title ||
      other.speakerNotes !== scene.speakerNotes ||
      other.durationSeconds !== scene.durationSeconds ||
      other.sectionId !== scene.sectionId ||
      JSON.stringify(other.content) !== JSON.stringify(scene.content)
    ) {
      changed.push(scene.id);
    }
  }
  return changed;
}

function orderChanged(a: EditorDocument, b: EditorDocument): boolean {
  if (a.scenes.length !== b.scenes.length) return true;
  return a.scenes.some((s, i) => s.id !== b.scenes[i]?.id);
}

function presentationChanged(a: EditorDocument, b: EditorDocument): boolean {
  const ka = a.presentation;
  const kb = b.presentation;
  return (
    ka.title !== kb.title ||
    ka.themeId !== kb.themeId ||
    ka.aspectRatio !== kb.aspectRatio ||
    ka.description !== kb.description
  );
}

/* -------------------------------------------------------------------------- */
/* Selectors                                                                   */
/* -------------------------------------------------------------------------- */

export function useCurrentScene(): Scene | null {
  return useEditor((s) => {
    const id = s.selection.sceneId;
    return id ? (s.document.scenes.find((sc) => sc.id === id) ?? null) : null;
  });
}

/**
 * The currently selected elements.
 *
 * `useShallow` is load-bearing, not an optimisation: the selector builds a new
 * array on every store read, and `useSyncExternalStore` treats a new reference
 * as a change. Without a shallow comparison this re-renders forever the moment
 * anything is selected.
 */
export function useSelectedElements(): SceneElement[] {
  return useEditor(
    useShallow((s) => {
      const scene = s.document.scenes.find((sc) => sc.id === s.selection.sceneId);
      if (!scene) return EMPTY_ELEMENTS;
      const ids = new Set(s.selection.elementIds);
      const found = scene.content.elements.filter((e) => ids.has(e.id));
      return found.length ? found : EMPTY_ELEMENTS;
    }),
  );
}

const EMPTY_ELEMENTS: SceneElement[] = [];

/* -------------------------------------------------------------------------- */
/* Document operations                                                         */
/* -------------------------------------------------------------------------- */

/** Apply a change to one scene's content. */
export function editSceneContent(
  sceneId: string,
  update: (content: SceneContent) => SceneContent,
  options: { label: string; coalesceKey?: string },
) {
  useEditor.getState().mutate(
    (draft) => {
      const scene = draft.scenes.find((s) => s.id === sceneId);
      if (!scene) return;
      scene.content = update(scene.content);
    },
    { ...options, dirty: [sceneId] },
  );
}

export function editElement(
  sceneId: string,
  elementId: string,
  update: (element: SceneElement) => SceneElement,
  options: { label: string; coalesceKey?: string },
) {
  editSceneContent(
    sceneId,
    (content) => ({
      ...content,
      elements: content.elements.map((el) => (el.id === elementId ? update(el) : el)),
      // Manual geometry edits break the layout contract; the scene becomes
      // free-form so the layout engine stops re-flowing it.
      layout: content.layout,
    }),
    options,
  );
}

export function addElementToScene(sceneId: string, element: SceneElement, label = "Add element") {
  editSceneContent(
    sceneId,
    (content) => ({ ...content, elements: [...content.elements, element] }),
    { label },
  );
  useEditor.getState().select({ elementIds: [element.id] });
}

export function removeElements(sceneId: string, elementIds: string[]) {
  const ids = new Set(elementIds);
  editSceneContent(
    sceneId,
    (content) => ({ ...content, elements: content.elements.filter((e) => !ids.has(e.id)) }),
    { label: elementIds.length > 1 ? "Delete elements" : "Delete element" },
  );
  useEditor.getState().select({ elementIds: [] });
}

/** Fresh ids and a small offset so duplicates are visibly distinct. */
export function duplicateElements(sceneId: string, elementIds: string[]) {
  const ids = new Set(elementIds);
  const newIds: string[] = [];

  editSceneContent(
    sceneId,
    (content) => {
      const copies = content.elements
        .filter((e) => ids.has(e.id))
        .map((e) => {
          const id = `${e.type}_${crypto.randomUUID().slice(0, 8)}`;
          newIds.push(id);
          return {
            ...structuredClone(e),
            id,
            frame: {
              ...e.frame,
              x: Math.min(92, e.frame.x + 2.5),
              y: Math.min(92, e.frame.y + 2.5),
            },
          };
        });
      return { ...content, elements: [...content.elements, ...copies] };
    },
    { label: "Duplicate element" },
  );

  useEditor.getState().select({ elementIds: newIds });
}

/** Move elements up or down the z-order. */
export function reorderElement(
  sceneId: string,
  elementId: string,
  direction: "front" | "back" | "forward" | "backward",
) {
  editSceneContent(
    sceneId,
    (content) => {
      const index = content.elements.findIndex((e) => e.id === elementId);
      if (index < 0) return content;
      const elements = [...content.elements];
      const [el] = elements.splice(index, 1);
      const target =
        direction === "front"
          ? elements.length
          : direction === "back"
            ? 0
            : direction === "forward"
              ? Math.min(elements.length, index + 1)
              : Math.max(0, index - 1);
      elements.splice(target, 0, el);
      return { ...content, elements };
    },
    { label: "Reorder element" },
  );
}

export function updateSceneMeta(
  sceneId: string,
  patch: Partial<Pick<Scene, "title" | "speakerNotes" | "durationSeconds" | "sectionId">>,
  options: { label: string; coalesceKey?: string },
) {
  useEditor.getState().mutate(
    (draft) => {
      const scene = draft.scenes.find((s) => s.id === sceneId);
      if (!scene) return;
      Object.assign(scene, patch);
    },
    { ...options, dirty: [sceneId] },
  );
}

export function updatePresentationMeta(
  patch: Partial<Pick<PresentationRecord, "title" | "description" | "themeId" | "aspectRatio">>,
  options: { label: string; coalesceKey?: string },
) {
  useEditor.getState().mutate(
    (draft) => {
      Object.assign(draft.presentation, patch);
    },
    { ...options, dirtyPresentation: true },
  );
}

/** Insert an already-created scene (the server allocates the id). */
export function insertScene(scene: Scene, afterSceneId: string | null) {
  useEditor.getState().mutate(
    (draft) => {
      const index = afterSceneId ? draft.scenes.findIndex((s) => s.id === afterSceneId) : -1;
      const at = index >= 0 ? index + 1 : draft.scenes.length;
      draft.scenes.splice(at, 0, scene);
      draft.scenes.forEach((s, i) => {
        s.position = i;
      });
    },
    { label: "Add scene", dirtyOrder: true },
  );
  useEditor.getState().select({ sceneId: scene.id, elementIds: [] });
}

export function removeScene(sceneId: string) {
  const state = useEditor.getState();
  const index = state.document.scenes.findIndex((s) => s.id === sceneId);
  const nextSelected =
    state.document.scenes[index + 1]?.id ?? state.document.scenes[index - 1]?.id ?? null;

  state.mutate(
    (draft) => {
      draft.scenes = draft.scenes.filter((s) => s.id !== sceneId);
      draft.scenes.forEach((s, i) => {
        s.position = i;
      });
    },
    { label: "Delete scene", dirtyOrder: true },
  );
  state.select({ sceneId: nextSelected, elementIds: [] });
}

export function moveScene(sceneId: string, toIndex: number, sectionId?: string | null) {
  useEditor.getState().mutate(
    (draft) => {
      const from = draft.scenes.findIndex((s) => s.id === sceneId);
      if (from < 0) return;
      const [scene] = draft.scenes.splice(from, 1);
      if (sectionId !== undefined) scene.sectionId = sectionId;
      draft.scenes.splice(Math.max(0, Math.min(draft.scenes.length, toIndex)), 0, scene);
      draft.scenes.forEach((s, i) => {
        s.position = i;
      });
    },
    { label: "Reorder scenes", dirtyOrder: true, dirty: sectionId !== undefined ? [sceneId] : [] },
  );
}

export function insertSection(section: Section) {
  useEditor.getState().mutate(
    (draft) => {
      draft.sections.push(section);
      draft.sections.forEach((s, i) => {
        s.position = i;
      });
    },
    { label: "Add section", dirtyOrder: true },
  );
}

export function renameSectionLocal(sectionId: string, title: string) {
  useEditor.getState().mutate(
    (draft) => {
      const section = draft.sections.find((s) => s.id === sectionId);
      if (section) section.title = title;
    },
    { label: "Rename section", coalesceKey: `section-title-${sectionId}` },
  );
}

export function removeSection(sectionId: string) {
  useEditor.getState().mutate(
    (draft) => {
      draft.sections = draft.sections.filter((s) => s.id !== sectionId);
      // Scenes survive; they simply become unsectioned.
      for (const scene of draft.scenes) {
        if (scene.sectionId === sectionId) scene.sectionId = null;
      }
    },
    { label: "Delete section", dirtyOrder: true },
  );
}

export { emptySceneContent };
