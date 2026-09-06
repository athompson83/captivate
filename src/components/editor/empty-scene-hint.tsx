"use client";

import { Layout, Plus, Sparkles } from "lucide-react";
import { createElement } from "@/lib/editor/element-factory";
import { addElementToScene, editSceneContent } from "@/lib/editor/store";
import { relayoutScene } from "@/lib/editor/layouts";

/**
 * What an empty scene shows. Three concrete next steps rather than a blank
 * rectangle that leaves the user guessing where to click. The copy promised
 * three and the card offered two with a key to remember; the third is now a
 * button too, because a new author has not learnt the key yet.
 */
export function EmptySceneHint({ sceneId, onAskAi }: { sceneId: string; onAskAi?: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="border-line bg-base/85 pointer-events-auto flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-dashed px-8 py-7 text-center backdrop-blur-sm">
        <p className="text-ink text-[13px] font-medium">This scene is empty</p>
        <p className="text-ink-3 max-w-[240px] text-[12px] leading-relaxed">
          Add something, pick a composition, or let AI draft it.
        </p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => addElementToScene(sceneId, createElement("heading"), "Add heading")}
            className="bg-accent flex items-center gap-1.5 rounded-[var(--radius-md)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-contrast)] transition-opacity hover:opacity-90"
          >
            <Plus className="size-3" aria-hidden />
            Add a heading
          </button>
          <button
            onClick={() =>
              editSceneContent(sceneId, (c) => relayoutScene(c, "bullets"), {
                label: "Apply layout",
              })
            }
            className="border-line text-ink-2 hover:border-line-strong hover:text-ink flex items-center gap-1.5 rounded-[var(--radius-md)] border px-3 py-1.5 text-[12px] font-medium transition-colors"
          >
            <Layout className="size-3" aria-hidden />
            Use a layout
          </button>
          {onAskAi && (
            <button
              onClick={onAskAi}
              className="border-line text-ai-text hover:border-line-strong flex items-center gap-1.5 rounded-[var(--radius-md)] border px-3 py-1.5 text-[12px] font-medium transition-colors"
            >
              <Sparkles className="size-3" aria-hidden />
              Let AI draft it
            </button>
          )}
        </div>
        <p className="text-ink-3 mt-1 flex items-center gap-1.5 text-[11px]">
          <kbd className="border-line-subtle rounded border px-1 font-sans text-[10px]">I</kbd>
          opens AI ·
          <kbd className="border-line-subtle rounded border px-1 font-sans text-[10px]">?</kbd>
          shows every key
        </p>
      </div>
    </div>
  );
}
