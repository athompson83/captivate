/**
 * Transcript data: cues, their timing, and the WebVTT they serialise to.
 *
 * Deliberately free of any directive and of anything that touches a browser,
 * because both sides of the application need it. `listRecordings` runs on the
 * server and must validate a transcript row before handing it to a player;
 * the recorder runs in the browser and builds those rows. When these helpers
 * lived beside the SpeechRecognition engine in a `"use client"` module, the
 * server action importing `parseCues` compiled cleanly, shipped, and threw
 * *Attempted to call parseCues() from the server* on every visit to
 * /recordings — a client reference is a stub on the server, not a function.
 *
 * The live engine is in `./transcript.ts`, which imports from here. Nothing
 * here may import from there.
 *
 * Timing is honest about what the engine gives us: recognition results carry
 * no timestamps, so a cue's end is stamped from the recorder's own clock the
 * moment the final result arrives, and its start is estimated from the words
 * it contains, clamped so cues never overlap. That is accurate to well under a
 * second — subtitle accuracy, not forensic accuracy — and the file downloads
 * as standard WebVTT that any player accepts.
 */

export interface TranscriptCue {
  startMs: number;
  endMs: number;
  text: string;
}

/** Spoken-word pace used to estimate a cue's start from its length. */
const MS_PER_WORD = 340;
const MIN_CUE_MS = 700;
const MAX_CUE_MS = 8_000;

/* -------------------------------------------------------------------------- */
/* Pure helpers — unit-tested                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Builds a cue whose end is `endMs` and whose start is estimated from the
 * text, never overlapping the previous cue.
 */
export function cueFromFinalResult(
  text: string,
  endMs: number,
  previousEndMs: number,
): TranscriptCue | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const words = cleaned.split(" ").length;
  const estimated = Math.min(MAX_CUE_MS, Math.max(MIN_CUE_MS, words * MS_PER_WORD));
  const startMs = Math.max(previousEndMs, Math.max(0, endMs - estimated));
  if (startMs >= endMs) return null;
  return { startMs, endMs, text: cleaned };
}

/** hh:mm:ss.mmm, as WebVTT requires. */
export function vttTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const frac = clamped % 1000;
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(frac, 3)}`;
}

/**
 * Splits a cue's text onto at most two lines of comfortable reading length,
 * breaking on spaces. Standard subtitle practice: two lines, ~42 characters.
 */
export function wrapCueText(text: string, maxPerLine = 42): string {
  if (text.length <= maxPerLine) return text;
  const words = text.split(" ");
  let first = "";
  let rest = "";
  for (const word of words) {
    if (!rest && (first ? `${first} ${word}` : word).length <= maxPerLine) {
      first = first ? `${first} ${word}` : word;
    } else {
      rest = rest ? `${rest} ${word}` : word;
    }
  }
  return rest ? `${first}\n${rest}` : first;
}

/** Serialises cues as a WebVTT file body. */
export function toWebVTT(cues: TranscriptCue[]): string {
  const body = cues
    .map(
      (cue, i) =>
        `${i + 1}\n${vttTimestamp(cue.startMs)} --> ${vttTimestamp(cue.endMs)}\n${wrapCueText(cue.text)}`,
    )
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

/**
 * Clamps cues to the recording's real duration. Recognition can deliver one
 * last result while the recorder is finalising, and a cue that outlives the
 * video would let the transcript seek past the last frame.
 */
export function clampCues(cues: TranscriptCue[], durationMs: number): TranscriptCue[] {
  const result: TranscriptCue[] = [];
  for (const cue of cues) {
    if (cue.startMs >= durationMs) continue;
    const endMs = Math.min(cue.endMs, durationMs);
    if (endMs > cue.startMs) result.push({ ...cue, endMs });
  }
  return result;
}

/** The cue under the playhead, or null between cues. */
export function cueAt(cues: TranscriptCue[], atMs: number): TranscriptCue | null {
  for (const cue of cues) {
    if (atMs >= cue.startMs && atMs < cue.endMs) return cue;
    if (cue.startMs > atMs) break;
  }
  return null;
}

/** Zod-free structural check for cues arriving from the database. */
export function parseCues(value: unknown): TranscriptCue[] {
  if (!Array.isArray(value)) return [];
  const cues: TranscriptCue[] = [];
  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as TranscriptCue).startMs === "number" &&
      typeof (item as TranscriptCue).endMs === "number" &&
      typeof (item as TranscriptCue).text === "string" &&
      (item as TranscriptCue).endMs > (item as TranscriptCue).startMs
    ) {
      cues.push({
        startMs: (item as TranscriptCue).startMs,
        endMs: (item as TranscriptCue).endMs,
        text: (item as TranscriptCue).text,
      });
    }
  }
  return cues;
}
