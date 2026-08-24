import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiveTranscriber } from "@/lib/record/transcript";
import {
  clampCues,
  cueAt,
  cueFromFinalResult,
  parseCues,
  toWebVTT,
  vttTimestamp,
  wrapCueText,
} from "@/lib/record/transcript-core";

describe("cueFromFinalResult", () => {
  it("estimates a start from the word count", () => {
    const cue = cueFromFinalResult("five words are spoken here", 10_000, 0);
    expect(cue).not.toBeNull();
    expect(cue!.endMs).toBe(10_000);
    expect(cue!.startMs).toBe(10_000 - 5 * 340);
  });

  it("never overlaps the previous cue", () => {
    const cue = cueFromFinalResult("a fairly long sentence with quite a few words in it", 10_000, 9_500);
    expect(cue!.startMs).toBe(9_500);
  });

  it("never starts before zero", () => {
    const cue = cueFromFinalResult("hello there", 400, 0);
    expect(cue!.startMs).toBe(0);
  });

  it("refuses empty or whitespace text", () => {
    expect(cueFromFinalResult("   ", 5_000, 0)).toBeNull();
  });

  it("collapses runs of whitespace", () => {
    expect(cueFromFinalResult("two   spaced    words", 5_000, 0)!.text).toBe("two spaced words");
  });

  it("refuses a cue that would be instantaneous", () => {
    expect(cueFromFinalResult("word", 5_000, 5_000)).toBeNull();
  });
});

describe("vttTimestamp", () => {
  it("formats zero", () => {
    expect(vttTimestamp(0)).toBe("00:00:00.000");
  });
  it("formats an hour-scale timestamp", () => {
    expect(vttTimestamp(3_600_000 + 61_500)).toBe("01:01:01.500");
  });
  it("clamps negatives to zero", () => {
    expect(vttTimestamp(-5)).toBe("00:00:00.000");
  });
});

describe("wrapCueText", () => {
  it("leaves short text alone", () => {
    expect(wrapCueText("short line")).toBe("short line");
  });
  it("wraps long text onto a second line at a space", () => {
    const wrapped = wrapCueText(
      "recognise the fall in blood pressure before the monitor announces it",
    );
    const lines = wrapped.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].length).toBeLessThanOrEqual(42);
    expect(lines.join(" ")).toBe(
      "recognise the fall in blood pressure before the monitor announces it",
    );
  });
});

describe("toWebVTT", () => {
  it("produces a valid document", () => {
    const vtt = toWebVTT([
      { startMs: 0, endMs: 1_200, text: "First line" },
      { startMs: 1_200, endMs: 2_400, text: "Second line" },
    ]);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:01.200\nFirst line");
    expect(vtt).toContain("2\n00:00:01.200 --> 00:00:02.400\nSecond line");
  });
});

describe("cueAt", () => {
  const cues = [
    { startMs: 0, endMs: 1_000, text: "a" },
    { startMs: 2_000, endMs: 3_000, text: "b" },
  ];
  it("finds the cue under the playhead", () => {
    expect(cueAt(cues, 500)?.text).toBe("a");
    expect(cueAt(cues, 2_500)?.text).toBe("b");
  });
  it("returns null between cues and at a cue's end", () => {
    expect(cueAt(cues, 1_500)).toBeNull();
    expect(cueAt(cues, 1_000)).toBeNull();
  });
});

describe("parseCues", () => {
  it("keeps well-formed cues and drops the rest", () => {
    const cues = parseCues([
      { startMs: 0, endMs: 1000, text: "ok" },
      { startMs: 5, endMs: 5, text: "instant" },
      { startMs: "0", endMs: 1000, text: "typed wrong" },
      null,
      "string",
    ]);
    expect(cues).toEqual([{ startMs: 0, endMs: 1000, text: "ok" }]);
  });
  it("returns empty for non-arrays", () => {
    expect(parseCues({})).toEqual([]);
    expect(parseCues(null)).toEqual([]);
  });
});

describe("clampCues", () => {
  it("clamps a cue that outlives the recording to its end", () => {
    // The race this guards: recognition delivers one last result while the
    // encoder is finalising, stamped after durationMs was captured.
    const cues = clampCues([{ startMs: 9_000, endMs: 11_000, text: "late" }], 10_000);
    expect(cues).toEqual([{ startMs: 9_000, endMs: 10_000, text: "late" }]);
  });

  it("drops a cue that starts after the recording ended", () => {
    expect(clampCues([{ startMs: 10_500, endMs: 11_000, text: "ghost" }], 10_000)).toEqual([]);
  });

  it("drops a cue clamped to nothing", () => {
    expect(clampCues([{ startMs: 10_000, endMs: 12_000, text: "edge" }], 10_000)).toEqual([]);
  });

  it("leaves in-range cues untouched", () => {
    const cues = [{ startMs: 0, endMs: 1_000, text: "fine" }];
    expect(clampCues(cues, 10_000)).toEqual(cues);
  });
});

describe("LiveTranscriber without an engine", () => {
  it("declines to start rather than throwing", async () => {
    const transcriber = new LiveTranscriber();
    expect(transcriber.start(() => 0)).toBe(false);
    await expect(transcriber.stop()).resolves.toEqual([]);
  });
});

/**
 * A SpeechRecognition double faithful to the part of the contract the
 * transcriber depends on: results arrive via onresult, stop() requests
 * finalisation and may deliver one last final result before onend.
 */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  /** Text still in flight when stop() is requested. */
  pendingFinal: string | null = null;
  aborted = false;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start(): void {}

  emitFinal(text: string): void {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
  }

  private stopping = false;

  stop(): void {
    // Real engines throw when stop is requested twice — the second request
    // arrives while the first is still finalising.
    if (this.stopping) throw new Error("InvalidStateError");
    this.stopping = true;
    // The engine finalises the in-flight phrase, then ends — asynchronously,
    // as the real service does.
    queueMicrotask(() => {
      if (this.pendingFinal) this.emitFinal(this.pendingFinal);
      this.onend?.();
    });
  }

  abort(): void {
    this.aborted = true;
  }
}

describe("LiveTranscriber with a fake engine", () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
  });
  afterEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  it("keeps a final result the engine delivers after stop() is requested", async () => {
    let clock = 5_000;
    const transcriber = new LiveTranscriber();
    expect(transcriber.start(() => clock)).toBe(true);

    const engine = FakeRecognition.instances[0];
    engine.emitFinal("spoken mid take");
    clock = 9_000;
    // The presenter clicks stop while this phrase is still in flight.
    engine.pendingFinal = "the very last words";

    const cues = await transcriber.stop();
    expect(cues.map((cue) => cue.text)).toEqual(["spoken mid take", "the very last words"]);
  });

  it("keeps a phrase a pause was still finalising when stop follows at once", async () => {
    // The race: suspend() has requested finalisation, its final result is in
    // flight, and the presenter clicks stop before it lands. The second stop
    // request throws — the wait must survive that and keep the words.
    let clock = 4_000;
    const transcriber = new LiveTranscriber();
    transcriber.start(() => clock);

    const engine = FakeRecognition.instances[0];
    engine.pendingFinal = "words the pause was finalising";
    clock = 8_000;
    transcriber.suspend();

    const cues = await transcriber.stop();
    expect(cues.map((cue) => cue.text)).toEqual(["words the pause was finalising"]);
  });

  it("returns at once when a suspend has already fully finished", async () => {
    const transcriber = new LiveTranscriber();
    transcriber.start(() => 2_000);
    const engine = FakeRecognition.instances[0];
    transcriber.suspend();
    // Let the engine's finalisation and onend complete.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const cues = await transcriber.stop();
    expect(cues).toEqual([]);
    expect(engine.aborted).toBe(true);
  });

  it("stops listening after stop() resolves", async () => {
    const transcriber = new LiveTranscriber();
    transcriber.start(() => 1_000);
    const engine = FakeRecognition.instances[0];
    const cues = await transcriber.stop();
    expect(cues).toEqual([]);
    // The engine was torn down, not left running for the restart loop.
    expect(engine.aborted).toBe(true);
  });
});
