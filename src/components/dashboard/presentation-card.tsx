"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { Copy, MoreHorizontal, Pencil, Play, Star, Trash2 } from "lucide-react";
import type { PresentationSummary } from "@/lib/data/presentations";
import type { SceneContent } from "@/lib/schema/presentation";
import { getTheme } from "@/lib/schema/theme";
import { StageThumbnail } from "@/components/stage/stage";
import { Popover, MenuItem } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { deletePresentation, duplicatePresentation, updatePresentation } from "@/lib/data/actions";
import { cn } from "@/lib/utils/cn";
import { relativeTime } from "@/lib/utils/format";

/**
 * A deck card. The thumbnail is a *live render* of the first scene rather than
 * a stored image, so it is never stale and there is no thumbnail pipeline to
 * get wrong.
 */
export function PresentationCard({
  presentation,
  preview,
}: {
  presentation: PresentationSummary;
  preview: SceneContent | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [favorite, setFavorite] = useState(presentation.isFavorite);
  const [pending, start] = useTransition();

  const theme = getTheme(presentation.themeId);

  const toggleFavorite = () => {
    const next = !favorite;
    setFavorite(next); // Optimistic: this is trivially reversible.
    start(async () => {
      const res = await updatePresentation({ id: presentation.id, isFavorite: next });
      if (!res.ok) {
        setFavorite(!next);
        toast({ tone: "error", title: "Couldn't update", description: res.error });
      } else {
        router.refresh();
      }
    });
  };

  const onDuplicate = () =>
    start(async () => {
      const res = await duplicatePresentation(presentation.id);
      if (res.ok) {
        toast({
          tone: "success",
          title: "Duplicated",
          description: `“${presentation.title} copy” is ready.`,
        });
        router.refresh();
      } else {
        toast({ tone: "error", title: "Couldn't duplicate", description: res.error });
      }
    });

  const onDelete = () =>
    start(async () => {
      const res = await deletePresentation(presentation.id);
      setConfirmDelete(false);
      if (res.ok) {
        toast({
          tone: "success",
          title: "Moved to Recently deleted",
          description: "You can restore it from Presentations.",
        });
        router.refresh();
      } else {
        toast({ tone: "error", title: "Couldn't delete", description: res.error });
      }
    });

  return (
    <div
      className={cn(
        "group border-line-subtle bg-raised relative flex flex-col overflow-hidden rounded-[var(--radius-lg)] border",
        "transition-[border-color,box-shadow,transform] duration-[var(--duration-base)]",
        "hover:border-line hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]",
        "motion-reduce:transition-none motion-reduce:transform-none",
        pending && "opacity-70",
      )}
    >
      <Link
        href={`/edit/${presentation.id}`}
        className="bg-sunken relative block aspect-video overflow-hidden"
        aria-label={`Edit ${presentation.title}`}
      >
        {preview ? (
          <div className="pointer-events-none absolute inset-0">
            <StageThumbnailFill
              content={preview}
              themeId={presentation.themeId}
              aspect={presentation.aspectRatio}
            />
          </div>
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: theme.tokens.canvas }}
            aria-hidden
          />
        )}

        {/* Present shortcut appears on hover; editing stays the default click. */}
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100">
          <span className="flex items-center gap-1.5 rounded-full bg-white/95 px-3.5 py-1.5 text-[12px] font-medium text-black">
            <Pencil className="size-3" aria-hidden />
            Open editor
          </span>
        </span>
      </Link>

      <div className="flex items-start gap-2 p-3.5">
        <div className="min-w-0 flex-1">
          <Link
            href={`/edit/${presentation.id}`}
            className="text-ink hover:text-accent-text block truncate text-[13.5px] font-medium"
          >
            {presentation.title}
          </Link>
          <p className="text-ink-3 mt-0.5 truncate text-[11.5px]">
            {presentation.sceneCount} {presentation.sceneCount === 1 ? "scene" : "scenes"}
            {" · "}
            {relativeTime(presentation.updatedAt)}
            {presentation.folderName && ` · ${presentation.folderName}`}
          </p>
        </div>

        <button
          onClick={toggleFavorite}
          aria-label={favorite ? "Remove from favourites" : "Add to favourites"}
          aria-pressed={favorite}
          className={cn(
            "rounded p-1 transition-colors",
            favorite
              ? "text-accent"
              : "text-ink-3 hover:text-ink-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <Star className="size-3.5" fill={favorite ? "currentColor" : "none"} aria-hidden />
        </button>

        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={`Actions for ${presentation.title}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="text-ink-3 hover:text-ink rounded p-1 opacity-0 transition-colors group-hover:opacity-100 focus-visible:opacity-100"
          >
            <MoreHorizontal className="size-3.5" aria-hidden />
          </button>
          <Popover
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            anchor="bottom-end"
            className="w-[188px]"
          >
            <div role="menu">
              <Link href={`/edit/${presentation.id}`} onClick={() => setMenuOpen(false)}>
                <MenuItem icon={Pencil} label="Edit" />
              </Link>
              <Link href={`/present/${presentation.id}`} onClick={() => setMenuOpen(false)}>
                <MenuItem icon={Play} label="Present" />
              </Link>
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
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
              />
            </div>
          </Popover>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={onDelete}
        loading={pending}
        title={`Delete “${presentation.title}”?`}
        description="It moves to Recently deleted and can be restored for 30 days."
        confirmLabel="Move to deleted"
      />
    </div>
  );
}

/** Thumbnail that fills whatever box it is given, re-measuring on resize. */
function StageThumbnailFill({
  content,
  themeId,
  aspect,
}: {
  content: SceneContent;
  themeId: string;
  aspect: PresentationSummary["aspectRatio"];
}) {
  const [width, setWidth] = useState(0);
  const theme = getTheme(themeId);

  const measureRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={measureRef} className="absolute inset-0">
      {width > 0 && (
        <StageThumbnail content={content} theme={theme} aspect={aspect} width={width} />
      )}
    </div>
  );
}
