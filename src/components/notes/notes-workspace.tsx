"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, Notebook, Plus, Search, Trash2 } from "lucide-react";
import type { LectureNote } from "@/lib/data/notes";
import { createNote, deleteNote, updateNote } from "@/lib/data/notes";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { relativeTime } from "@/lib/utils/format";

/**
 * The lecture-notes workspace.
 *
 * A full-page writing surface, because the educators this is for are writing
 * thousands of words of teaching material — not a sentence in a sidebar. Notes
 * are stored separately from scenes and never appear on a slide.
 */
export function NotesWorkspace({
  initialNotes,
  presentations,
  filterPresentationId,
  initialNoteId,
}: {
  initialNotes: LectureNote[];
  presentations: { id: string; title: string }[];
  filterPresentationId: string | null;
  initialNoteId: string | null;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState(initialNotes);
  const [activeId, setActiveId] = useState<string | null>(
    initialNoteId ?? initialNotes[0]?.id ?? null,
  );
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LectureNote | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const active = notes.find((n) => n.id === activeId) ?? null;

  const persist = useCallback(
    (id: string, patch: { title?: string; body?: string; presentationId?: string | null }) => {
      clearTimeout(saveTimer.current);
      setSaving(true);
      saveTimer.current = setTimeout(async () => {
        const result = await updateNote({ id, ...patch });
        setSaving(false);
        if (!result.ok) {
          toast({ tone: "error", title: "Note not saved", description: result.error });
        }
      }, 700);
    },
    [toast],
  );

  const patchLocal = (id: string, patch: Partial<LectureNote>) =>
    setNotes((current) => current.map((n) => (n.id === id ? { ...n, ...patch } : n)));

  const create = async () => {
    const result = await createNote({
      presentationId: filterPresentationId,
      title: "Untitled note",
    });
    if (!result.ok) {
      toast({ tone: "error", title: "Couldn't create the note", description: result.error });
      return;
    }
    setNotes((current) => [result.data, ...current]);
    setActiveId(result.data.id);
  };

  const remove = async (note: LectureNote) => {
    const result = await deleteNote(note.id);
    setDeleteTarget(null);
    if (!result.ok) {
      toast({ tone: "error", title: "Couldn't delete", description: result.error });
      return;
    }
    setNotes((current) => {
      const next = current.filter((n) => n.id !== note.id);
      setActiveId((a) => (a === note.id ? (next[0]?.id ?? null) : a));
      return next;
    });
  };

  const filtered = notes.filter((n) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q);
  });

  const wordCount = active ? active.body.trim().split(/\s+/).filter(Boolean).length : 0;

  return (
    <div className="grid h-[calc(100vh-0px)] grid-cols-1 md:h-screen md:grid-cols-[268px_minmax(0,1fr)]">
      <aside className="border-line-subtle flex min-h-0 flex-col border-b md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 pt-5 pb-3">
          <h1 className="text-ink flex-1 text-[16px] font-semibold tracking-tight">Notes</h1>
          <Button variant="secondary" size="xs" onClick={create}>
            <Plus className="size-3" aria-hidden />
            New
          </Button>
        </div>

        <div className="px-4 pb-3">
          <div className="relative">
            <Search
              className="text-ink-3 absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes"
              aria-label="Search notes"
              className="border-line text-ink placeholder:text-ink-3 focus:border-accent w-full rounded-[var(--radius-md)] border bg-[var(--surface-inset)] py-1.5 pr-2.5 pl-8 text-[12.5px] outline-none"
            />
          </div>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {filtered.length === 0 && (
            <li className="text-ink-3 px-3 py-8 text-center text-[12px] leading-relaxed">
              {query ? "No notes match." : "No notes yet."}
            </li>
          )}
          {filtered.map((note) => {
            const presentation = presentations.find((p) => p.id === note.presentationId);
            return (
              <li key={note.id}>
                <button
                  onClick={() => setActiveId(note.id)}
                  aria-current={note.id === activeId ? "true" : undefined}
                  className={cn(
                    "w-full rounded-[var(--radius-md)] px-2.5 py-2 text-left transition-colors",
                    note.id === activeId
                      ? "bg-[var(--accent-soft)]"
                      : "hover:bg-[var(--surface-inset)]",
                  )}
                >
                  <span className="text-ink block truncate text-[13px] font-medium">
                    {note.title || "Untitled note"}
                  </span>
                  <span className="text-ink-3 mt-0.5 block truncate text-[11px]">
                    {presentation ? presentation.title : "Standalone"} ·{" "}
                    {relativeTime(note.updatedAt)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {active ? (
        <div className="flex min-h-0 flex-col">
          <div className="border-line-subtle flex flex-wrap items-center gap-2 border-b px-5 py-3">
            <input
              value={active.title}
              onChange={(e) => {
                patchLocal(active.id, { title: e.target.value });
                persist(active.id, { title: e.target.value });
              }}
              aria-label="Note title"
              placeholder="Untitled note"
              className="text-ink hover:border-line-subtle focus:border-line min-w-0 flex-1 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-2 py-1 text-[17px] font-semibold tracking-tight transition-colors focus:bg-[var(--surface-inset)]"
            />

            <div className="relative">
              <select
                value={active.presentationId ?? ""}
                onChange={(e) => {
                  const presentationId = e.target.value || null;
                  patchLocal(active.id, { presentationId });
                  persist(active.id, { presentationId });
                }}
                aria-label="Attach to a presentation"
                className="border-line text-ink-2 focus:border-accent appearance-none rounded-[var(--radius-md)] border bg-[var(--surface-inset)] py-1.5 pr-7 pl-2.5 text-[12px] outline-none"
              >
                <option value="">Standalone note</option>
                {presentations.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="text-ink-3 pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2"
                aria-hidden
              />
            </div>

            {active.presentationId && (
              <Link
                href={`/edit/${active.presentationId}`}
                className="border-line text-ink-2 hover:border-line-strong hover:text-ink flex items-center gap-1 rounded-[var(--radius-md)] border px-2.5 py-1.5 text-[12px] transition-colors"
              >
                Open deck
                <ExternalLink className="size-3" aria-hidden />
              </Link>
            )}

            <button
              onClick={() => setDeleteTarget(active)}
              aria-label="Delete note"
              className="text-ink-3 hover:text-danger rounded p-1.5 transition-colors"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>

          <textarea
            value={active.body}
            onChange={(e) => {
              patchLocal(active.id, { body: e.target.value });
              persist(active.id, { body: e.target.value });
            }}
            aria-label="Note body"
            placeholder="Everything behind the deck: your full script, references, background reading, the questions you want to ask the room."
            className="text-ink placeholder:text-ink-3 min-h-0 flex-1 resize-none bg-transparent px-5 py-5 text-[15px] leading-[1.75] outline-none sm:px-8"
          />

          <div className="border-line-subtle text-ink-3 flex items-center justify-between border-t px-5 py-2 text-[11px] sm:px-8">
            <span>{wordCount.toLocaleString()} words</span>
            <span aria-live="polite">
              {saving ? "Saving…" : `Saved ${relativeTime(active.updatedAt)}`}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center">
          <EmptyState
            icon={Notebook}
            title="Lecture notes"
            description="Long-form material that belongs with a presentation but never on a slide. Notes attached to a scene appear in your presenter console while you speak."
            action={
              <Button variant="primary" size="sm" onClick={create}>
                <Plus className="size-3.5" aria-hidden />
                Write your first note
              </Button>
            }
          />
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && void remove(deleteTarget)}
        title={`Delete “${deleteTarget?.title}”?`}
        description="This note will be permanently removed. Presentations are unaffected."
        confirmLabel="Delete note"
      />
    </div>
  );
}
