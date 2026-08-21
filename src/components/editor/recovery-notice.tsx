"use client";

import { AlertTriangle, X } from "lucide-react";
import { useEditor } from "@/lib/editor/store";

/**
 * Shown when stored scene content failed validation on load and was repaired.
 *
 * The deck still opens — losing one malformed scene must never cost the other
 * thirty-nine — but the user is told plainly which scenes were affected rather
 * than discovering it during a lecture.
 */
export function RecoveryNotice() {
  const recovered = useEditor((s) => s.recoveredScenes);
  const scenes = useEditor((s) => s.document.scenes);
  const clear = useEditor((s) => s.clearRecovered);

  if (!recovered.length) return null;

  const names = recovered
    .map((id) => {
      const index = scenes.findIndex((s) => s.id === id);
      const scene = scenes[index];
      return scene?.title || `Scene ${index + 1}`;
    })
    .filter(Boolean);

  return (
    <div
      role="alert"
      className="border-line-subtle flex items-start gap-2.5 border-b bg-[var(--accent-soft)] px-4 py-2.5"
    >
      <AlertTriangle className="text-warning mt-px size-3.5 shrink-0" aria-hidden />
      <p className="text-ink-2 flex-1 text-[12.5px] leading-relaxed">
        {names.length === 1 ? "One scene" : `${names.length} scenes`} had content Captivate
        couldn&apos;t read and {names.length === 1 ? "was" : "were"} restored as far as possible
        {names.length <= 3 && `: ${names.join(", ")}`}. Anything that couldn&apos;t be recovered has
        been left out — check {names.length === 1 ? "it" : "them"} before presenting.
      </p>
      <button
        onClick={clear}
        aria-label="Dismiss"
        className="text-ink-3 hover:text-ink rounded p-0.5 transition-colors"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
