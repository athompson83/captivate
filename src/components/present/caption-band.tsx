"use client";

import { wrapCueText } from "@/lib/record/transcript-core";

/** Characters per caption line: standard subtitle practice, two lines of ~42. */
const CAPTION_LINE = 46;

/**
 * Captions, on the stage.
 *
 * What the presenter is saying, low on the frame where subtitles live, in
 * a band the room can read from the back without it competing with the
 * scene. Inside the capture surface deliberately: a recording of the tab
 * contains what the room saw, and the room saw these.
 *
 * Nothing when there is nothing: an empty band is a box on the stage, and
 * the rule of the canvas is that nothing paints a rectangle it does not need.
 */
export function CaptionBand({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div
      data-captions
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-[7%] z-10 flex justify-center px-[6%]"
    >
      <p className="max-w-[82%] rounded-[var(--radius-md)] bg-black/70 px-[1.1em] py-[0.45em] text-center text-[clamp(16px,2.4vw,38px)] leading-[1.3] font-medium tracking-[0.005em] whitespace-pre-line text-white shadow-[0_6px_28px_rgba(0,0,0,0.35)] backdrop-blur-sm">
        {wrapCueText(text, CAPTION_LINE)}
      </p>
    </div>
  );
}
