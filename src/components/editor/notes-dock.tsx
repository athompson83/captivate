"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { BookOpen, ChevronDown, Loader2, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import type { LectureNote } from "@/lib/data/notes";
import { createNote, deleteNote, listNotes, updateNote } from "@/lib/data/notes";
import { useDebouncedSave } from "@/lib/data/use-debounced-save";
import { updateSceneMeta, useCurrentScene, useEditor } from "@/lib/editor/store";
import { Textarea } from "@/components/ui/input";
import { Segmented, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { relativeTime } from "@/lib/utils/format";
import { generateSpeakerNotes } from "@/lib/ai/client";

/**
 * The notes dock.
 *
 * Two genuinely different things share one surface because they are used
 * together: per-scene *speaker notes* (short, private, shown in the presenter
 * console) and *lecture notes* (long-form material that outlives any scene).
 * The dock is resizable because an educator writing lecture notes needs room.
 */
export function NotesDock({
  presentationId,
  onClose,
}: {
  presentationId: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"speaker" | "lecture">("speaker");
  const [height, setHeight] = useState(280);
  const dragging = useRef(false);

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startY = e.clientY;
      const startHeight = height;

      const onMove = (ev: PointerEvent) => {
        if (!dragging.current) return;
        setHeight(
          Math.min(window.innerHeight * 0.7, Math.max(140, startHeight - (ev.clientY - startY))),
        );
      };
      const onUp = () => {
        dragging.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      // pointercancel too: a touch or pen interrupted by a system gesture
      // never sends pointerup, and the drag then never ended — guides stayed
      // on screen and the move handler kept running against a dead gesture.
      window.addEventListener("pointercancel", onUp);
    },
    [height],
  );

  return (
    <motion.section
      aria-label="Notes"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height, opacity: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="border-line-subtle bg-base relative shrink-0 overflow-hidden border-t"
    >
      <div
        role="separator"
        aria-label="Resize notes panel"
        aria-orientation="horizontal"
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") setHeight((h) => Math.min(window.innerHeight * 0.7, h + 24));
          if (e.key === "ArrowDown") setHeight((h) => Math.max(140, h - 24));
        }}
        className="hover:bg-accent/40 absolute inset-x-0 top-0 z-10 h-1.5 cursor-ns-resize bg-transparent transition-colors"
      />

      <div className="flex h-full flex-col" style={{ height }}>
        <div className="flex shrink-0 items-center gap-3 px-3 py-2">
          <Segmented
            label="Notes type"
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { value: "speaker", label: "Speaker notes" },
              { value: "lecture", label: "Lecture notes" },
            ]}
          />
          <div className="flex-1" />
          <button
            onClick={onClose}
            aria-label="Close notes"
            className="text-ink-3 hover:text-ink rounded p-1 transition-colors"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1">
          {tab === "speaker" ? (
            <SpeakerNotesPane presentationId={presentationId} />
          ) : (
            <LectureNotesPane presentationId={presentationId} />
          )}
        </div>
      </div>
    </motion.section>
  );
}

/* -------------------------------------------------------------------------- */

function SpeakerNotesPane({ presentationId }: { presentationId: string }) {
  const scene = useCurrentScene();
  const scenes = useEditor((s) => s.document.scenes);
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);

  if (!scene) {
    return <p className="text-ink-3 p-4 text-[12.5px]">Select a scene to write its notes.</p>;
  }

  const index = scenes.findIndex((s) => s.id === scene.id);

  const onGenerate = async () => {
    setGenerating(true);
    const result = await generateSpeakerNotes({
      presentationId,
      sceneId: scene.id,
      existingNotes: scene.speakerNotes,
    });
    setGenerating(false);

    if (!result.ok) {
      toast({ tone: "error", title: "Couldn't draft notes", description: result.error });
      return;
    }
    updateSceneMeta(scene.id, { speakerNotes: result.notes }, { label: "Generate speaker notes" });
    toast({
      tone: "success",
      title: "Notes drafted",
      description: "Edit them like anything else — nothing is locked.",
    });
  };

  return (
    <div className="flex h-full flex-col gap-2 px-3 pb-3">
      <div className="flex items-center justify-between">
        <p className="text-ink-3 text-[11px]">
          Scene {index + 1}
          {scene.title && ` · ${scene.title}`} · private to you during a presentation
        </p>
        <button
          onClick={onGenerate}
          disabled={generating}
          className="text-ai-text flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-[11.5px] font-medium transition-colors hover:bg-[var(--ai-soft)] disabled:opacity-50"
        >
          {generating ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="size-3" aria-hidden />
          )}
          {scene.speakerNotes.trim() ? "Improve with AI" : "Draft with AI"}
        </button>
      </div>

      <textarea
        value={scene.speakerNotes}
        onChange={(e) =>
          updateSceneMeta(
            scene.id,
            { speakerNotes: e.target.value },
            { label: "Edit speaker notes", coalesceKey: `notes-${scene.id}` },
          )
        }
        placeholder="What you'll say here. Only you see this — the audience never does."
        aria-label="Speaker notes"
        className="border-line text-ink placeholder:text-ink-3 focus:border-accent min-h-0 flex-1 resize-none rounded-[var(--radius-md)] border bg-[var(--surface-inset)] p-3 text-[13px] leading-relaxed transition-colors outline-none"
      />

      <div className="text-ink-3 flex items-center justify-between text-[11px]">
        <span>{scene.speakerNotes.length.toLocaleString()} / 20,000 characters</span>
        <label className="flex items-center gap-1.5">
          Rehearsal target
          <input
            type="number"
            min={0}
            max={120}
            value={scene.durationSeconds ? Math.round(scene.durationSeconds / 60) : ""}
            onChange={(e) => {
              const minutes = Number(e.target.value);
              updateSceneMeta(
                scene.id,
                {
                  durationSeconds:
                    Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : null,
                },
                { label: "Set scene timing", coalesceKey: `dur-${scene.id}` },
              );
            }}
            placeholder="—"
            aria-label="Rehearsal target in minutes"
            className="border-line text-ink w-12 rounded border bg-[var(--surface-inset)] px-1.5 py-0.5 text-center text-[11px]"
          />
          min
        </label>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function LectureNotesPane({ presentationId }: { presentationId: string }) {
  const scenes = useEditor((s) => s.document.scenes);
  const currentSceneId = useEditor((s) => s.selection.sceneId);
  const { toast } = useToast();

  const [notes, setNotes] = useState<LectureNote[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void listNotes(presentationId).then((loaded) => {
      setNotes(loaded);
      setActiveId((current) => current ?? loaded[0]?.id ?? null);
    });
  }, [presentationId]);

  const active = notes?.find((n) => n.id === activeId) ?? null;

  const saver = useDebouncedSave(
    useCallback(
      async (payload: { id: string; title?: string; body?: string; sceneId?: string | null }) => {
        const result = await updateNote(payload);
        if (!result.ok)
          toast({ tone: "error", title: "Note not saved", description: result.error });
        return result;
      },
      [toast],
    ),
  );

  const persist = useCallback(
    (id: string, patch: { title?: string; body?: string; sceneId?: string | null }) => {
      saver.schedule({ id, ...patch });
    },
    [saver],
  );

  const patchLocal = (id: string, patch: Partial<LectureNote>) =>
    setNotes((current) => current?.map((n) => (n.id === id ? { ...n, ...patch } : n)) ?? current);

  const onCreate = async () => {
    const result = await createNote({
      presentationId,
      sceneId: currentSceneId,
      title: "Untitled note",
    });
    if (!result.ok) {
      toast({ tone: "error", title: "Couldn't create the note", description: result.error });
      return;
    }
    setNotes((current) => [result.data, ...(current ?? [])]);
    setActiveId(result.data.id);
  };

  const onDelete = async (id: string) => {
    const result = await deleteNote(id);
    if (!result.ok) {
      toast({ tone: "error", title: "Couldn't delete", description: result.error });
      return;
    }
    setNotes((current) => {
      const next = current?.filter((n) => n.id !== id) ?? [];
      setActiveId((a) => (a === id ? (next[0]?.id ?? null) : a));
      return next;
    });
  };

  const filtered = (notes ?? []).filter((n) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q);
  });

  return (
    <div className="border-line-subtle grid h-full grid-cols-[196px_minmax(0,1fr)] gap-0 border-t">
      <div className="border-line-subtle flex min-h-0 flex-col border-r">
        <div className="flex items-center gap-1.5 px-2 py-2">
          <div className="relative flex-1">
            <Search
              className="text-ink-3 absolute top-1/2 left-2 size-3 -translate-y-1/2"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes"
              aria-label="Search notes"
              className="border-line-subtle text-ink placeholder:text-ink-3 focus:border-accent w-full rounded-[var(--radius-sm)] border bg-[var(--surface-inset)] py-1 pr-2 pl-7 text-[11.5px] outline-none"
            />
          </div>
          <button
            onClick={onCreate}
            aria-label="New note"
            className="text-ink-3 hover:text-ink shrink-0 rounded p-1 transition-colors hover:bg-[var(--surface-inset)]"
          >
            <Plus className="size-3.5" aria-hidden />
          </button>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {notes === null && (
            <li className="flex justify-center py-6">
              <Spinner />
            </li>
          )}
          {notes !== null && filtered.length === 0 && (
            <li className="text-ink-3 px-2 py-6 text-center text-[11.5px] leading-relaxed">
              {query ? "No notes match." : "Keep your research, references and full script here."}
            </li>
          )}
          {filtered.map((note) => (
            <li key={note.id}>
              <button
                onClick={() => setActiveId(note.id)}
                aria-current={note.id === activeId ? "true" : undefined}
                className={cn(
                  "w-full rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors",
                  note.id === activeId
                    ? "bg-[var(--accent-soft)]"
                    : "hover:bg-[var(--surface-inset)]",
                )}
              >
                <span className="text-ink block truncate text-[12px]">
                  {note.title || "Untitled note"}
                </span>
                <span className="text-ink-3 block truncate text-[10.5px]">
                  {note.sceneId
                    ? `Scene ${scenes.findIndex((s) => s.id === note.sceneId) + 1}`
                    : relativeTime(note.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {active ? (
        <div className="flex min-h-0 flex-col gap-2 p-3">
          <div className="flex items-center gap-2">
            <input
              value={active.title}
              onChange={(e) => {
                patchLocal(active.id, { title: e.target.value });
                persist(active.id, { title: e.target.value });
              }}
              aria-label="Note title"
              placeholder="Note title"
              className="text-ink hover:border-line-subtle focus:border-line min-w-0 flex-1 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1.5 py-1 text-[13px] font-medium transition-colors focus:bg-[var(--surface-inset)]"
            />

            <div className="relative">
              <select
                value={active.sceneId ?? ""}
                onChange={(e) => {
                  const sceneId = e.target.value || null;
                  patchLocal(active.id, { sceneId });
                  persist(active.id, { sceneId });
                }}
                aria-label="Attach note to a scene"
                className="border-line text-ink-2 appearance-none rounded-[var(--radius-sm)] border bg-[var(--surface-inset)] py-1 pr-6 pl-2 text-[11px] outline-none"
              >
                <option value="">Whole presentation</option>
                {scenes.map((s, i) => (
                  <option key={s.id} value={s.id}>
                    Scene {i + 1}
                    {s.title ? ` · ${s.title}` : ""}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="text-ink-3 pointer-events-none absolute top-1/2 right-1.5 size-3 -translate-y-1/2"
                aria-hidden
              />
            </div>

            <span role="status" className="text-ink-3 w-14 text-right text-[10.5px]">
              {saver.status === "saving" || saver.status === "pending" ? "Saving…" : "Saved"}
            </span>

            <button
              onClick={() => void onDelete(active.id)}
              aria-label="Delete note"
              className="text-ink-3 hover:text-danger rounded p-1 transition-colors"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </div>

          <Textarea
            value={active.body}
            onChange={(e) => {
              patchLocal(active.id, { body: e.target.value });
              persist(active.id, { body: e.target.value });
            }}
            aria-label="Note body"
            placeholder="Full lecture notes, references, background reading, anything you don't want on the slide."
            className="min-h-0 flex-1 !resize-none"
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
          <BookOpen className="text-ink-3 size-4" aria-hidden />
          <p className="text-ink-3 max-w-[280px] text-[12px] leading-relaxed">
            Lecture notes live alongside the deck but never appear on a slide. Use them for
            research, references and the parts of the story that don&apos;t fit on the stage.
          </p>
          <button
            onClick={onCreate}
            className="border-line text-ink-2 hover:border-line-strong hover:text-ink mt-1 rounded-[var(--radius-md)] border px-3 py-1.5 text-[12px] font-medium transition-colors"
          >
            Create a note
          </button>
        </div>
      )}
    </div>
  );
}
