"use client";

import { useMemo } from "react";
import { useEditor } from "@/lib/editor/store";
import { getTheme, categoricalHues } from "@/lib/schema/theme";
import { balance, formatDuration, pacingOf } from "@/lib/analysis/pacing";
import { cn } from "@/lib/utils/cn";

/**
 * The pacing strip.
 *
 * How the time is actually spread across the argument, at a glance. Each
 * movement is a segment as wide as the share of the talk it takes, so the
 * common failure — forty per cent of the room's attention spent on the setup —
 * is visible without reading a single number.
 *
 * Almost nobody sets a rehearsal target per scene, so the durations behind this
 * are estimated from the content: words spoken aloud, a beat per bullet, a
 * pause on each image and build. That is stated in the strip rather than
 * implied, because a number presented as measured when it was guessed is worse
 * than no number.
 */
export function PacingStrip({ className }: { className?: string }) {
  const scenes = useEditor((s) => s.document.scenes);
  const sections = useEditor((s) => s.document.sections);
  const themeId = useEditor((s) => s.document.presentation.themeId);

  const theme = useMemo(() => getTheme(themeId), [themeId]);
  const pacing = useMemo(() => pacingOf(scenes, sections), [scenes, sections]);
  const evenness = balance(pacing);
  const hues = categoricalHues(theme);

  if (scenes.length === 0) return null;

  const verdict = evenness >= 0.7 ? "Balanced" : evenness >= 0.45 ? "Uneven" : "Lopsided";

  return (
    <div className={cn("border-line-subtle bg-base border-t px-4 py-3", className)}>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-ink-3 text-[10px] font-medium tracking-wider uppercase">
            Pacing
          </span>
          <span
            className={cn(
              "text-[11px] font-medium",
              evenness >= 0.7 ? "text-ink-2" : "text-[var(--warning)]",
            )}
          >
            {verdict}
          </span>
        </div>
        <span className="text-ink-3 text-[11px] tabular-nums">
          {formatDuration(pacing.totalSeconds)}
          {pacing.anyAuthored ? "" : " estimated"}
        </span>
      </div>

      <div className="flex h-2 gap-[3px] overflow-hidden rounded-full">
        {pacing.movements.map((movement, index) => (
          <div
            key={`${movement.sectionId ?? "loose"}-${index}`}
            className="h-full rounded-full transition-[flex-grow] duration-500"
            style={{
              // Grow by share rather than a percentage width, so the gaps
              // between segments do not accumulate into a rounding error.
              flexGrow: Math.max(movement.share, 0.02),
              flexBasis: 0,
              background: hues[index % hues.length],
              opacity: 0.85,
            }}
            title={`${movement.label || "Unsectioned"} — ${formatDuration(movement.seconds)}`}
          />
        ))}
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {pacing.movements.map((movement, index) => (
          <span
            key={`label-${movement.sectionId ?? "loose"}-${index}`}
            className="text-ink-3 flex items-center gap-1.5 text-[10.5px]"
          >
            <span
              className="size-1.5 rounded-full"
              style={{ background: hues[index % hues.length] }}
              aria-hidden
            />
            {movement.label || "Unsectioned"}
            <span className="text-ink-3/70 tabular-nums">{formatDuration(movement.seconds)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
