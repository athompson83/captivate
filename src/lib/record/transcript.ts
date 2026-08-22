"use client";

/**
 * Live transcript for recordings.
 *
 * Speech recognition runs through the browser's own SpeechRecognition engine —
 * available in Chrome and Edge, absent elsewhere — so there is no API key, no
 * upload step, and nothing to configure. Where it is unavailable the recorder
 * simply records without a transcript and the setup dialog says so; a missing
 * nicety must never block a capture.
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

/* -------------------------------------------------------------------------- */
/* The live engine                                                             */
/* -------------------------------------------------------------------------- */

interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  /** Chromium ≥135 accepts a MediaStreamTrack; older engines ignore the argument. */
  start(audioTrack?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function transcriptSupported(): boolean {
  return recognitionCtor() !== null;
}

/**
 * Wraps SpeechRecognition for the lifetime of one recording.
 *
 * The engine stops itself after silence, so `onend` restarts it while the
 * transcriber is meant to be running — the standard dance for continuous
 * dictation. `clock` is the recorder's own elapsed time, so cues line up with
 * the video even across pauses.
 */
export class LiveTranscriber {
  private recognition: RecognitionLike | null = null;
  private cues: TranscriptCue[] = [];
  private interim = "";
  private lastFinalAt = 0;
  private running = false;
  private clock: () => number = () => 0;
  private audioTrack: MediaStreamTrack | null = null;

  start(
    clock: () => number,
    options?: { lang?: string; audioTrack?: MediaStreamTrack | null },
  ): boolean {
    const Ctor = recognitionCtor();
    if (!Ctor) return false;

    this.clock = clock;
    this.audioTrack = options?.audioTrack ?? null;
    this.cues = [];
    this.interim = "";
    this.lastFinalAt = 0;
    this.running = true;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang =
      options?.lang ?? (typeof navigator !== "undefined" ? navigator.language : "en-US");

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          const cue = cueFromFinalResult(text, this.clock(), this.lastFinalAt);
          if (cue) {
            this.cues.push(cue);
            this.lastFinalAt = cue.endMs;
          }
        } else {
          interim += text;
        }
      }
      this.interim = interim.trim();
    };
    recognition.onerror = () => {
      // "no-speech" and "aborted" arrive routinely; the onend restart covers
      // recovery, and a genuinely dead engine just yields a shorter transcript.
    };
    recognition.onend = () => {
      this.interim = "";
      if (this.running) {
        try {
          this.begin(recognition);
        } catch {
          this.running = false;
        }
      }
    };

    this.recognition = recognition;
    try {
      this.begin(recognition);
      return true;
    } catch {
      this.recognition = null;
      this.running = false;
      return false;
    }
  }

  /**
   * Starts recognition on the recorder's own microphone track where the
   * engine supports it (Chromium ≥135), so captions transcribe the mic the
   * presenter chose rather than the system default. Engines that predate the
   * argument ignore it; a track the engine refuses (ended, wrong kind) falls
   * back to the default microphone rather than costing the transcript.
   */
  private begin(recognition: RecognitionLike): void {
    if (this.audioTrack && this.audioTrack.readyState === "live") {
      try {
        recognition.start(this.audioTrack);
        return;
      } catch {
        // InvalidStateError from an engine that validates the track; retry
        // below on the default microphone.
      }
    }
    recognition.start();
  }

  /** Pause with the recording so hallway chatter doesn't enter the transcript. */
  suspend(): void {
    if (!this.running) return;
    this.running = false;
    try {
      this.recognition?.stop();
    } catch {
      // Already stopped.
    }
  }

  resume(): void {
    if (this.running || !this.recognition) return;
    this.running = true;
    try {
      this.begin(this.recognition);
    } catch {
      // onend restart will pick it up if the engine objects to the timing.
    }
  }

  /** Text for live captions: what's being said now, or the latest final line. */
  displayText(): string {
    if (this.interim) return this.interim;
    const last = this.cues[this.cues.length - 1];
    if (last && this.clock() - last.endMs < 3000) return last.text;
    return "";
  }

  stop(): TranscriptCue[] {
    this.running = false;
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) recognition.onend = null;
    try {
      recognition?.abort();
    } catch {
      // Already gone.
    }
    return this.cues;
  }
}
