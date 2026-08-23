import { describe, expect, it } from "vitest";
import { fitTextSize, textMetrics } from "@/lib/present/fit-text";

/**
 * Text auto-fit is what stops a heading longer than its author expected from
 * spilling onto whatever sits below it — the most common way a deck looks
 * broken on a projector.
 */
describe("fitTextSize", () => {
  const box = { boxWidth: 1200, boxHeight: 200 };

  it("leaves short text at its authored size", () => {
    const size = fitTextSize({
      ...box,
      ...textMetrics("Short heading"),
      desiredSize: 86,
      lineHeight: 1.1,
      family: "display",
    });
    expect(size).toBe(86);
  });

  it("shrinks text that would overflow its box", () => {
    const long =
      "Recognising and managing compensated shock for second-year paramedic students in the field";
    const size = fitTextSize({
      ...box,
      ...textMetrics(long),
      desiredSize: 86,
      lineHeight: 1.1,
      family: "display",
    });

    expect(size).toBeLessThan(86);
    // The fitted text must actually fit: estimate the lines it will occupy.
    const charsPerLine = box.boxWidth / (size * 0.46);
    const lines = Math.ceil(long.length / charsPerLine);
    expect(lines * size * 1.1).toBeLessThanOrEqual(box.boxHeight);
  });

  it("never grows text beyond the authored size", () => {
    const size = fitTextSize({
      boxWidth: 4000,
      boxHeight: 3000,
      ...textMetrics("Tiny"),
      desiredSize: 24,
      lineHeight: 1.2,
    });
    expect(size).toBe(24);
  });

  it("stops shrinking at the readable floor", () => {
    const size = fitTextSize({
      ...box,
      characters: 20000,
      longestWord: 8,
      desiredSize: 80,
      lineHeight: 1.4,
      minScale: 0.45,
    });
    // Past this point it is a content problem, and hiding it helps nobody.
    expect(size).toBeCloseTo(80 * 0.45, 5);
  });

  it("shrinks for a long unbreakable word, down to the readable floor", () => {
    const word = "Pneumonoultramicroscopicsilicovolcanoconiosis";
    const size = fitTextSize({
      boxWidth: 600,
      boxHeight: 600,
      ...textMetrics(word),
      desiredSize: 90,
      lineHeight: 1.1,
      family: "sans",
      minScale: 0.45,
    });

    expect(size).toBeLessThan(90);
    // Below the floor, CSS break-word takes over rather than shrinking to an
    // unreadable size on a projector.
    expect(size).toBeGreaterThanOrEqual(90 * 0.45 - 0.001);
  });

  it("fits a moderately long word without hitting the floor", () => {
    const word = "Hypovolaemia";
    const size = fitTextSize({
      boxWidth: 600,
      boxHeight: 600,
      ...textMetrics(word),
      desiredSize: 200,
      lineHeight: 1.1,
      family: "sans",
    });
    expect(size * word.length * 0.5).toBeLessThanOrEqual(600 * 1.02);
  });

  it("divides height by line count when the caller knows it", () => {
    const size = fitTextSize({
      boxWidth: 1200,
      boxHeight: 300,
      characters: 60,
      desiredSize: 60,
      lineHeight: 1.5,
      lines: 6,
    });
    expect(size).toBeLessThanOrEqual(300 / (6 * 1.5) + 0.001);
  });

  it("is a pure function, so every render size agrees", () => {
    const args = {
      ...box,
      ...textMetrics("A heading of some length that needs fitting"),
      desiredSize: 70,
      lineHeight: 1.15,
      family: "display" as const,
    };
    expect(fitTextSize(args)).toBe(fitTextSize(args));
  });

  it("scales proportionally with the stage, so a thumbnail matches the stage", () => {
    const text = textMetrics("Recognising and managing compensated shock in the field");
    const big = fitTextSize({
      boxWidth: 1200,
      boxHeight: 200,
      ...text,
      desiredSize: 86,
      lineHeight: 1.1,
    });
    const small = fitTextSize({
      boxWidth: 120,
      boxHeight: 20,
      ...text,
      desiredSize: 8.6,
      lineHeight: 1.1,
    });
    expect(small * 10).toBeCloseTo(big, 4);
  });

  it("handles degenerate input without dividing by zero", () => {
    expect(
      fitTextSize({ boxWidth: 0, boxHeight: 0, characters: 0, desiredSize: 20, lineHeight: 1 }),
    ).toBe(20);
    expect(
      fitTextSize({ boxWidth: 100, boxHeight: 100, characters: 0, desiredSize: 20, lineHeight: 1 }),
    ).toBe(20);
  });
});

describe("textMetrics", () => {
  it("counts characters and the longest word", () => {
    expect(textMetrics("hello wonderful world")).toEqual({ characters: 21, longestWord: 9 });
  });

  it("returns zeroes for empty input", () => {
    expect(textMetrics("   ")).toEqual({ characters: 0, longestWord: 0 });
  });
});
