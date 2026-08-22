"use client";

import { useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

/**
 * Debounced save for record-shaped edits.
 *
 * Pending writes are held in a map keyed by record id and merged, rather than a
 * single slot. That matters: editing a note's title and then its body within
 * one debounce window would otherwise send only the body and silently drop the
 * title. Editing two different records in quick succession saves both.
 *
 * It also carries the same durability guarantees as the editor's autosave:
 *  - flush when the tab is hidden or the page is unloaded, so closing a laptop
 *    mid-sentence does not cost the last paragraph;
 *  - warn before navigating away while anything is unsaved;
 *  - one flush at a time, with edits arriving mid-flight queued behind it.
 */
export function useDebouncedSave<T extends { id: string }>(
  save: (payload: T) => Promise<{ ok: boolean; error?: string }>,
  delayMs = 700,
) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef(new Map<string, T>());
  const inFlight = useRef(false);
  const saveRef = useRef(save);

  /**
   * Put a batch that did not save back where it came from.
   *
   * Without this the pending map was emptied the moment a request went out and
   * never refilled on failure: a transient error left nothing to retry, nothing
   * to flush on unload, and nothing for `beforeunload` to warn about — so a
   * paragraph that had only ever existed in the browser was gone on reload,
   * with an error toast the only trace.
   *
   * The whole batch goes back, including records that individually succeeded.
   * These writes are upserts, so re-sending one is free, and the alternative is
   * deciding which half of a failed batch to trust.
   */
  const requeue = (batch: T[]) => {
    for (const payload of batch) {
      const newer = pending.current.get(payload.id);
      // Anything typed while the request was open already supersedes this.
      pending.current.set(payload.id, newer ? { ...payload, ...newer } : payload);
    }
  };

  const run = async (): Promise<void> => {
    if (inFlight.current || pending.current.size === 0) return;

    const batch = [...pending.current.values()];
    pending.current = new Map();
    inFlight.current = true;
    setStatus("saving");

    let failed = false;
    try {
      const results = await Promise.all(batch.map((payload) => saveRef.current(payload)));
      const failure = results.find((r) => !r.ok);

      if (failure) {
        failed = true;
        requeue(batch);
        setError(failure.error ?? "That couldn't be saved.");
        setStatus("error");
      } else {
        setError(null);
        setStatus(pending.current.size === 0 ? "saved" : "pending");
      }
    } catch {
      failed = true;
      requeue(batch);
      setError("Couldn't reach the server.");
      setStatus("error");
    } finally {
      inFlight.current = false;
      // More typing landed while the request was open. Deliberately not after
      // a failure: the batch is back in `pending`, and re-running here would
      // spin against a server that has just refused. It goes out on the next
      // edit, on an explicit flush, or when the tab is hidden — and until then
      // `beforeunload` knows there is something unsaved.
      if (!failed && pending.current.size > 0) void run();
    }
  };

  const schedule = (payload: T) => {
    const existing = pending.current.get(payload.id);
    pending.current.set(payload.id, existing ? { ...existing, ...payload } : payload);
    setStatus("pending");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), delayMs);
  };

  const flush = () => {
    clearTimeout(timer.current);
    void run();
  };

  // Latest-ref pattern: the listeners below register once but must call the
  // current closures. Assigned in an effect rather than during render.
  const latest = useRef({ run, save });
  useEffect(() => {
    latest.current = { run, save };
    saveRef.current = save;
  });

  useEffect(() => {
    const flushNow = () => {
      clearTimeout(timer.current);
      void latest.current.run();
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (pending.current.size > 0 || inFlight.current) {
        event.preventDefault();
        return "";
      }
    };

    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushNow);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushNow);
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Never drop a pending write on unmount — send it.
      flushNow();
    };
  }, []);

  return { schedule, flush, status, error };
}
