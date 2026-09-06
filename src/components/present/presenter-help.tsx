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
export function PresenterHelp({ onClose, plain }: { onClose: () => void; plain: boolean }) {
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

        {/* The escape hatch, where a presenter can find it.
            A browser dying mid-presentation has been reported repeatedly from
            a phone. Measured here, the world is light — three live
            photographs, 28 MB of decoded bitmap and a 1.3 MB WebGL canvas,
            flat however long the deck — so nothing in the measurements
            explains it and this is not offered as a fix. What it is: the
            single most expensive object on the page, removed, in one tap,
            from inside the presentation that is failing. Stated as what it is
            rather than dressed up as a preference. */}
        <div className="mt-6 border-t border-white/10 pt-4">
          <p className="text-[10px] font-medium tracking-wider text-white/45 uppercase">
            If this device is struggling
          </p>
          {plain ? (
            <p className="mt-2 text-[12.5px] text-white/70">
              Presenting without the atmospheric field. The deck, the camera and every picture are
              unchanged.{" "}
              <a href="?" className="text-white underline underline-offset-2">
                Turn the field back on
              </a>
              .
            </p>
          ) : (
            <p className="mt-2 text-[12.5px] text-white/70">
              <a href="?plain=1" className="text-white underline underline-offset-2">
                Present without the atmospheric field
              </a>{" "}
              — it drops the WebGL layer, which is the heaviest thing on this page. Nothing about
              the deck changes.
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
