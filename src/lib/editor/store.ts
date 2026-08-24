"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
  JOURNEY_DEFAULTS,
  type ScenePlacement,
  SceneContent,
  emptySceneContent,
  type PresentationDocument,
  type PresentationRecord,
  type Scene,
  type SceneElement,
  type Section,
} from "@/lib/schema/presentation";
import type { Moment } from "@/lib/schema/narrative";
import { changedMoments, deriveMap, moveMoment } from "@/lib/narrative/map";

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
  /** Movements, in product terms. Persisted as sections. */
  sections: Section[];
  scenes: Scene[];
  /** The narrative map's moments, ordered within each movement. */
  moments: Moment[];
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
  /** Section ids whose own fields (title, movement label) changed. */
  dirtySections?: string[];
  /** Moment ids whose narrative definition changed. */
  dirtyMoments?: string[];
  /** The whole map changed — reorder, reassignment, generation. */
  dirtyMap?: boolean;
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
  dirtySections: Set<string>;
  dirtyMoments: Set<string>;
  /** True until the derived map has been written for the first time. */
  momentsDerived: boolean;
  dirtyPresentation: boolean;
  dirtyOrder: boolean;
  sceneRevisions: Map<string, number>;
  sectionRevisions: Map<string, number>;
  /**
   * One counter for the whole narrative map.
   *
   * Per moment would be wrong here: `captivate_replace_moments` is handed the
   * map whole, so a save either persists the state of every moment at the
   * instant the payload was built or it does not. Anything edited while that
   * request is in flight has to stay dirty, whichever moment it was.
   */
  mapRevision: number;

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
  markSectionsSaved: (saved: { id: string; revision: number }[]) => void;
  markMomentsSaved: (momentIds: string[], revision: number) => void;
  markOrderSaved: () => void;
  revisionOf: (sceneId: string) => number;
  sectionRevisionOf: (sectionId: string) => number;
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
    moments: doc.moments.map((m) => ({ ...m, evidence: m.evidence.map((e) => ({ ...e })) })),
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
    journey: JOURNEY_DEFAULTS,
    targetSeconds: 0,
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
  moments: [],
};

export const useEditor = create<EditorState>((set, get) => ({
  document: emptyDocument,
  selection: { sceneId: null, elementIds: [] },
  past: [],
  future: [],
  lastCoalesceKey: null,
  lastCoalesceAt: 0,
  dirtyScenes: new Set(),
  dirtySections: new Set(),
  dirtyMoments: new Set(),
  momentsDerived: true,
  dirtyPresentation: false,
  dirtyOrder: false,
  sceneRevisions: new Map(),
  sectionRevisions: new Map(),
  mapRevision: 0,
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
        // Derived where a presentation has never had a map, so an existing
        // deck opens showing an honest argument rather than an empty page.
        // Derivation is deterministic, so the ids are stable across reloads
        // without writing anything until the author actually edits.
        moments:
          doc.moments && doc.moments.length > 0
            ? [...doc.moments].sort((a, b) => a.position - b.position)
            : deriveMap(doc.scenes, doc.sections).moments,
      },
      selection: { sceneId: doc.scenes[0]?.id ?? null, elementIds: [] },
      past: [],
      future: [],
      dirtyScenes: new Set(),
      dirtySections: new Set(),
      dirtyMoments: new Set(),
      // True where the map was inferred from existing scenes rather than
      // authored. The interface says so; nothing about saving depends on it.
      momentsDerived: !(doc.moments && doc.moments.length > 0),
      dirtyPresentation: false,
      dirtyOrder: false,
      sceneRevisions: new Map(doc.scenes.map((s) => [s.id, 0])),
      sectionRevisions: new Map(doc.sections.map((s) => [s.id, 0])),
      mapRevision: 0,
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
      const dirtySections = new Set(state.dirtySections);
      const sectionRevisions = new Map(state.sectionRevisions);
      for (const id of options.dirtySections ?? []) {
        dirtySections.add(id);
        sectionRevisions.set(id, (sectionRevisions.get(id) ?? 0) + 1);
      }
      for (const section of next.sections) {
        if (!sectionRevisions.has(section.id)) sectionRevisions.set(section.id, 0);
      }

      const dirtyMoments = new Set(state.dirtyMoments);
      for (const id of options.dirtyMoments ?? []) dirtyMoments.add(id);
      // A structural change to the map — reorder, reassignment, generation —
      // makes every moment's stored position suspect, so all of them are dirty.
      if (options.dirtyMap) for (const moment of next.moments) dirtyMoments.add(moment.id);
      const touchedMap = Boolean(options.dirtyMoments?.length) || Boolean(options.dirtyMap);
      const mapRevision = touchedMap ? state.mapRevision + 1 : state.mapRevision;
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
        dirtySections.size > 0 ||
        dirtyMoments.size > 0 ||
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
        dirtySections,
        dirtyMoments,
        sceneRevisions,
        sectionRevisions,
        mapRevision,
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

      // Everything that differs between the two documents must be re-saved.
      // Scenes alone was not enough: an undone moment edit or movement
      // rename reverted in the store and was never written, which is the
      // same silent loss the dirty flags exist to prevent.
      const dirty = diffSceneIds(state.document, entry.document);
      const sceneRevisions = new Map(state.sceneRevisions);
      const dirtyScenes = new Set(state.dirtyScenes);
      for (const id of dirty) {
        dirtyScenes.add(id);
        sceneRevisions.set(id, (sceneRevisions.get(id) ?? 0) + 1);
      }

      const dirtyMoments = new Set(state.dirtyMoments);
      const changedMoments = diffMomentIds(state.document, entry.document);
      for (const id of changedMoments) dirtyMoments.add(id);

      const dirtySections = new Set(state.dirtySections);
      const sectionRevisions = new Map(state.sectionRevisions);
      for (const id of diffSectionIds(state.document, entry.document)) {
        dirtySections.add(id);
        sectionRevisions.set(id, (sectionRevisions.get(id) ?? 0) + 1);
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
        dirtyMoments,
        dirtySections,
        sceneRevisions,
        sectionRevisions,
        mapRevision: changedMoments.length ? state.mapRevision + 1 : state.mapRevision,
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

      const dirtyMoments = new Set(state.dirtyMoments);
      const changedMoments = diffMomentIds(state.document, entry.document);
      for (const id of changedMoments) dirtyMoments.add(id);

      const dirtySections = new Set(state.dirtySections);
      const sectionRevisions = new Map(state.sectionRevisions);
      for (const id of diffSectionIds(state.document, entry.document)) {
        dirtySections.add(id);
        sectionRevisions.set(id, (sectionRevisions.get(id) ?? 0) + 1);
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
        dirtyMoments,
        dirtySections,
        sceneRevisions,
        sectionRevisions,
        mapRevision: changedMoments.length ? state.mapRevision + 1 : state.mapRevision,
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
  markMomentsSaved: (momentIds, revision) =>
    set((state) => {
      // The map moved while this was in flight, so the payload that just
      // succeeded is already out of date. Clearing here would drop the newer
      // edit: the id is in `dirtyMoments` either way, and a Set cannot tell
      // the second edit from the first.
      if (state.mapRevision !== revision) return state;

      const dirtyMoments = new Set(state.dirtyMoments);
      for (const id of momentIds) dirtyMoments.delete(id);
      // Once it has been written it is the author's map, not an inference.
      return { dirtyMoments, momentsDerived: state.momentsDerived && dirtyMoments.size > 0 };
    }),

  markSectionsSaved: (saved) =>
    set((state) => {
      const dirtySections = new Set(state.dirtySections);
      // Per section, for the same reason scenes are: one edited while the
      // request was open must survive the acknowledgement of the older one.
      for (const { id, revision } of saved) {
        if ((state.sectionRevisions.get(id) ?? 0) === revision) dirtySections.delete(id);
      }
      return { dirtySections };
    }),
  markOrderSaved: () => set({ dirtyOrder: false }),
  revisionOf: (sceneId) => get().sceneRevisions.get(sceneId) ?? 0,
  sectionRevisionOf: (sectionId) => get().sectionRevisions.get(sectionId) ?? 0,
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

/**
 * Ids of moments that must be written for `b` to be true on the server.
 *
 * A removal returns every surviving moment, because the write is a replacement:
 * the stored procedure deletes what the payload omits, so a partial payload
 * after undoing an addition would leave the undone moment on the server.
 */
function diffMomentIds(a: EditorDocument, b: EditorDocument): string[] {
  const removed = a.moments.some((moment) => !b.moments.some((other) => other.id === moment.id));
  if (removed) return b.moments.map((moment) => moment.id);
  return changedMoments(a.moments, b.moments).map((moment) => moment.id);
}

/**
 * Movements whose own fields differ.
 *
 * Only movements present on both sides: `updateSection` writes an existing row,
 * so a movement that undo brings back has nothing on the server to update, and
 * asking would surface an error the user cannot act on.
 */
function diffSectionIds(a: EditorDocument, b: EditorDocument): string[] {
  const byId = new Map(a.sections.map((section) => [section.id, section]));
  return b.sections
    .filter((section) => {
      const other = byId.get(section.id);
      if (!other) return false;
      return (
        other.title !== section.title ||
        other.label !== section.label ||
        other.purpose !== section.purpose
      );
    })
    .map((section) => section.id);
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
    ka.description !== kb.description ||
    ka.targetSeconds !== kb.targetSeconds ||
    // The journey is the arrangement, the travel and the depth — every one of
    // which autosave writes. Omitted here, undoing a change to any of them
    // reverted the store and marked nothing dirty, so the revert was never
    // saved: the same silent loss as the section rename and the moment edit
    // before it. Stringified because it is a small flat config parsed from one
    // schema, so its key order is fixed.
    JSON.stringify(ka.journey) !== JSON.stringify(kb.journey)
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
  patch: Partial<
    Pick<
      Scene,
      "title" | "speakerNotes" | "durationSeconds" | "sectionId" | "placement" | "flowRole"
    >
  >,
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

/**
 * Stamps a placement onto every scene at once.
 *
 * Applying an arrangement is a single edit, not one per scene: it has to be one
 * undo step, and a half-applied layout is worse than either whole one.
 */
export function applyPlacements(
  entries: { id: string; placement: ScenePlacement }[],
  label = "Arrange journey",
) {
  const byId = new Map(entries.map((e) => [e.id, e.placement]));
  useEditor.getState().mutate(
    (draft) => {
      for (const scene of draft.scenes) {
        const next = byId.get(scene.id);
        if (next) scene.placement = next;
      }
    },
    { label, dirty: entries.map((e) => e.id) },
  );
}

export function updatePresentationMeta(
  patch: Partial<
    Pick<
      PresentationRecord,
      "title" | "description" | "themeId" | "aspectRatio" | "journey" | "targetSeconds"
    >
  >,
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

/**
 * Edits a section's own fields.
 *
 * `dirtySections` is the point: without it this only ever changed the store,
 * autosave never looked at sections, and the server action that writes them was
 * dead code. Renaming a section looked like it worked and was gone on reload.
 */
export function updateSectionLocal(
  sectionId: string,
  patch: Partial<Pick<Section, "title" | "label" | "purpose">>,
  coalesceKey = `section-${sectionId}`,
) {
  useEditor.getState().mutate(
    (draft) => {
      const section = draft.sections.find((s) => s.id === sectionId);
      if (section) Object.assign(section, patch);
    },
    { label: "Rename section", coalesceKey, dirtySections: [sectionId] },
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

/* -------------------------------------------------------------------------- */
/* The narrative map                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Editing the argument.
 *
 * Every one of these marks the moments it touched dirty. Without that flag
 * autosave never looks at them and the action that writes them is dead code —
 * which is exactly how section renames were silently lost, so it is worth
 * being explicit about here.
 */
export function editMoment(
  momentId: string,
  patch: Partial<Omit<Moment, "id" | "presentationId">>,
  options: { label?: string; coalesceKey?: string } = {},
) {
  useEditor.getState().mutate(
    (draft) => {
      const moment = draft.moments.find((m) => m.id === momentId);
      if (moment) Object.assign(moment, patch);
    },
    {
      label: options.label ?? "Edit moment",
      coalesceKey: options.coalesceKey,
      dirtyMoments: [momentId],
    },
  );
}

export function addMoment(moment: Moment) {
  useEditor.getState().mutate(
    (draft) => {
      draft.moments.push(moment);
      // Renumber the movement it landed in so two moments never claim one slot.
      draft.moments
        .filter((m) => m.movementId === moment.movementId)
        .sort((a, b) => a.position - b.position)
        .forEach((m, index) => {
          m.position = index;
        });
    },
    { label: "Add moment", dirtyMap: true },
  );
}

export function removeMoment(momentId: string) {
  useEditor.getState().mutate(
    (draft) => {
      const removed = draft.moments.find((m) => m.id === momentId);
      draft.moments = draft.moments.filter((m) => m.id !== momentId);
      if (removed) {
        draft.moments
          .filter((m) => m.movementId === removed.movementId)
          .sort((a, b) => a.position - b.position)
          .forEach((m, index) => {
            m.position = index;
          });
      }
      // Scenes generated from it survive, unattached. Deleting a plan should
      // never delete the work made from it.
      for (const scene of draft.scenes) {
        if (scene.momentId === momentId) scene.momentId = null;
      }
    },
    { label: "Delete moment", dirtyMap: true },
  );
}

/** Moves a moment within or between movements, renumbering both. */
export function relocateMoment(momentId: string, toMovementId: string | null, toIndex: number) {
  useEditor.getState().mutate(
    (draft) => {
      draft.moments = moveMoment(draft.moments, momentId, toMovementId, toIndex);
    },
    { label: "Move moment", dirtyMap: true },
  );
}

/** Replaces the whole map. Used by generation and by applying a template. */
export function replaceMap(movements: Section[], moments: Moment[]) {
  useEditor.getState().mutate(
    (draft) => {
      draft.sections = movements;
      draft.moments = moments;
    },
    {
      label: "Apply narrative map",
      dirtyMap: true,
      dirtySections: movements.map((m) => m.id),
      dirtyOrder: true,
    },
  );
}
