import { describe, expect, it } from "vitest";
import {
  cueAt,
  cueFromFinalResult,
  parseCues,
  toWebVTT,
  vttTimestamp,
  wrapCueText,
  LiveTranscriber,
} from "@/lib/record/transcript";

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

describe("LiveTranscriber without an engine", () => {
  it("declines to start rather than throwing", () => {
    const transcriber = new LiveTranscriber();
    expect(transcriber.start(() => 0)).toBe(false);
    expect(transcriber.stop()).toEqual([]);
  });
});
