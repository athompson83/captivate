import { describe, expect, it } from "vitest";
import { MARK_WEIGHT, isAccentRun, underlinePath } from "@/lib/present/hand-mark";
import { richTextMark } from "@/lib/schema/presentation";

/**
 * The stroke under the phrase that matters: its geometry, and which run
 * gets one. The measuring is the browser's — see `tests/e2e/hand-mark.spec.ts`.
 */

describe("the run that is marked", () => {
  it("is the accent token the writer named, not any coloured run", () => {
    const runs = richTextMark("Reassess, or you never hear the answer.", "Reassess");
    expect(runs.map(isAccentRun)).toEqual([true, false]);
    expect(isAccentRun({ text: "x", color: { kind: "hex", hex: "#ff0000" } })).toBe(false);
    expect(isAccentRun({ text: "x", color: { kind: "token", token: "ink" } })).toBe(false);
    expect(isAccentRun({ text: "x" })).toBe(false);
  });
});

describe("the stroke under a line", () => {
  it("runs the width of its line, just above its bottom, and never level", () => {
    const d = underlinePath({ x: 100, y: 200, width: 300 }, 30, 0);
    const [, x0, y0, , , x1, y1] = d
      .match(/^M ([\d.]+) ([\d.]+) Q ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)$/)!
      .map(Number);
    expect(x0).toBe(100);
    expect(x1).toBe(400);
    // A tenth of the size above the bottom, through the descenders.
    expect((y0 + y1) / 2).toBeCloseTo(197, 0);
    // Uphill on the first line, downhill on the next: a hand never draws level.
    expect(y0).toBeGreaterThan(y1);
    const next = underlinePath({ x: 100, y: 240, width: 300 }, 30, 1);
    const [, , ny0, , , , ny1] = next
      .match(/^M ([\d.]+) ([\d.]+) Q ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)$/)!
      .map(Number);
    expect(ny0).toBeLessThan(ny1);
    expect(MARK_WEIGHT).toBe(0.07);
  });
});
