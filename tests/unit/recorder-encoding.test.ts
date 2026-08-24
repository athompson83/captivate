import { describe, expect, it } from "vitest";
import { bitrateForFrame, pickMimeType } from "@/lib/record/recorder";

/**
 * Which codec the recorder asks for, and how many bits it gives it.
 *
 * "The video file that exported is low definition." Two causes, both invisible
 * until someone plays the file: a flat 4 Mbit/s budget that worked out under a
 * tenth of a bit per pixel at 1440p, and a candidate list that led with
 * `avc1.42E01E` — H.264 **Baseline**, level 3.0. Baseline has no CABAC and no
 * B-frames, and a deck is hard-edged text, which is the content that shows the
 * difference.
 *
 * The browser test encodes a real file, but it can only exercise the codecs
 * the test browser has, and headless Chromium ships without H.264. The
 * preference order is checked here instead, against a stubbed
 * `isTypeSupported` standing in for the browsers that do.
 */

const chromeWithH264 = (type: string) =>
  type.startsWith("video/mp4") || type.startsWith("video/webm");

describe("choosing a container and codec", () => {
  it("asks for High profile, not Baseline, where both are available", () => {
    const chosen = pickMimeType(chromeWithH264);
    expect(chosen).toContain("avc1.6400");
    expect(chosen).not.toContain("avc1.42E01E");
  });

  it("falls back to VP9 in a browser without H.264", () => {
    // Chromium builds without proprietary codecs, which is most Linux Chromium
    // and every headless build this repo tests on.
    const noH264 = (type: string) => type.startsWith("video/webm");
    expect(pickMimeType(noH264)).toBe("video/webm;codecs=vp9,opus");
  });

  it("prefers VP9 over Baseline H.264", () => {
    const baselineOrVp9 = (type: string) =>
      type === "video/webm;codecs=vp9,opus" || type === "video/mp4;codecs=avc1.42E01E,mp4a.40.2";
    expect(pickMimeType(baselineOrVp9)).toBe("video/webm;codecs=vp9,opus");
  });

  it("still takes Baseline over VP8 when that is the choice", () => {
    const baselineOrVp8 = (type: string) =>
      type === "video/webm;codecs=vp8,opus" || type === "video/mp4;codecs=avc1.42E01E,mp4a.40.2";
    expect(pickMimeType(baselineOrVp8)).toBe("video/mp4;codecs=avc1.42E01E,mp4a.40.2");
  });

  it("reports nothing rather than guessing when the browser records none of them", () => {
    expect(pickMimeType(() => false)).toBeNull();
  });
});

describe("the encoding budget", () => {
  it("gives 1440p more than 1080p, and 4K more again", () => {
    expect(bitrateForFrame(2560, 1440, 30)).toBeGreaterThan(bitrateForFrame(1920, 1080, 30));
    expect(bitrateForFrame(3840, 2160, 30)).toBeGreaterThan(bitrateForFrame(2560, 1440, 30));
  });

  it("gives 60fps more than 30fps at the same size", () => {
    expect(bitrateForFrame(1920, 1080, 60)).toBeGreaterThan(bitrateForFrame(1920, 1080, 30));
  });

  it("clears the flat 4 Mbit/s it replaced at every size a deck is presented at", () => {
    for (const [w, h] of [
      [1280, 720],
      [1920, 1080],
      [2560, 1440],
      [3840, 2160],
    ]) {
      expect(bitrateForFrame(w, h, 30)).toBeGreaterThan(4_000_000);
    }
  });

  it("does not starve a small capture", () => {
    expect(bitrateForFrame(320, 240, 30)).toBe(6_000_000);
  });

  it("does not produce a file nobody can upload", () => {
    expect(bitrateForFrame(7680, 4320, 60)).toBe(40_000_000);
  });
});
