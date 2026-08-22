"use client";

import { useEffect, useRef } from "react";
import { Lock } from "lucide-react";
import type { SceneElement } from "@/lib/schema/presentation";
import type { ResizeHandle } from "@/lib/editor/geometry";
import { editElement } from "@/lib/editor/store";
import { cn } from "@/lib/utils/cn";

const HANDLES: { handle: ResizeHandle; className: string; cursor: string }[] = [
  { handle: "nw", className: "-left-1 -top-1", cursor: "nwse-resize" },
  { handle: "n", className: "left-1/2 -top-1 -translate-x-1/2", cursor: "ns-resize" },
  { handle: "ne", className: "-right-1 -top-1", cursor: "nesw-resize" },
  { handle: "e", className: "-right-1 top-1/2 -translate-y-1/2", cursor: "ew-resize" },
  { handle: "se", className: "-right-1 -bottom-1", cursor: "nwse-resize" },
  { handle: "s", className: "left-1/2 -bottom-1 -translate-x-1/2", cursor: "ns-resize" },
  { handle: "sw", className: "-left-1 -bottom-1", cursor: "nesw-resize" },
  { handle: "w", className: "-left-1 top-1/2 -translate-y-1/2", cursor: "ew-resize" },
];

/** Element types whose text can be edited inline on the canvas. */
const INLINE_EDITABLE = new Set(["heading", "text", "quote", "code"]);

export function ElementFrame({
  element,
  selected,
  editing,
  scale,
  sceneId,
  onPointerDown,
  onResizeStart,
  onStartEditing,
  onStopEditing,
}: {
  element: SceneElement;
  selected: boolean;
  editing: boolean;
  scale: number;
  sceneId: string;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent, handle: ResizeHandle) => void;
  onStartEditing: () => void;
  onStopEditing: () => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing || !editorRef.current) return;
    const node = editorRef.current;
    node.focus();
    // Place the caret at the end rather than selecting everything, so a
    // double-click to edit does not risk replacing the whole block.
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  const canEditInline = INLINE_EDITABLE.has(element.type) && !element.locked;

  const commitText = (raw: string) => {
    const text = raw.replace(/ /g, " ");
    editElement(
      sceneId,
      element.id,
      (el) => {
        if (el.type === "code") return { ...el, code: text };
        if (el.type === "heading" || el.type === "text" || el.type === "quote") {
          // Preserve the first run's marks; inline editing is plain text by
          // design, and richer formatting lives in the inspector.
          const [first] = el.content;
          return { ...el, content: text ? [{ ...(first ?? {}), text }] : [] };
        }
        return el;
      },
      { label: "Edit text", coalesceKey: `text-${element.id}` },
    );
  };

  const currentText =
    element.type === "code"
      ? element.code
      : element.type === "heading" || element.type === "text" || element.type === "quote"
        ? element.content.map((r) => r.text).join("")
        : "";

  return (
    <div
      className="absolute"
      style={{
        left: `${element.frame.x}%`,
        top: `${element.frame.y}%`,
        width: `${element.frame.w}%`,
        height: `${element.frame.h}%`,
        transform: element.frame.rotation ? `rotate(${element.frame.rotation}deg)` : undefined,
      }}
    >
      <div
        role="button"
        tabIndex={element.hidden ? -1 : 0}
        aria-label={`${element.type} element${element.locked ? ", locked" : ""}`}
        aria-pressed={selected}
        onPointerDown={onPointerDown}
        onDoubleClick={(e) => {
          if (!canEditInline) return;
          e.stopPropagation();
          onStartEditing();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canEditInline && !editing) {
            e.preventDefault();
            onStartEditing();
          }
        }}
        className={cn(
          "absolute inset-0 transition-[box-shadow] duration-[var(--duration-instant)]",
          element.hidden && "opacity-30",
          element.locked ? "cursor-default" : editing ? "cursor-text" : "cursor-move",
          selected
            ? "shadow-[0_0_0_1.5px_var(--accent)]"
            : "hover:shadow-[0_0_0_1px_var(--accent)]/60",
        )}
      >
        {editing && (
          <div
            ref={editorRef}
            // plaintext-only keeps pasted markup out of the document entirely.
            contentEditable="plaintext-only"
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Edit text"
            onInput={(e) => commitText((e.target as HTMLElement).innerText)}
            onBlur={(e) => {
              commitText((e.target as HTMLElement).innerText);
              onStopEditing();
            }}
            onPaste={(e) => {
              // Belt and braces for browsers that ignore plaintext-only.
              e.preventDefault();
              const text = e.clipboardData.getData("text/plain");
              document.execCommand("insertText", false, text);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") (e.target as HTMLElement).blur();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="text-ink absolute inset-0 z-10 overflow-auto bg-[var(--surface-base)]/92 p-2 outline-none"
            style={{
              fontSize: `${13 / Math.max(scale, 0.2)}px`,
              fontFamily: element.type === "code" ? "var(--font-mono)" : "var(--font-inter)",
              lineHeight: 1.4,
            }}
          >
            {currentText}
          </div>
        )}

        {element.locked && selected && (
          <span className="bg-overlay text-ink-3 absolute -top-6 left-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] shadow-[var(--shadow-sm)]">
            <Lock className="size-2.5" aria-hidden />
            Locked
          </span>
        )}
      </div>

      {selected && !element.locked && !editing && (
        <>
          {/*
            Drag affordances, not controls. They were focusable buttons
            announcing "Resize top-left" and doing nothing at all from the
            keyboard: eight promises per selected element, none of them kept,
            and 8px targets besides. The keyboard path is Alt with the arrow
            keys, which resizes the selection directly.
          */}
          {HANDLES.map(({ handle, className, cursor }) => (
            <div
              key={handle}
              aria-hidden
              onPointerDown={(e) => onResizeStart(e, handle)}
              style={{ cursor }}
              className={cn(
                "bg-accent absolute size-2 rounded-[2px] border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)]",
                className,
              )}
            />
          ))}
        </>
      )}
    </div>
  );
}
