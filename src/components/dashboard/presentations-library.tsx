"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  FileText,
  FolderPlus,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { PresentationSummary } from "@/lib/data/presentations";
import type { SceneContent } from "@/lib/schema/presentation";
import { PresentationCard } from "./presentation-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState, Badge } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import {
  createFolder,
  deleteFolder,
  purgePresentation,
  restorePresentation,
} from "@/lib/data/actions";
import { cn } from "@/lib/utils/cn";
import { relativeTime } from "@/lib/utils/format";

interface Filters {
  q: string;
  folder: string;
  tag: string;
  sort: string;
  view: string;
}

/**
 * The presentations library.
 *
 * Filtering lives in the URL rather than component state, so a filtered view is
 * shareable, survives a refresh, and works with the browser's back button.
 */
export function PresentationsLibrary({
  presentations,
  trashed,
  folders,
  tags,
  previews,
  filters,
}: {
  presentations: PresentationSummary[];
  trashed: PresentationSummary[];
  folders: { id: string; name: string; color: string; count: number }[];
  tags: { tag: string; count: number }[];
  previews: Record<string, SceneContent>;
  filters: Filters;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState(filters.q);
  const [newFolderOpen, setNewFolderOpen] = useState(false);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/presentations?${next.toString()}`);
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setParam("q", search.trim() || null);
  };

  const inTrash = filters.view === "trash";
  const items = inTrash ? trashed : presentations;
  const hasFilters = Boolean(filters.q || filters.folder || filters.tag || filters.view !== "all");

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-ink text-[22px] font-semibold tracking-tight">Presentations</h1>
        <div className="flex-1" />
        <Link href="/new">
          <Button variant="primary" size="sm">
            <Plus className="size-3.5" aria-hidden />
            New
          </Button>
        </Link>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <form onSubmit={submitSearch} className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search
            className="text-ink-3 absolute top-1/2 left-3 size-3.5 -translate-y-1/2"
            aria-hidden
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search presentations"
            aria-label="Search presentations"
            className="border-line text-ink placeholder:text-ink-3 focus:border-accent w-full rounded-[var(--radius-md)] border bg-[var(--surface-inset)] py-2 pr-8 pl-9 text-[13px] outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setParam("q", null);
              }}
              aria-label="Clear search"
              className="text-ink-3 hover:text-ink absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-0.5"
            >
              <X className="size-3" aria-hidden />
            </button>
          )}
        </form>

        <ViewTabs
          current={filters.view}
          onChange={(v) => setParam("view", v === "all" ? null : v)}
        />

        <div className="relative">
          <select
            value={filters.sort}
            onChange={(e) => setParam("sort", e.target.value === "recent" ? null : e.target.value)}
            aria-label="Sort presentations"
            className="border-line text-ink-2 focus:border-accent appearance-none rounded-[var(--radius-md)] border bg-[var(--surface-inset)] py-2 pr-8 pl-3 text-[12.5px] outline-none"
          >
            <option value="recent">Last edited</option>
            <option value="opened">Last opened</option>
            <option value="created">Date created</option>
            <option value="title">Title</option>
          </select>
          <ChevronDown
            className="text-ink-3 pointer-events-none absolute top-1/2 right-2.5 size-3 -translate-y-1/2"
            aria-hidden
          />
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[176px_minmax(0,1fr)]">
        <aside className="space-y-6">
          <nav aria-label="Folders">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-ink-3 text-[10px] font-medium tracking-wider uppercase">
                Folders
              </h2>
              <button
                onClick={() => setNewFolderOpen(true)}
                aria-label="New folder"
                className="text-ink-3 hover:text-ink rounded p-0.5 transition-colors hover:bg-[var(--surface-inset)]"
              >
                <FolderPlus className="size-3.5" aria-hidden />
              </button>
            </div>
            <ul className="space-y-0.5">
              <FolderRow
                label="All presentations"
                active={!filters.folder}
                onClick={() => setParam("folder", null)}
              />
              {folders.map((f) => (
                <FolderRow
                  key={f.id}
                  label={f.name}
                  count={f.count}
                  active={filters.folder === f.id}
                  onClick={() => setParam("folder", f.id)}
                  onDelete={() =>
                    start(async () => {
                      const result = await deleteFolder(f.id);
                      if (result.ok) {
                        toast({
                          tone: "success",
                          title: "Folder deleted",
                          description: "Its presentations moved to All presentations.",
                        });
                        if (filters.folder === f.id) setParam("folder", null);
                        else router.refresh();
                      } else {
                        toast({
                          tone: "error",
                          title: "Couldn't delete folder",
                          description: result.error,
                        });
                      }
                    })
                  }
                />
              ))}
              <FolderRow
                label="Unfiled"
                active={filters.folder === "none"}
                onClick={() => setParam("folder", "none")}
              />
            </ul>
          </nav>

          {tags.length > 0 && (
            <div>
              <h2 className="text-ink-3 mb-2 text-[10px] font-medium tracking-wider uppercase">
                Tags
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {tags.slice(0, 14).map((t) => (
                  <button
                    key={t.tag}
                    onClick={() => setParam("tag", filters.tag === t.tag ? null : t.tag)}
                    aria-pressed={filters.tag === t.tag}
                  >
                    <Badge tone={filters.tag === t.tag ? "accent" : "neutral"}>
                      {t.tag}
                      <span className="opacity-60">{t.count}</span>
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        <div className={cn(pending && "opacity-70")}>
          {items.length === 0 ? (
            <div className="border-line bg-raised/40 rounded-[var(--radius-lg)] border border-dashed">
              <EmptyState
                icon={inTrash ? Trash2 : FileText}
                title={
                  inTrash
                    ? "Nothing in Recently deleted"
                    : hasFilters
                      ? "Nothing matches those filters"
                      : "No presentations yet"
                }
                description={
                  inTrash
                    ? "Deleted presentations appear here and can be restored for 30 days."
                    : hasFilters
                      ? "Try a different folder, tag or search term."
                      : "Create one from a prompt, a template, or a blank stage."
                }
                action={
                  hasFilters && !inTrash ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => router.push("/presentations")}
                    >
                      Clear filters
                    </Button>
                  ) : !inTrash ? (
                    <Link href="/new">
                      <Button variant="primary" size="sm">
                        <Plus className="size-3.5" aria-hidden />
                        New presentation
                      </Button>
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : inTrash ? (
            <TrashList items={items} onChanged={() => router.refresh()} />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((p) => (
                <li key={p.id}>
                  <PresentationCard presentation={p} preview={previews[p.id] ?? null} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <NewFolderDialog open={newFolderOpen} onClose={() => setNewFolderOpen(false)} />
    </div>
  );
}

function ViewTabs({ current, onChange }: { current: string; onChange: (v: string) => void }) {
  const tabs = [
    { value: "all", label: "All" },
    { value: "favorites", label: "Favourites", icon: Star },
    { value: "trash", label: "Deleted", icon: Trash2 },
  ];

  return (
    <div className="border-line-subtle inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border bg-[var(--surface-inset)] p-0.5">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = current === tab.value;
        return (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            aria-pressed={active}
            className={cn(
              "flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[12px] font-medium transition-colors",
              active
                ? "bg-raised text-ink shadow-[var(--shadow-xs)]"
                : "text-ink-3 hover:text-ink-2",
            )}
          >
            {Icon && <Icon className="size-3" aria-hidden />}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function FolderRow({
  label,
  count,
  active,
  onClick,
  onDelete,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <li className="group/folder flex items-center">
      <button
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[12.5px] transition-colors",
          active ? "text-ink bg-[var(--surface-inset)] font-medium" : "text-ink-3 hover:text-ink-2",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && <span className="text-ink-3 shrink-0 text-[11px]">{count}</span>}
      </button>
      {onDelete && (
        <button
          onClick={onDelete}
          aria-label={`Delete folder ${label}`}
          className="text-ink-3 hover:text-danger shrink-0 rounded p-1 opacity-0 transition-opacity group-hover/folder:opacity-100 focus-visible:opacity-100"
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </li>
  );
}

function TrashList({ items, onChanged }: { items: PresentationSummary[]; onChanged: () => void }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [purgeTarget, setPurgeTarget] = useState<PresentationSummary | null>(null);

  return (
    <>
      <ul className="space-y-2">
        {items.map((p) => (
          <li
            key={p.id}
            className="border-line-subtle bg-raised flex items-center gap-3 rounded-[var(--radius-md)] border px-4 py-3"
          >
            <span className="min-w-0 flex-1">
              <span className="text-ink block truncate text-[13.5px] font-medium">{p.title}</span>
              <span className="text-ink-3 block text-[11.5px]">
                {p.sceneCount} scenes · edited {relativeTime(p.updatedAt)}
              </span>
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                start(async () => {
                  const result = await restorePresentation(p.id);
                  if (result.ok) {
                    toast({
                      tone: "success",
                      title: "Restored",
                      description: `“${p.title}” is back.`,
                    });
                    onChanged();
                  } else {
                    toast({ tone: "error", title: "Couldn't restore", description: result.error });
                  }
                })
              }
              loading={pending}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Restore
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPurgeTarget(p)}>
              Delete forever
            </Button>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={Boolean(purgeTarget)}
        onClose={() => setPurgeTarget(null)}
        loading={pending}
        title={`Permanently delete “${purgeTarget?.title}”?`}
        description="This removes the presentation and all of its scenes. It cannot be undone."
        confirmLabel="Delete forever"
        onConfirm={() =>
          start(async () => {
            if (!purgeTarget) return;
            const result = await purgePresentation(purgeTarget.id);
            setPurgeTarget(null);
            if (result.ok) {
              toast({ tone: "success", title: "Deleted permanently" });
              onChanged();
            } else {
              toast({ tone: "error", title: "Couldn't delete", description: result.error });
            }
          })
        }
      />
    </>
  );
}

function NewFolderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const result = await createFolder({ name });
      if (result.ok) {
        setName("");
        onClose();
        router.refresh();
      } else {
        toast({ tone: "error", title: "Couldn't create folder", description: result.error });
      }
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New folder"
      description="Folders group presentations. Deleting a folder never deletes its contents."
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            loading={pending}
            disabled={!name.trim()}
          >
            Create
          </Button>
        </>
      }
    >
      <Input
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) submit();
        }}
        placeholder="Paramedic year 2"
        data-autofocus
      />
    </Dialog>
  );
}
