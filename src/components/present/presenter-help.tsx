"use client";

import { motion } from "motion/react";
import { PRESENTER_KEYS } from "@/lib/present/keys";

/**
 * The keys, over the stage.
 *
 * Presenter-facing, like the timer: it renders in the stage window because
 * single-screen presenting has nowhere else to put it, and it is gated on
 * audience-only mode like everything else that is the presenter's. It holds
 * no private material, so the load boundary is not in question.
 */
export function PresenterHelp({ onClose }: { onClose: () => void }) {
  const groups = [...new Set(PRESENTER_KEYS.map((k) => k.group))];
  return (
    <motion.div
      role="dialog"
      aria-label="Presenter keys"
      data-presenter-help
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      className="absolute inset-0 z-40 grid place-items-center bg-black/60 backdrop-blur-[2px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[86vh] w-[min(92vw,44rem)] overflow-y-auto rounded-[var(--radius-xl)] border border-white/12 bg-black/85 p-7 text-white shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      >
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <h2 className="text-[15px] font-semibold">Keys</h2>
          <p className="text-[11.5px] text-white/50">
            Press <kbd className="rounded border border-white/20 px-1 font-sans">?</kbd> or{" "}
            <kbd className="rounded border border-white/20 px-1 font-sans">Esc</kbd> to close
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {groups.map((group) => (
            <div key={group}>
              <p className="mb-2 text-[10px] font-medium tracking-wider text-white/45 uppercase">
                {group}
              </p>
              <dl className="space-y-1.5">
                {PRESENTER_KEYS.filter((k) => k.group === group).map((k) => (
                  <div key={k.keys} className="flex items-baseline justify-between gap-4">
                    <dt className="text-[13px] text-white/85">{k.action}</dt>
                    <dd className="shrink-0">
                      <kbd className="rounded border border-white/15 bg-white/6 px-1.5 py-0.5 font-sans text-[11px] whitespace-pre text-white/70">
                        {k.keys}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
