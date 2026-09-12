"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { LiveTranscriber, transcriptSupported } from "@/lib/record/transcript";

/**
 * Captions for the room.
 *
 * The browser's own speech engine — the one the recorder already uses for a
 * transcript — listening to the presenter and putting the last stretch of what
 * it heard on the stage. Nothing is uploaded and nothing is stored: the text
 * is what is being said now, and it is gone once the room has been quiet a
 * moment.
 *
 * The engine runs in the window that has the microphone: the console in
 * two-window presenting, the stage itself on one screen. The stage renders
 * whatever it is sent. A page gets one engine, so the recorder and this hook
 * never run at once — the stage yields while a recording is transcribing and
 * reads the recorder's text instead.
 */

/** How often the engine's text is read. Interim results change by the word. */
export const CAPTION_POLL_MS = 200;

/** Roughly two subtitle lines. Anything older has been heard already. */
export const CAPTION_MAX_CHARS = 96;

/**
 * The tail of what has been said, on a word boundary, at most `max` long.
 *
 * The engine's text grows for the length of a sentence, and a caption is the
 * end of it, not the start: the words the room is hearing now.
 */
export function tailOf(text: string, max = CAPTION_MAX_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(clean.length - max);
  const space = cut.indexOf(" ");
  return space >= 0 ? cut.slice(space + 1) : cut;
}

const subscribeNever = () => () => {};
const unsupportedOnServer = () => false;

/** Whether this browser has a speech engine at all; false during SSR. */
export function useCaptionsSupported(): boolean {
  return useSyncExternalStore(subscribeNever, transcriptSupported, unsupportedOnServer);
}

/**
 * Runs the engine while `enabled`, handing every change of the caption to
 * `onText`; an empty string once the room goes quiet, and once more when the
 * engine is released so the stage does not keep the last words up.
 *
 * `onText` is read through a ref: the caller's handler is a fresh function on
 * every render, and restarting the engine on each one would cut a sentence
 * off at every clock tick.
 */
export function useLiveCaptions(enabled: boolean, onText: (text: string) => void): void {
  const emit = useRef(onText);
  useEffect(() => {
    emit.current = onText;
  });

  useEffect(() => {
    if (!enabled) return;
    const transcriber = new LiveTranscriber();
    const origin = performance.now();
    if (!transcriber.start(() => performance.now() - origin)) return;

    let last = "";
    const poll = setInterval(() => {
      const text = tailOf(transcriber.displayText());
      if (text === last) return;
      last = text;
      emit.current(text);
    }, CAPTION_POLL_MS);

    return () => {
      clearInterval(poll);
      void transcriber.stop();
      if (last) emit.current("");
    };
  }, [enabled]);
}
