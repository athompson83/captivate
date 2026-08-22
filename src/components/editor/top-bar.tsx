"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Cloud,
  Keyboard,
  Notebook,
  PanelLeft,
  Play,
  Redo2,
  Sparkles,
  Undo2,
} from "lucide-react";
import { THEMES } from "@/lib/schema/theme";
import { ASPECT_VALUES, type AspectRatio } from "@/lib/schema/presentation";
import { updatePresentationMeta, useEditor } from "@/lib/editor/store";
import { SHORTCUTS } from "@/lib/editor/shortcuts";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Popover, Tooltip, Segmented } from "@/components/ui/misc";
import { cn } from "@/lib/utils/cn";
import { relativeTime } from "@/lib/utils/format";

/**
 * Global editor controls. Deliberately thin: title, save state, history,
 * the panels, and Present. Everything else is contextual.
 */
/**
 * Which part of the job the editor is showing.
 *
 * Narrative first, deliberately: what you are going to say is a bigger
 * decision than how any one scene looks, and the order of the control says so.
 */
export type EditorView = "narrative" | "scene" | "journey";

export function EditorTopBar({
  presentationId,
  navOpen,
  onToggleNav,
  notesOpen,
  onToggleNotes,
  aiOpen,
  onToggleAi,
  onSave,
  view,
  onViewChange,
}: {
  presentationId: string;
  navOpen: boolean;
  onToggleNav: () => void;
  notesOpen: boolean;
  onToggleNotes: () => void;
  aiOpen: boolean;
  onToggleAi: () => void;
  onSave: () => void;
  view: EditorView;
  onViewChange: (view: EditorView) => void;
}) {
  const title = useEditor((s) => s.document.presentation.title);
  const themeId = useEditor((s) => s.document.presentation.themeId);
  const aspect = useEditor((s) => s.document.presentation.aspectRatio);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);

  const [themeOpen, setThemeOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  return (
    <header className="border-line-subtle bg-base flex h-14 shrink-0 items-center gap-2 border-b px-3">
      <Tooltip label="Back to presentations" side="bottom">
        <Link
          href="/presentations"
          aria-label="Back to presentations"
          className="text-ink-3 hover:text-ink flex size-8 items-center justify-center rounded-[var(--radius-md)] transition-colors hover:bg-[var(--surface-inset)]"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
      </Tooltip>

      <Tooltip label={navOpen ? "Hide scenes" : "Show scenes"} side="bottom">
        <button
          onClick={onToggleNav}
          aria-label={navOpen ? "Hide scene navigator" : "Show scene navigator"}
          aria-pressed={navOpen}
          className={cn(
            "flex size-8 items-center justify-center rounded-[var(--radius-md)] transition-colors",
            navOpen ? "text-ink bg-[var(--surface-inset)]" : "text-ink-3 hover:text-ink",
          )}
        >
          <PanelLeft className="size-4" aria-hidden />
        </button>
      </Tooltip>

      <TitleField title={title} />

      {/* Scene or world. Authoring one scene and authoring the route between
          scenes are different jobs, and they get different surfaces. */}
      <Segmented<EditorView>
        label="Editing view"
        size="sm"
        value={view}
        onChange={onViewChange}
        options={[
          { value: "narrative", label: "Narrative" },
          { value: "scene", label: "Scene" },
          { value: "journey", label: "Journey" },
        ]}
      />

      <SaveIndicator />

      <div className="flex-1" />

      <div className="flex items-center gap-0.5">
        <Tooltip label="Undo" shortcut="⌘Z" side="bottom">
          <button
            onClick={undo}
            disabled={!canUndo}
            aria-label="Undo"
            className="text-ink-3 hover:text-ink flex size-8 items-center justify-center rounded-[var(--radius-md)] transition-colors hover:bg-[var(--surface-inset)] disabled:pointer-events-none disabled:opacity-30"
          >
            <Undo2 className="size-4" aria-hidden />
          </button>
        </Tooltip>
        <Tooltip label="Redo" shortcut="⇧⌘Z" side="bottom">
          <button
            onClick={redo}
            disabled={!canRedo}
            aria-label="Redo"
            className="text-ink-3 hover:text-ink flex size-8 items-center justify-center rounded-[var(--radius-md)] transition-colors hover:bg-[var(--surface-inset)] disabled:pointer-events-none disabled:opacity-30"
          >
            <Redo2 className="size-4" aria-hidden />
          </button>
        </Tooltip>
      </div>

      <span aria-hidden className="bg-line-subtle mx-1 h-5 w-px" />

      {/* Theme picker */}
      <div className="relative">
        <button
          onClick={() => setThemeOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={themeOpen}
          className="border-line text-ink-2 hover:border-line-strong hover:text-ink flex items-center gap-2 rounded-[var(--radius-md)] border px-2.5 py-1.5 text-[12.5px] transition-colors"
        >
          <span
            aria-hidden
            className="border-line-subtle size-3 rounded-full border"
            style={{ background: THEMES.find((t) => t.id === themeId)?.tokens.accent }}
          />
          {THEMES.find((t) => t.id === themeId)?.name ?? "Theme"}
        </button>

        <Popover
          open={themeOpen}
          onClose={() => setThemeOpen(false)}
          anchor="bottom-end"
          className="w-[288px]"
        >
          <div role="menu">
            <p className="text-ink-3 px-2.5 pt-1 pb-1.5 text-[11px] leading-snug">
              Themes only change tokens — your content is untouched.
            </p>
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                role="menuitemradio"
                aria-checked={theme.id === themeId}
                onClick={() => {
                  updatePresentationMeta({ themeId: theme.id }, { label: "Change theme" });
                  setThemeOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-inset)]",
                  theme.id === themeId && "bg-[var(--surface-inset)]",
                )}
              >
                <span
                  aria-hidden
                  className="border-line-subtle mt-0.5 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border"
                  style={{ background: theme.tokens.canvas }}
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: theme.tokens.accent }}
                  />
                </span>
                <span className="min-w-0">
                  <span className="text-ink block text-[12.5px] font-medium">{theme.name}</span>
                  <span className="text-ink-3 block text-[11px] leading-snug">
                    {theme.description}
                  </span>
                </span>
              </button>
            ))}

            <div className="border-line-subtle my-1.5 border-t" />
            <div className="px-2.5 pb-1.5">
              <p className="text-ink-3 mb-1.5 text-[10px] font-medium tracking-wider uppercase">
                Aspect ratio
              </p>
              <Segmented<AspectRatio>
                label="Aspect ratio"
                size="sm"
                value={aspect}
                onChange={(v) =>
                  updatePresentationMeta({ aspectRatio: v }, { label: "Change aspect ratio" })
                }
                options={(Object.keys(ASPECT_VALUES) as AspectRatio[]).map((v) => ({
                  value: v,
                  label: v,
                }))}
              />
            </div>
          </div>
        </Popover>
      </div>

      <Tooltip label="Notes" shortcut="N" side="bottom">
        <button
          onClick={onToggleNotes}
          aria-label="Toggle notes"
          aria-pressed={notesOpen}
          className={cn(
            "flex size-8 items-center justify-center rounded-[var(--radius-md)] transition-colors",
            notesOpen ? "text-ink bg-[var(--surface-inset)]" : "text-ink-3 hover:text-ink",
          )}
        >
          <Notebook className="size-4" aria-hidden />
        </button>
      </Tooltip>

      <Tooltip label="AI assistant" shortcut="I" side="bottom">
        <button
          onClick={onToggleAi}
          aria-label="Toggle AI assistant"
          aria-pressed={aiOpen}
          className={cn(
            "flex size-8 items-center justify-center rounded-[var(--radius-md)] transition-colors",
            aiOpen ? "text-ai-text bg-[var(--ai-soft)]" : "text-ink-3 hover:text-ai-text",
          )}
        >
          <Sparkles className="size-4" aria-hidden />
        </button>
      </Tooltip>

      <Tooltip label="Keyboard shortcuts" side="bottom">
        <button
          onClick={() => setShortcutsOpen(true)}
          aria-label="Keyboard shortcuts"
          className="text-ink-3 hover:text-ink flex size-8 items-center justify-center rounded-[var(--radius-md)] transition-colors"
        >
          <Keyboard className="size-4" aria-hidden />
        </button>
      </Tooltip>

      <Link href={`/present/${presentationId}`} onClick={onSave}>
        <Button variant="primary" size="sm">
          <Play className="size-3.5" aria-hidden />
          Present
        </Button>
      </Link>

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </header>
  );
}

function TitleField({ title }: { title: string }) {
  const [draft, setDraft] = useState(title);
  const [editing, setEditing] = useState(false);

  // Keep in sync when the title changes from elsewhere (undo, AI rename).
  if (!editing && draft !== title) setDraft(title);

  return (
    <input
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        updatePresentationMeta(
          { title: e.target.value },
          { label: "Rename", coalesceKey: "title" },
        );
      }}
      onFocus={() => setEditing(true)}
      onBlur={() => setEditing(false)}
      aria-label="Presentation title"
      placeholder="Untitled presentation"
      className="text-ink hover:border-line-subtle focus:border-line max-w-[280px] min-w-0 flex-shrink rounded-[var(--radius-sm)] border border-transparent bg-transparent px-2 py-1 text-[13.5px] font-medium transition-colors focus:bg-[var(--surface-inset)]"
    />
  );
}

/** Save state, phrased for a human rather than as a status code. */
function SaveIndicator() {
  const state = useEditor((s) => s.saveState);
  const error = useEditor((s) => s.saveError);
  const lastSavedAt = useEditor((s) => s.lastSavedAt);

  const content = {
    idle: { icon: Cloud, text: "All changes saved", tone: "text-ink-3" },
    dirty: { icon: Cloud, text: "Unsaved changes", tone: "text-ink-3" },
    saving: { icon: Cloud, text: "Saving…", tone: "text-ink-3" },
    saved: { icon: Check, text: "Saved", tone: "text-success" },
    error: { icon: AlertCircle, text: "Couldn't save", tone: "text-danger" },
  }[state];

  const Icon = content.icon;

  return (
    <Tooltip
      label={
        state === "error"
          ? (error ?? "Saving failed")
          : lastSavedAt
            ? `Last saved ${relativeTime(lastSavedAt)}`
            : "Not saved yet"
      }
      side="bottom"
    >
      <span
        role="status"
        aria-live="polite"
        className={cn("flex items-center gap-1.5 text-[11.5px] whitespace-nowrap", content.tone)}
      >
        <Icon className={cn("size-3.5", state === "saving" && "animate-pulse")} aria-hidden />
        <span className="hidden lg:inline">{content.text}</span>
      </span>
    </Tooltip>
  );
}

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" size="md">
      <div className="space-y-5">
        {groups.map((group) => (
          <div key={group}>
            <p className="text-ink-3 mb-2 text-[10px] font-medium tracking-wider uppercase">
              {group}
            </p>
            <dl className="space-y-1.5">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.keys} className="flex items-center justify-between gap-4">
                  <dt className="text-ink-2 text-[13px]">{s.action}</dt>
                  <dd>
                    <kbd className="border-line-subtle text-ink-3 rounded border bg-[var(--surface-inset)] px-1.5 py-0.5 font-sans text-[11px]">
                      {s.keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
