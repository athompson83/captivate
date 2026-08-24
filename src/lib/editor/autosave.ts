"use client";

import { useCallback, useEffect } from "react";
import { useEditor } from "./store";
import {
  reorderScenes,
  saveMoments,
  saveScene,
  updatePresentation,
  updateSection,
} from "@/lib/data/actions";

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

/**
 * Consecutive failures per presentation, used to back off.
 *
 * Without this a persistently failing save retries every debounce tick for as
 * long as the editor is open, which turns one broken request into a sustained
 * load on the server and a UI that flickers between "Saving" and "Couldn't
 * save". The work is never abandoned — the interval just widens.
 */
const failureCount = new Map<string, number>();
const retryAfter = new Map<string, number>();

const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 60_000;

function backoffDelay(failures: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
}

export async function flushEditor(
  presentationId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  if (inFlight.has(presentationId)) {
    queued.add(presentationId);
    return;
  }

  // Respect the backoff window unless the caller is an explicit user action
  // ("Save now", closing the tab), which should always try immediately.
  const notBefore = retryAfter.get(presentationId) ?? 0;
  if (!options.force && Date.now() < notBefore) return;

  const state = useEditor.getState();
  const dirtyScenes = [...state.dirtyScenes];
  const dirtySections = [...state.dirtySections];
  const dirtyMoments = [...state.dirtyMoments];
  const needsOrder = state.dirtyOrder;
  const needsPresentation = state.dirtyPresentation;

  if (
    !dirtyScenes.length &&
    !dirtySections.length &&
    !dirtyMoments.length &&
    !needsOrder &&
    !needsPresentation
  ) {
    return;
  }

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
          placement: scene.placement,
          flowRole: scene.flowRole,
        });

        if (result.ok) {
          useEditor.getState().markSceneSaved(sceneId, revision, result.data.updatedAt);
        } else {
          errors.push(result.error);
        }
      }),
    );

    if (dirtySections.length) {
      const saved: { id: string; revision: number }[] = [];
      await Promise.all(
        dirtySections.map(async (id) => {
          // Read from current state rather than one snapshot taken before the
          // loop: a rename made while an earlier section was still in flight
          // would otherwise be sent stale and acknowledged anyway.
          const state = useEditor.getState();
          const section = state.document.sections.find((s) => s.id === id);
          const revision = state.sectionRevisionOf(id);
          if (!section) {
            saved.push({ id, revision });
            return;
          }
          const result = await updateSection({
            id,
            title: section.title,
            label: section.label,
            purpose: section.purpose,
          });
          if (result.ok) saved.push({ id, revision });
          else errors.push(result.error);
        }),
      );
      useEditor.getState().markSectionsSaved(saved);
    }

    if (dirtyMoments.length) {
      /**
       * The whole map, every time — never only the moment that was touched.
       *
       * `captivate_replace_moments` deletes any moment the payload omits,
       * because that is how a deletion is persisted. A partial write is
       * therefore indistinguishable from "the author deleted everything
       * else", and sending one silently destroyed the rest of the argument
       * while every visible thing about the edit looked correct.
       *
       * A map is tens of rows. Writing all of it is cheap, and it is the only
       * payload whose meaning matches what the function does with it.
       */
      // Captured with the payload, not after it. A moment edited while this
      // request is open leaves the id in `dirtyMoments` — a Set cannot tell
      // the newer edit from the one being saved — so the revision is what
      // decides whether the acknowledgement still applies.
      const state = useEditor.getState();
      const doc = state.document;
      const revision = state.mapRevision;

      const result = await saveMoments({
        presentationId,
        moments: doc.moments.map((moment) => ({
          id: moment.id,
          movementId: moment.movementId,
          title: moment.title,
          role: moment.role,
          purpose: moment.purpose,
          takeaway: moment.takeaway,
          estimatedSeconds: moment.estimatedSeconds,
          evidence: moment.evidence,
          visualIntent: moment.visualIntent,
          instructions: moment.instructions,
          locked: moment.locked,
          position: moment.position,
        })),
      });

      if (result.ok) useEditor.getState().markMomentsSaved(dirtyMoments, revision);
      else errors.push(result.error);
    }

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
        journey: p.journey,
        targetSeconds: p.targetSeconds,
      });
      if (result.ok) useEditor.getState().markPresentationSaved();
      else errors.push(result.error);
    }

    const after = useEditor.getState();
    if (errors.length) {
      recordFailure(presentationId);
      after.setSaveState("error", errors[0]);
    } else {
      failureCount.delete(presentationId);
      retryAfter.delete(presentationId);

      if (
        after.dirtyScenes.size ||
        after.dirtySections.size ||
        after.dirtyMoments.size ||
        after.dirtyOrder ||
        after.dirtyPresentation
      ) {
        // More edits arrived mid-flight; stay dirty and let the next tick run.
        after.setSaveState("dirty");
      } else {
        after.setSaveState("saved");
      }
    }
  } catch (error) {
    recordFailure(presentationId);
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

function recordFailure(presentationId: string): void {
  const failures = (failureCount.get(presentationId) ?? 0) + 1;
  failureCount.set(presentationId, failures);
  retryAfter.set(presentationId, Date.now() + backoffDelay(failures));
}

/** Clears the backoff window, e.g. when the editor is opened afresh. */
export function resetAutosaveBackoff(presentationId: string): void {
  failureCount.delete(presentationId);
  retryAfter.delete(presentationId);
}

export function useAutosave(presentationId: string) {
  // An explicit save bypasses the backoff window: the user asked.
  const flush = useCallback(
    () => void flushEditor(presentationId, { force: true }),
    [presentationId],
  );

  // Debounced scheduler driven by the store's dirty state.
  useEffect(() => {
    resetAutosaveBackoff(presentationId);

    let timer: ReturnType<typeof setTimeout> | undefined;
    let firstDirtyAt: number | null = null;

    const schedule = () => {
      const { dirtyScenes, dirtySections, dirtyMoments, dirtyOrder, dirtyPresentation } =
        useEditor.getState();
      const hasWork =
        dirtyScenes.size > 0 ||
        dirtySections.size > 0 ||
        dirtyMoments.size > 0 ||
        dirtyOrder ||
        dirtyPresentation;

      if (!hasWork) {
        firstDirtyAt = null;
        clearTimeout(timer);
        return;
      }

      firstDirtyAt ??= Date.now();
      const waited = Date.now() - firstDirtyAt;
      const base = waited >= MAX_WAIT_MS ? 0 : Math.min(DEBOUNCE_MS, MAX_WAIT_MS - waited);
      // After a failure, wait out the backoff window instead of retrying on
      // every keystroke.
      const notBefore = retryAfter.get(presentationId) ?? 0;
      const delay = Math.max(base, notBefore - Date.now());

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
      if (document.visibilityState === "hidden") void flushEditor(presentationId, { force: true });
    };
    const onPageHide = () => void flushEditor(presentationId, { force: true });

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
      const { dirtyScenes, dirtySections, dirtyMoments, dirtyOrder, dirtyPresentation, saveState } =
        useEditor.getState();
      const unsaved =
        dirtyScenes.size > 0 ||
        dirtySections.size > 0 ||
        dirtyMoments.size > 0 ||
        dirtyOrder ||
        dirtyPresentation;
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
