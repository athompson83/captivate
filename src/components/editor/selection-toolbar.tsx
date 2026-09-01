"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Trash2,
  Unlock,
} from "lucide-react";
import type { SceneElement } from "@/lib/schema/presentation";
import { cn } from "@/lib/utils/cn";
import { alignFrames, type AlignMode } from "@/lib/editor/geometry";
import {
  duplicateElements,
  editElement,
  removeElements,
  reorderElement,
  useEditor,
} from "@/lib/editor/store";
import { Tooltip } from "@/components/ui/misc";

/**
 * Floating toolbar for the current selection.
 *
 * It follows the selection rather than living in a permanent ribbon — the
 * controls exist only while there is something for them to act on.
 */
export function SelectionToolbar({
  sceneId,
  selected,
  scale,
  stageRef,
}: {
  sceneId: string;
  selected: SceneElement[];
  scale: number;
  stageRef: RefObject<HTMLDivElement | null>;
}) {
  const mutate = useEditor((s) => s.mutate);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Position above the selection's bounding box, flipping below when it would
  // otherwise sit off the top of the viewport, and clamped horizontally so it
  // cannot hang off the side.
  //
  // The vertical flip was here from the start; the horizontal clamp was not,
  // and at 320px a selection near the right edge put a third of this toolbar —
  // delete, duplicate, lock — outside the window, where the editor's
  // `overflow-hidden` shell meant nothing could scroll to reach it.
  useLayoutEffect(() => {
    if (!selected.length) return;

    const minX = Math.min(...selected.map((e) => e.frame.x));
    const maxX = Math.max(...selected.map((e) => e.frame.x + e.frame.w));
    const minY = Math.min(...selected.map((e) => e.frame.y));

    const place = () => {
      // The stage is re-read here, not once outside. A resize moves the stage
      // without changing `scale` — the canvas refits and re-centres — so
      // coordinates captured before the listener was attached would have left
      // this correctly clamped to the new window and anchored to where the
      // selection used to be.
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const centerX = rect.left + ((minX + maxX) / 2 / 100) * rect.width;
      const topY = rect.top + (minY / 100) * rect.height;

      // `-translate-x-1/2` means `left` is the centre, so the clamp is in half
      // widths. Measured rather than assumed: the toolbar's width depends on
      // how many groups the current selection earns, and on how many rows it
      // wrapped into — at 320px it is three rows of a control that is 389px
      // wide in one.
      const half = (ref.current?.offsetWidth ?? 0) / 2;
      const height = ref.current?.offsetHeight ?? 46;
      const margin = 8;
      const lo = half + margin;
      const hi = window.innerWidth - half - margin;
      setPos({
        left: Math.min(Math.max(centerX, lo), Math.max(lo, hi)),
        // Height measured rather than the 46 this assumed, so a wrapped
        // toolbar flips below the selection instead of climbing behind the
        // header it can no longer clear.
        top: topY - height - 8 < 72 ? topY + 12 : topY - height - 8,
      });
    };

    place();

    // Watch the canvas, not just the window. The stage moves for reasons the
    // effect's dependencies cannot see: opening the inspector takes 272px off
    // the right of the canvas, and when the stage is bound by height rather
    // than width — a short, wide window — `scale` does not change, so nothing
    // re-runs this. Selecting an element is what opens the inspector, so the
    // toolbar was placed against the canvas as it was one frame earlier and
    // sat 136px — half the panel — from where the selection ended up.
    //
    // The wrapper rather than the stage itself, because that is the box that
    // changes size; the stage only slides within it.
    const wrapper = stageRef.current?.parentElement;
    const observer = wrapper ? new ResizeObserver(place) : null;
    if (wrapper && observer) observer.observe(wrapper);
    window.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [selected, scale, stageRef]);

  const allLocked = selected.every((e) => e.locked);
  const allHidden = selected.every((e) => e.hidden);
  const ids = selected.map((e) => e.id);

  const align = (mode: AlignMode) => {
    mutate(
      (draft) => {
        const scene = draft.scenes.find((s) => s.id === sceneId);
        if (!scene) return;
        const targets = scene.content.elements.filter((e) => ids.includes(e.id));
        const aligned = alignFrames(
          targets.map((t) => t.frame),
          mode,
        );
        const byId = new Map(targets.map((t, i) => [t.id, aligned[i]]));
        scene.content = {
          ...scene.content,
          layout: "custom",
          elements: scene.content.elements.map((e) =>
            byId.has(e.id) ? { ...e, frame: byId.get(e.id)! } : e,
          ),
        };
      },
      { label: "Align", dirty: [sceneId] },
    );
  };

  const toggle = (key: "locked" | "hidden", value: boolean) => {
    for (const id of ids) {
      editElement(sceneId, id, (el) => ({ ...el, [key]: value }), {
        label: value ? `Set ${key}` : `Clear ${key}`,
      });
    }
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Selection actions"
      // Rendered before it is placed, rather than after, so the layout effect
      // above has a real element to measure. It is parked off-screen and inert
      // for that one commit; `useLayoutEffect` positions it before the browser
      // paints, so nothing is ever seen there.
      aria-hidden={pos ? undefined : true}
      className={cn(
        // Wraps rather than overflows. This is 389px in one row, which does not
        // fit a 320px phone at any horizontal position — clamping alone could
        // only choose which third of the controls to put out of reach.
        "border-line bg-overlay fixed z-40 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-0.5 rounded-[var(--radius-lg)] border p-1 shadow-[var(--shadow-lg)]",
        !pos && "pointer-events-none opacity-0",
      )}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Group>
        <IconButton label="Align left" onClick={() => align("left")} icon={AlignStartVertical} />
        <IconButton
          label="Align centre"
          onClick={() => align("center-x")}
          icon={AlignCenterVertical}
        />
        <IconButton label="Align right" onClick={() => align("right")} icon={AlignEndVertical} />
      </Group>
      <Divider />
      <Group>
        <IconButton label="Align top" onClick={() => align("top")} icon={AlignStartHorizontal} />
        <IconButton
          label="Align middle"
          onClick={() => align("center-y")}
          icon={AlignCenterHorizontal}
        />
        <IconButton
          label="Align bottom"
          onClick={() => align("bottom")}
          icon={AlignEndHorizontal}
        />
      </Group>
      <Divider />
      <Group>
        <IconButton
          label="Bring forward"
          onClick={() => reorderElement(sceneId, ids[0], "forward")}
          icon={ArrowUp}
          disabled={ids.length !== 1}
        />
        <IconButton
          label="Send backward"
          onClick={() => reorderElement(sceneId, ids[0], "backward")}
          icon={ArrowDown}
          disabled={ids.length !== 1}
        />
      </Group>
      <Divider />
      <Group>
        <IconButton
          label={allHidden ? "Show on stage" : "Hide from stage"}
          onClick={() => toggle("hidden", !allHidden)}
          icon={allHidden ? EyeOff : Eye}
        />
        <IconButton
          label={allLocked ? "Unlock" : "Lock position"}
          onClick={() => toggle("locked", !allLocked)}
          icon={allLocked ? Lock : Unlock}
        />
        <IconButton
          label="Duplicate"
          onClick={() => duplicateElements(sceneId, ids)}
          icon={Copy}
          shortcut="⌘D"
        />
        <IconButton
          label="Delete"
          onClick={() => removeElements(sceneId, ids)}
          icon={Trash2}
          tone="danger"
          shortcut="⌫"
        />
      </Group>
    </div>
  );
}

const Group = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-0.5">{children}</div>
);

const Divider = () => <span aria-hidden className="bg-line-subtle mx-0.5 h-4 w-px" />;

function IconButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  tone,
  shortcut,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger";
  shortcut?: string;
}) {
  return (
    <Tooltip label={label} shortcut={shortcut} side="top">
      <button
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`flex size-7 items-center justify-center rounded-[var(--radius-sm)] transition-colors disabled:pointer-events-none disabled:opacity-35 ${
          tone === "danger"
            ? "text-ink-3 hover:text-danger hover:bg-[var(--danger-soft)]"
            : "text-ink-3 hover:text-ink hover:bg-[var(--surface-inset)]"
        }`}
      >
        <Icon className="size-3.5" />
      </button>
    </Tooltip>
  );
}
