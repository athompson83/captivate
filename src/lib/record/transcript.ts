"use client";

/**
 * Live transcript for recordings: the browser's own speech engine.
 *
 * Speech recognition runs through the browser's SpeechRecognition engine —
 * available in Chrome and Edge, absent elsewhere — so there is no API key, no
 * upload step, and nothing to configure. Where it is unavailable the recorder
 * simply records without a transcript and the setup dialog says so; a missing
 * nicety must never block a capture.
 *
 * Only the engine lives here. The cue shape and every pure helper are in
 * `./transcript-core.ts` so that server code can use them: a `"use client"`
 * export reaches the server as a reference stub, and calling one throws at
 * runtime with nothing failing at build time. This module intentionally
 * re-exports none of them, so that boundary cannot be crossed by accident.
 */

import { cueFromFinalResult, type TranscriptCue } from "@/lib/record/transcript-core";

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
  /** True once the engine has ended and no restart will revive it. */
  private engineEnded = false;
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
    this.engineEnded = false;

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
          this.engineEnded = true;
        }
      } else {
        // Suspended: the engine has finished finalising and gone quiet.
        this.engineEnded = true;
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
    this.engineEnded = false;
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

  /**
   * Stops gracefully: `recognition.stop()` asks the engine to finalise the
   * phrase in flight — `abort()` would throw those words away, and the last
   * sentence of a take is exactly what tends to be in flight when the
   * presenter clicks stop. The wait is bounded because an engine that has
   * already gone quiet may never fire another event; on timeout the pending
   * phrase is forfeited rather than the recording held hostage.
   */
  async stop(): Promise<TranscriptCue[]> {
    this.running = false;
    const recognition = this.recognition;
    this.recognition = null;
    if (!recognition) return this.cues;

    // A suspend that has fully finished leaves nothing to wait for — but a
    // suspend still finalising must be waited out, or the phrase it is
    // finalising is persisted-past rather than kept.
    if (this.engineEnded) {
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        // Already gone.
      }
      return this.cues;
    }

    const ended = new Promise<void>((resolve) => {
      recognition.onend = () => resolve();
    });

    try {
      recognition.stop();
    } catch {
      // A prior suspend already requested finalisation; its onend still
      // resolves the wait below, so fall through rather than returning early.
    }

    await Promise.race([ended, new Promise<void>((resolve) => setTimeout(resolve, 750))]);

    recognition.onend = null;
    try {
      recognition.abort();
    } catch {
      // Already gone.
    }
    return this.cues;
  }
}
