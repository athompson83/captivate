"use client";

import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * The count before a recording, shown to the presenter.
 *
 * It sits over the stage but the stage is not yet being captured, so none of
 * this reaches the file; its job is to give the presenter the beat between
 * agreeing to record and being recorded. Escape or the button cancels.
 */
export function RecordingCountdown({ count, onCancel }: { count: number; onCancel: () => void }) {
  const reduced = useReducedMotion();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <motion.div
      data-countdown
      role="status"
      aria-live="assertive"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      className="absolute inset-0 z-40 grid place-items-center bg-black/55 backdrop-blur-[2px]"
    >
      <div className="flex flex-col items-center gap-5 text-center">
        <p className="text-[13px] font-medium tracking-[0.18em] text-white/60 uppercase">
          Recording starts in
        </p>
        {/* Keyed on the number so each one arrives fresh rather than mutating in place. */}
        <motion.span
          key={count}
          aria-hidden
          initial={reduced ? false : { opacity: 0, scale: 1.25 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="font-display text-[clamp(6rem,18vw,13rem)] leading-none font-semibold tracking-[-0.04em] text-white tabular-nums"
        >
          {count}
        </motion.span>
        <span className="sr-only">{count}</span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-white/15 bg-white/8 px-4 py-2 text-[12.5px] font-medium text-white/85 transition-colors hover:bg-white/14 hover:text-white"
        >
          Cancel
          <span className="ml-2 text-white/45">Esc</span>
        </button>
      </div>
    </motion.div>
  );
}
