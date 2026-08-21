"use client";

import { useState, useTransition } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, FolderPlus, GripVertical, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import type { PresentationTheme } from "@/lib/schema/theme";
import type { Scene } from "@/lib/schema/presentation";
import {
  insertScene,
  insertSection,
  moveScene,
  removeScene,
  removeSection,
  updateSectionLocal,
  useEditor,
} from "@/lib/editor/store";
import {
  addScene,
  addSection,
  deleteScene,
  deleteSection,
  duplicateScene,
} from "@/lib/data/actions";
import { StageThumbnail } from "@/components/stage/stage";
import { Popover, MenuItem, Tooltip } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";

/**
 * Scene navigator.
 *
 * Scenes are grouped under their section. Reordering is drag-and-drop over the
 * flat list; dropping a scene inside a section's span reassigns it, which is
 * how sections are populated without a second interaction model.
 */
export function SceneNavigator({
  open,
  presentationId,
  theme,
}: {
  open: boolean;
  presentationId: string;
  theme: PresentationTheme;
}) {
  const scenes = useEditor((s) => s.document.scenes);
  const sections = useEditor((s) => s.document.sections);
  const aspect = useEditor((s) => s.document.presentation.aspectRatio);
  const selectedId = useEditor((s) => s.selection.sceneId);
  const select = useEditor((s) => s.select);
  const { toast } = useToast();
  const [pending, start] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = scenes.findIndex((s) => s.id === active.id);
    const to = scenes.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;

    // Adopt the section of whatever the scene is dropped next to.
    const neighbourSection = scenes[to]?.sectionId ?? null;
    moveScene(String(active.id), to, neighbourSection);
  };

  const onAddScene = (afterSceneId: string | null) =>
    start(async () => {
      const result = await addScene({ presentationId, afterSceneId, title: "" });
      if (!result.ok) {
        toast({ tone: "error", title: "Couldn't add a scene", description: result.error });
        return;
      }
      const now = new Date().toISOString();
      const anchor = scenes.find((s) => s.id === afterSceneId);
      const scene: Scene = {
        id: result.data.id,
        presentationId,
        sectionId: anchor?.sectionId ?? null,
        position: result.data.position,
        title: "",
        placement: null,
        content: {
          version: 1,
          layout: "custom",
          background: { kind: "theme" },
          elements: [],
          themeOverride: null,
        },
        speakerNotes: "",
        durationSeconds: null,
        createdAt: now,
        updatedAt: now,
      };
      insertScene(scene, afterSceneId);
    });

  const onDuplicate = (sceneId: string) =>
    start(async () => {
      const result = await duplicateScene({ id: sceneId, presentationId });
      if (!result.ok) {
        toast({ tone: "error", title: "Couldn't duplicate", description: result.error });
        return;
      }
      const source = scenes.find((s) => s.id === sceneId);
      if (!source) return;
      const now = new Date().toISOString();
      insertScene(
        { ...structuredClone(source), id: result.data.id, createdAt: now, updatedAt: now },
        sceneId,
      );
    });

  const onDelete = (sceneId: string) =>
    start(async () => {
      const result = await deleteScene({ id: sceneId, presentationId });
      if (!result.ok) {
        toast({ tone: "error", title: "Couldn't delete", description: result.error });
        return;
      }
      removeScene(sceneId);
    });

  const onAddSection = () =>
    start(async () => {
      const result = await addSection({ presentationId, title: "New section" });
      if (!result.ok) {
        toast({ tone: "error", title: "Couldn't add a section", description: result.error });
        return;
      }
      const now = new Date().toISOString();
      insertSection({
        id: result.data.id,
        presentationId,
        title: "New section",
        label: "",
        position: sections.length,
        createdAt: now,
        updatedAt: now,
      });
    });

  if (!open) return null;

  // Walk the flat scene list, emitting a section header whenever the section
  // changes. This keeps one ordering source of truth.
  const rows: (
    { kind: "section"; id: string; title: string } | { kind: "scene"; scene: Scene; index: number }
  )[] = [];
  let lastSection: string | null | undefined = undefined;
  scenes.forEach((scene, index) => {
    if (scene.sectionId !== lastSection) {
      lastSection = scene.sectionId;
      const section = sections.find((s) => s.id === scene.sectionId);
      if (section) rows.push({ kind: "section", id: section.id, title: section.title });
    }
    rows.push({ kind: "scene", scene, index });
  });

  return (
    <aside
      aria-label="Scenes"
      className={cn(
        "border-line-subtle bg-base flex w-[212px] shrink-0 flex-col border-r",
        pending && "opacity-90",
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-ink-3 text-[11px] font-medium tracking-wider uppercase">
          {scenes.length} {scenes.length === 1 ? "scene" : "scenes"}
        </span>
        <Tooltip label="Add section" side="bottom">
          <button
            onClick={onAddSection}
            aria-label="Add section"
            className="text-ink-3 hover:text-ink rounded p-1 transition-colors hover:bg-[var(--surface-inset)]"
          >
            <FolderPlus className="size-3.5" aria-hidden />
          </button>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={scenes.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <ol className="space-y-1">
              {rows.map((row) =>
                row.kind === "section" ? (
                  <SectionHeader
                    key={`section-${row.id}`}
                    id={row.id}
                    title={row.title}
                    onDelete={() =>
                      start(async () => {
                        const result = await deleteSection({ id: row.id });
                        if (result.ok) removeSection(row.id);
                        else
                          toast({
                            tone: "error",
                            title: "Couldn't delete section",
                            description: result.error,
                          });
                      })
                    }
                  />
                ) : (
                  <SceneRow
                    key={row.scene.id}
                    scene={row.scene}
                    index={row.index}
                    selected={row.scene.id === selectedId}
                    theme={theme}
                    aspect={aspect}
                    onSelect={() => select({ sceneId: row.scene.id, elementIds: [] })}
                    onAddAfter={() => onAddScene(row.scene.id)}
                    onDuplicate={() => onDuplicate(row.scene.id)}
                    onDelete={() => onDelete(row.scene.id)}
                    canDelete={scenes.length > 1}
                  />
                ),
              )}
            </ol>
          </SortableContext>
        </DndContext>

        <button
          onClick={() => onAddScene(scenes[scenes.length - 1]?.id ?? null)}
          className="border-line text-ink-3 hover:border-accent hover:text-accent-text mt-2 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed py-2.5 text-[12px] font-medium transition-colors"
        >
          <Plus className="size-3.5" aria-hidden />
          Add scene
        </button>
      </div>
    </aside>
  );
}

function SectionHeader({
  id,
  title,
  onDelete,
}: {
  id: string;
  title: string;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <li className="group/section flex items-center gap-1 pt-3 pl-1 first:pt-1">
      <input
        value={title}
        onChange={(e) => updateSectionLocal(id, { title: e.target.value })}
        aria-label="Section name"
        className="text-ink-3 hover:border-line-subtle focus:border-line focus:text-ink-2 min-w-0 flex-1 truncate rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1 py-0.5 text-[10.5px] font-semibold tracking-wider uppercase transition-colors focus:bg-[var(--surface-inset)]"
      />
      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={`Actions for section ${title}`}
          className="text-ink-3 rounded p-0.5 opacity-0 transition-opacity group-hover/section:opacity-100 focus-visible:opacity-100"
        >
          <MoreHorizontal className="size-3" aria-hidden />
        </button>
        <Popover
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchor="bottom-end"
          className="w-[184px]"
        >
          <div role="menu">
            <MenuItem
              icon={Trash2}
              label="Delete section"
              tone="danger"
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
            />
            <p className="text-ink-3 px-2.5 pt-0.5 pb-1 text-[10.5px] leading-snug">
              Scenes are kept — they just leave the section.
            </p>
          </div>
        </Popover>
      </div>
    </li>
  );
}

function SceneRow({
  scene,
  index,
  selected,
  theme,
  aspect,
  onSelect,
  onAddAfter,
  onDuplicate,
  onDelete,
  canDelete,
}: {
  scene: Scene;
  index: number;
  selected: boolean;
  theme: PresentationTheme;
  aspect: "16:9" | "16:10" | "4:3";
  onSelect: () => void;
  onAddAfter: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: scene.id,
  });
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("group/scene relative", isDragging && "z-10 opacity-80")}
    >
      <div
        className={cn(
          "flex items-center gap-2 rounded-[var(--radius-md)] p-1.5 transition-colors",
          selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-inset)]",
        )}
      >
        <button
          {...attributes}
          {...listeners}
          aria-label={`Reorder scene ${index + 1}`}
          className="text-ink-3 cursor-grab touch-none rounded p-0.5 opacity-0 transition-opacity group-hover/scene:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="size-3" aria-hidden />
        </button>

        <button
          onClick={onSelect}
          aria-current={selected ? "true" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            className={cn(
              "w-4 shrink-0 text-right text-[10px] tabular-nums",
              selected ? "text-accent-text" : "text-ink-3",
            )}
          >
            {index + 1}
          </span>
          <span
            className={cn(
              "shrink-0 overflow-hidden rounded-[3px] border",
              selected ? "border-accent" : "border-line-subtle",
            )}
          >
            <StageThumbnail content={scene.content} theme={theme} aspect={aspect} width={96} />
          </span>
        </button>

        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={`Actions for scene ${index + 1}`}
            aria-haspopup="menu"
            className="text-ink-3 rounded p-0.5 opacity-0 transition-opacity group-hover/scene:opacity-100 focus-visible:opacity-100"
          >
            <MoreHorizontal className="size-3" aria-hidden />
          </button>
          <Popover
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            anchor="bottom-end"
            className="w-[184px]"
          >
            <div role="menu">
              <MenuItem
                icon={Plus}
                label="Add scene after"
                onClick={() => {
                  setMenuOpen(false);
                  onAddAfter();
                }}
              />
              <MenuItem
                icon={Copy}
                label="Duplicate"
                onClick={() => {
                  setMenuOpen(false);
                  onDuplicate();
                }}
              />
              <div className="border-line-subtle my-1 border-t" />
              <MenuItem
                icon={Trash2}
                label="Delete"
                tone="danger"
                disabled={!canDelete}
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
              />
            </div>
          </Popover>
        </div>
      </div>

      {/* Insert-between affordance: appears on hover in the gap below a scene. */}
      <button
        onClick={onAddAfter}
        aria-label={`Insert a scene after scene ${index + 1}`}
        className="absolute inset-x-4 -bottom-1 z-10 flex h-2 items-center justify-center opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100"
      >
        <span className="bg-accent h-px flex-1" />
        <span className="bg-accent mx-1 flex size-3.5 items-center justify-center rounded-full text-[var(--accent-contrast)]">
          <Plus className="size-2.5" aria-hidden />
        </span>
        <span className="bg-accent h-px flex-1" />
      </button>
    </li>
  );
}
