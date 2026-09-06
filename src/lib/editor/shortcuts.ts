"use client";

import { useEffect } from "react";
import { duplicateElements, editElement, removeElements, useEditor } from "./store";
import { clampFrame } from "./geometry";
import type { SceneElement } from "@/lib/schema/presentation";

/**
 * Global editor keyboard map.
 *
 * Shortcuts are suppressed whenever focus is inside a text field or an element
 * being edited inline, so typing "d" never duplicates a box.
 */

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** In-memory clipboard so copy/paste works without clipboard permissions. */
let clipboard: SceneElement[] = [];

export function useEditorShortcuts(handlers: {
  onToggleNotes: () => void;
  onToggleAi: () => void;
  onSave: () => void;
  /** Opens the list of these keys; `?`, the key every keyboard app answers to. */
  onHelp: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const state = useEditor.getState();
      const sceneId = state.selection.sceneId;
      const selected = state.selection.elementIds;

      // Escape always works, even mid-edit, so there is a way out of anything.
      if (e.key === "Escape") {
        if (isTypingTarget(e.target)) {
          (e.target as HTMLElement).blur();
          return;
        }
        if (selected.length) {
          e.preventDefault();
          state.select({ elementIds: [] });
        }
        return;
      }

      if (isTypingTarget(e.target)) return;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        state.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handlers.onSave();
        return;
      }
      if (mod && e.key.toLowerCase() === "d" && sceneId && selected.length) {
        e.preventDefault();
        duplicateElements(sceneId, selected);
        return;
      }
      if (mod && e.key.toLowerCase() === "c" && sceneId && selected.length) {
        const scene = state.document.scenes.find((s) => s.id === sceneId);
        clipboard = (scene?.content.elements ?? []).filter((el) => selected.includes(el.id));
        return;
      }
      if (mod && e.key.toLowerCase() === "x" && sceneId && selected.length) {
        e.preventDefault();
        const scene = state.document.scenes.find((s) => s.id === sceneId);
        clipboard = (scene?.content.elements ?? []).filter((el) => selected.includes(el.id));
        removeElements(sceneId, selected);
        return;
      }
      if (mod && e.key.toLowerCase() === "v" && sceneId && clipboard.length) {
        e.preventDefault();
        pasteClipboard(sceneId);
        return;
      }
      if (mod && e.key.toLowerCase() === "a" && sceneId) {
        e.preventDefault();
        const scene = state.document.scenes.find((s) => s.id === sceneId);
        state.select({
          elementIds: (scene?.content.elements ?? []).filter((el) => !el.locked).map((el) => el.id),
        });
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && sceneId && selected.length) {
        e.preventDefault();
        removeElements(sceneId, selected);
        return;
      }

      if (e.key === "?" && !mod) {
        e.preventDefault();
        handlers.onHelp();
        return;
      }
      if (e.key === "n" && !mod) {
        e.preventDefault();
        handlers.onToggleNotes();
        return;
      }
      if (e.key === "i" && !mod) {
        e.preventDefault();
        handlers.onToggleAi();
        return;
      }

      // Alt with an arrow resizes the selection from its bottom-right corner,
      // which is the only way to change an element's size without a pointer:
      // the canvas handles are a drag affordance and the inspector has no
      // width or height field.
      if (e.key.startsWith("Arrow") && e.altKey && sceneId && selected.length) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 0.5;
        const dw = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dh = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        for (const id of selected) {
          editElement(
            sceneId,
            id,
            (el) =>
              el.locked
                ? el
                : {
                    ...el,
                    frame: clampFrame({ ...el.frame, w: el.frame.w + dw, h: el.frame.h + dh }),
                  },
            { label: "Resize element", coalesceKey: `resize-${id}` },
          );
        }
        return;
      }

      // Arrow keys: nudge the selection, or move between scenes when nothing
      // on the canvas is selected.
      if (e.key.startsWith("Arrow")) {
        if (sceneId && selected.length) {
          e.preventDefault();
          const step = e.shiftKey ? 5 : 0.5;
          const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          for (const id of selected) {
            editElement(
              sceneId,
              id,
              (el) =>
                el.locked
                  ? el
                  : {
                      ...el,
                      frame: clampFrame({ ...el.frame, x: el.frame.x + dx, y: el.frame.y + dy }),
                    },
              { label: "Move element", coalesceKey: `nudge-${id}` },
            );
          }
          return;
        }

        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const scenes = state.document.scenes;
          const index = scenes.findIndex((s) => s.id === sceneId);
          const next = e.key === "ArrowDown" ? index + 1 : index - 1;
          if (scenes[next]) state.select({ sceneId: scenes[next].id, elementIds: [] });
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
}

function pasteClipboard(sceneId: string) {
  const state = useEditor.getState();
  const newIds: string[] = [];

  state.mutate(
    (draft) => {
      const scene = draft.scenes.find((s) => s.id === sceneId);
      if (!scene) return;
      const copies = clipboard.map((el) => {
        const id = `${el.type}_${crypto.randomUUID().slice(0, 8)}`;
        newIds.push(id);
        return {
          ...structuredClone(el),
          id,
          frame: clampFrame({ ...el.frame, x: el.frame.x + 3, y: el.frame.y + 3 }),
        };
      });
      scene.content = { ...scene.content, elements: [...scene.content.elements, ...copies] };
    },
    { label: "Paste", dirty: [sceneId] },
  );

  state.select({ elementIds: newIds });
}

export const SHORTCUTS: { keys: string; action: string; group: string }[] = [
  { keys: "⌘Z", action: "Undo", group: "Editing" },
  { keys: "⇧⌘Z", action: "Redo", group: "Editing" },
  { keys: "⌘D", action: "Duplicate selection", group: "Editing" },
  { keys: "⌘C / ⌘X / ⌘V", action: "Copy, cut, paste", group: "Editing" },
  { keys: "⌘A", action: "Select all on scene", group: "Editing" },
  { keys: "Delete", action: "Delete selection", group: "Editing" },
  { keys: "Arrows", action: "Nudge selection", group: "Editing" },
  { keys: "⇧ Arrows", action: "Nudge further", group: "Editing" },
  { keys: "⌥ Arrows", action: "Resize selection", group: "Editing" },
  { keys: "⇧⌥ Arrows", action: "Resize further", group: "Editing" },
  { keys: "Esc", action: "Deselect", group: "Editing" },
  { keys: "↑ / ↓", action: "Previous / next scene", group: "Navigation" },
  { keys: "N", action: "Toggle notes", group: "Panels" },
  { keys: "I", action: "Toggle AI", group: "Panels" },
  { keys: "⌘S", action: "Save now", group: "Panels" },
  { keys: "?", action: "This list", group: "Panels" },
];
