"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
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
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Position above the selection's bounding box, flipping below when it would
  // otherwise sit off the top of the viewport.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !selected.length) return;

    const rect = stage.getBoundingClientRect();
    const minX = Math.min(...selected.map((e) => e.frame.x));
    const maxX = Math.max(...selected.map((e) => e.frame.x + e.frame.w));
    const minY = Math.min(...selected.map((e) => e.frame.y));

    const centerX = rect.left + ((minX + maxX) / 2 / 100) * rect.width;
    const topY = rect.top + (minY / 100) * rect.height;

    setPos({
      left: centerX,
      top: topY - 46 < 72 ? topY + 12 : topY - 46,
    });
  }, [selected, scale, stageRef]);

  if (!pos) return null;

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
      role="toolbar"
      aria-label="Selection actions"
      className="border-line bg-overlay fixed z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-[var(--radius-lg)] border p-1 shadow-[var(--shadow-lg)]"
      style={{ left: pos.left, top: pos.top }}
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
