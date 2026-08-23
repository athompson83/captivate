"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, X } from "lucide-react";
import { analyse, type CheckStatus } from "@/lib/analysis/health";
import { formatDuration } from "@/lib/analysis/pacing";
import { useEditor } from "@/lib/editor/store";
import { cn } from "@/lib/utils/cn";

/**
 * Presentation health.
 *
 * A score that cannot be argued with is not worth showing, so this is only ever
 * the weighted mean of the checks below it — and every check states what it
 * found and what to do about it. Nothing here reports an "engagement score" or
 * any other number a presenter cannot act on.
 *
 * It runs entirely on the document already in the store. No request, no
 * waiting, and it moves as the deck does.
 */
export function HealthPanel() {
  const document = useEditor((s) => s.document);
  const health = useMemo(() => analyse(document), [document]);
  const [open, setOpen] = useState(false);

  const failing = health.checks.filter((check) => check.status !== "pass");

  return (
    <section className="border-line-subtle border-t pt-4">
      <div className="flex items-center gap-3">
        <ScoreRing score={health.score} />
        <div className="min-w-0">
          <p className="text-ink text-[12.5px] font-semibold">{health.grade}</p>
          <p className="text-ink-3 text-[11px]">
            {formatDuration(health.pacing.totalSeconds)}
            {health.pacing.anyAuthored ? "" : " estimated"}
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {health.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-2">
            <StatusIcon status={check.status} />
            <span className="min-w-0 flex-1">
              <span className="text-ink-2 block text-[11.5px] leading-snug">{check.label}</span>
              {(open || check.status !== "pass") && (
                <span className="text-ink-3 mt-0.5 block text-[11px] leading-snug">
                  {check.detail}
                  {open && check.fix ? ` ${check.fix}` : ""}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-ink-3 hover:text-ink mt-2.5 flex items-center gap-1 text-[11px] transition-colors"
      >
        {open ? "Hide detail" : failing.length ? "How to fix" : "View report"}
        <ChevronDown
          className={cn("size-3 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
    </section>
  );
}

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === "pass") {
    return (
      <Check className="mt-[3px] size-3 shrink-0 text-[var(--success)]" aria-label="Passing" />
    );
  }
  if (status === "warn") {
    return <AlertTriangle className="text-accent mt-[3px] size-3 shrink-0" aria-label="Warning" />;
  }
  return <X className="text-danger mt-[3px] size-3 shrink-0" aria-label="Failing" />;
}

/**
 * The score, drawn as an arc.
 *
 * The arc is a fraction of the circumference rather than an animated sweep:
 * this re-renders on every keystroke in the deck, and a transition that
 * restarts each time reads as a flicker rather than as feedback.
 */
function ScoreRing({ score }: { score: number }) {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const tone = score >= 85 ? "var(--success)" : score >= 65 ? "var(--accent)" : "var(--danger)";

  return (
    <div className="relative size-10 shrink-0">
      <svg viewBox="0 0 40 40" className="size-full -rotate-90" aria-hidden>
        <circle cx="20" cy="20" r={radius} fill="none" stroke="var(--line)" strokeWidth="3" />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * circumference} ${circumference}`}
        />
      </svg>
      <span
        className="text-ink absolute inset-0 flex items-center justify-center text-[12px] font-semibold tabular-nums"
        role="status"
        aria-label={`Presentation health ${score} out of 100`}
      >
        {score}
      </span>
    </div>
  );
}
