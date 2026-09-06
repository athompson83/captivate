"use client";

import { motion } from "motion/react";

/**
 * The closing image, dressed.
 *
 * Past the last scene the camera pulls back over the whole argument, and that
 * was the end: the room was left looking at a map with nothing to say it was
 * over. This names the moment — the title of the thing they have just been
 * shown, set over the whole of it — and doubles as the outro of a recording,
 * which captures the stage as shown.
 *
 * It arrives after the pull-back lands rather than with it, so the flight is
 * seen; the lights come down a little around the centre so the title reads
 * over any deck. Pointer events pass through: the map is still live, and a
 * scene can be clicked from here.
 */
export function ClosingFrame({ title }: { title: string }) {
  const shown = title.trim() || "The end";
  return (
    <motion.div
      data-closing
      role="status"
      aria-label={`The end: ${shown}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.9, delay: 0.7, ease: [0.22, 1, 0.36, 1] } }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
      className="pointer-events-none absolute inset-0 z-20 grid place-items-center"
    >
      <div
        className="absolute inset-0 bg-black/50 [mask-image:radial-gradient(ellipse_at_center,black_15%,transparent_72%)]"
        aria-hidden
      />
      <div className="relative max-w-[min(80vw,52rem)] px-8 text-center">
        <p className="mx-auto mb-6 h-px w-14 bg-white/55" aria-hidden />
        <h2
          className="text-[clamp(1.75rem,5vw,4.5rem)] leading-[1.05] font-semibold tracking-[-0.02em] text-balance text-white [text-shadow:0_2px_28px_rgba(0,0,0,0.55)]"
          style={{ fontFamily: "var(--stage-font-display)" }}
        >
          {shown}
        </h2>
      </div>
    </motion.div>
  );
}
