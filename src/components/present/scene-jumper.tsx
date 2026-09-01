"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Search } from "lucide-react";
import type { Scene, Section } from "@/lib/schema/presentation";
import { getTheme } from "@/lib/schema/theme";
import { StageThumbnail } from "@/components/stage/stage";
import { plainText } from "@/lib/schema/presentation";
import { jumpTargets } from "@/lib/present/running-order";
import { cn } from "@/lib/utils/cn";

/**
 * Grid of every scene, searchable by title and on-scene text.
 *
 * This is how a presenter answers "can you go back to the slide with the
 * algorithm on it" without scrubbing through forty scenes in front of a room.
 */
export function SceneJumper({
  open,
  onClose,
  scenes,
  sections,
  currentIndex,
  onSelect,
  title,
  themeId = "midnight",
}: {
  open: boolean;
  onClose: () => void;
  scenes: Scene[];
  sections: Section[];
  currentIndex: number;
  onSelect: (index: number) => void;
  title: string;
  themeId?: string;
}) {
  const [query, setQuery] = useState("");
  const theme = getTheme(themeId);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const searchable = useMemo(
    () =>
      // Detail scenes are reached by diving into a hotspot, not by jumping —
      // listing them would offer the presenter a destination with no way back
      // into the argument. `jumpTargets` carries both numbers: `index` for
      // `onSelect`, which must stay the real array position, and `ordinal` for
      // the label, which must match the progress bar beside it.
      jumpTargets(scenes).map(({ scene, index, ordinal }) => ({
        index,
        ordinal,
        scene,
        text: [
          scene.title,
          ...scene.content.elements.map((el) =>
            el.type === "heading" || el.type === "text" || el.type === "quote"
              ? plainText(el.content)
              : el.type === "list"
                ? el.items.map((i) => plainText(i)).join(" ")
                : el.type === "callout"
                  ? el.title
                  : "",
          ),
        ]
          .join(" ")
          .toLowerCase(),
      })),
    [scenes],
  );

  const filtered = query.trim()
    ? searchable.filter((s) => s.text.includes(query.trim().toLowerCase()))
    : searchable;

  const sectionFor = (scene: Scene) =>
    sections.find((s) => s.id === scene.sectionId)?.title ?? null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Jump to a scene"
          className="fixed inset-0 z-50 overflow-y-auto bg-black/88 backdrop-blur-sm"
        >
          <div className="mx-auto max-w-6xl px-6 py-8" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center gap-4">
              <h2 className="truncate text-[15px] font-medium text-white">{title}</h2>
              <div className="relative ml-auto w-full max-w-xs">
                <Search
                  className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-white/45"
                  aria-hidden
                />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search scenes"
                  aria-label="Search scenes"
                  className="w-full rounded-full border border-white/15 bg-white/8 py-2 pr-3 pl-9 text-[13px] text-white outline-none placeholder:text-white/40 focus:border-white/35"
                />
              </div>
              <button
                onClick={onClose}
                className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-[12px] text-white/75 transition-colors hover:bg-white/10 hover:text-white"
              >
                Close
              </button>
            </div>

            {filtered.length === 0 ? (
              <p className="py-16 text-center text-[13px] text-white/50">
                No scene matches “{query}”.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {filtered.map(({ scene, index, ordinal }) => (
                  <li key={scene.id}>
                    <button
                      onClick={() => onSelect(index)}
                      aria-current={index === currentIndex ? "true" : undefined}
                      className={cn(
                        "group w-full overflow-hidden rounded-[var(--radius-md)] border-2 text-left transition-colors",
                        index === currentIndex
                          ? "border-[var(--accent)]"
                          : "border-white/12 hover:border-white/40",
                      )}
                    >
                      <ThumbBox
                        content={scene.content}
                        themeId={themeId}
                        aspect="16:9"
                        theme={theme}
                      />
                      <span className="flex items-baseline gap-2 bg-black/50 px-2.5 py-1.5">
                        <span className="text-[11px] text-white/50 tabular-nums">{ordinal}</span>
                        <span className="min-w-0 flex-1 truncate text-[12px] text-white/90">
                          {scene.title || "Untitled"}
                        </span>
                        {sectionFor(scene) && (
                          <span className="shrink-0 truncate text-[10px] text-white/40">
                            {sectionFor(scene)}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ThumbBox({
  content,
  aspect,
  theme,
}: {
  content: Scene["content"];
  themeId: string;
  aspect: "16:9" | "16:10" | "4:3";
  theme: ReturnType<typeof getTheme>;
}) {
  const [width, setWidth] = useState(0);

  return (
    <span
      ref={(node) => {
        if (!node) return;
        setWidth(node.getBoundingClientRect().width);
      }}
      className="block aspect-video w-full overflow-hidden bg-black"
    >
      {width > 0 && (
        <StageThumbnail content={content} theme={theme} aspect={aspect} width={width} />
      )}
    </span>
  );
}
