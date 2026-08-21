"use client";

import { useCallback, useEffect } from "react";
import { useEditor } from "./store";
import { reorderScenes, saveScene, updatePresentation } from "@/lib/data/actions";

/**
 * Autosave.
 *
 * Flushes dirty scenes on a debounce, plus an immediate flush on blur and on
 * `visibilitychange` so closing a laptop lid does not cost the last edit.
 *
 * Saves are serialised through `inFlight` so two flushes can never race, and
 * every scene save carries the revision it is persisting — the store refuses to
 * clear a dirty flag if a newer edit arrived while the request was open.
 */

const DEBOUNCE_MS = 900;
/** Hard ceiling so a long stream of edits still reaches the server. */
const MAX_WAIT_MS = 5000;

/** One flush at a time per presentation; a request arriving mid-flight queues. */
const inFlight = new Set<string>();
const queued = new Set<string>();

export async function flushEditor(presentationId: string): Promise<void> {
  if (inFlight.has(presentationId)) {
    queued.add(presentationId);
    return;
  }

  const state = useEditor.getState();
  const dirtyScenes = [...state.dirtyScenes];
  const needsOrder = state.dirtyOrder;
  const needsPresentation = state.dirtyPresentation;

  if (!dirtyScenes.length && !needsOrder && !needsPresentation) return;

  inFlight.add(presentationId);
  state.setSaveState("saving");

  try {
    const errors: string[] = [];

    // Scene bodies first: ordering references scenes that must already exist.
    await Promise.all(
      dirtyScenes.map(async (sceneId) => {
        const scene = useEditor.getState().document.scenes.find((s) => s.id === sceneId);
        if (!scene) return; // Deleted locally; nothing to persist.

        const revision = useEditor.getState().revisionOf(sceneId);
        const result = await saveScene({
          id: scene.id,
          presentationId,
          title: scene.title,
          content: scene.content,
          speakerNotes: scene.speakerNotes,
          durationSeconds: scene.durationSeconds,
          sectionId: scene.sectionId,
        });

        if (result.ok) {
          useEditor.getState().markSceneSaved(sceneId, revision, result.data.updatedAt);
        } else {
          errors.push(result.error);
        }
      }),
    );

    if (needsOrder) {
      const doc = useEditor.getState().document;
      const assignments: Record<string, string | null> = {};
      for (const scene of doc.scenes) assignments[scene.id] = scene.sectionId;

      const result = await reorderScenes({
        presentationId,
        sceneIds: doc.scenes.map((s) => s.id),
        sectionAssignments: assignments,
      });
      if (result.ok) useEditor.getState().markOrderSaved();
      else errors.push(result.error);
    }

    if (needsPresentation) {
      const p = useEditor.getState().document.presentation;
      const result = await updatePresentation({
        id: presentationId,
        title: p.title,
        description: p.description,
        themeId: p.themeId,
        aspectRatio: p.aspectRatio,
      });
      if (result.ok) useEditor.getState().markPresentationSaved();
      else errors.push(result.error);
    }

    const after = useEditor.getState();
    if (errors.length) {
      after.setSaveState("error", errors[0]);
    } else if (after.dirtyScenes.size || after.dirtyOrder || after.dirtyPresentation) {
      // More edits arrived mid-flight; stay dirty and let the next tick run.
      after.setSaveState("dirty");
    } else {
      after.setSaveState("saved");
    }
  } catch (error) {
    useEditor
      .getState()
      .setSaveState("error", error instanceof Error ? error.message : "Couldn't reach the server.");
  } finally {
    inFlight.delete(presentationId);
    if (queued.delete(presentationId)) {
      await flushEditor(presentationId);
    }
  }
}

export function useAutosave(presentationId: string) {
  const flush = useCallback(() => void flushEditor(presentationId), [presentationId]);

  // Debounced scheduler driven by the store's dirty state.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let firstDirtyAt: number | null = null;

    const schedule = () => {
      const { dirtyScenes, dirtyOrder, dirtyPresentation } = useEditor.getState();
      const hasWork = dirtyScenes.size > 0 || dirtyOrder || dirtyPresentation;

      if (!hasWork) {
        firstDirtyAt = null;
        clearTimeout(timer);
        return;
      }

      firstDirtyAt ??= Date.now();
      const waited = Date.now() - firstDirtyAt;
      const delay = waited >= MAX_WAIT_MS ? 0 : Math.min(DEBOUNCE_MS, MAX_WAIT_MS - waited);

      clearTimeout(timer);
      timer = setTimeout(() => void flushEditor(presentationId), delay);
    };

    schedule();
    const unsubscribe = useEditor.subscribe(schedule);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [presentationId]);

  // Save on tab hide and on page hide. `visibilitychange` is the only event
  // reliably delivered when a mobile browser backgrounds the tab.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flushEditor(presentationId);
    };
    const onPageHide = () => void flushEditor(presentationId);

    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [presentationId]);

  // Guard against losing genuinely unsaved work on navigation away.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const { dirtyScenes, dirtyOrder, dirtyPresentation, saveState } = useEditor.getState();
      const unsaved = dirtyScenes.size > 0 || dirtyOrder || dirtyPresentation;
      if (unsaved || saveState === "saving" || saveState === "error") {
        e.preventDefault();
        return "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return { flush };
}
