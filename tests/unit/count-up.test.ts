import { describe, expect, it } from "vitest";
import { COUNT_MS, figureAt, formatFigure, parseFigure } from "@/lib/present/count-up";

/**
 * The figure that climbs to itself on arrival. What is counted, and how each
 * intermediate value is written, is decided here; the stage only runs a clock.
 */
describe("parseFigure", () => {
  it("finds the one number and keeps what surrounds it", () => {
    expect(parseFigure("7.6%")).toEqual({
      prefix: "",
      suffix: "%",
      value: 7.6,
      decimals: 1,
      grouped: false,
    });
    expect(parseFigure("$1,200 a month")).toMatchObject({
      prefix: "$",
      suffix: " a month",
      value: 1200,
      decimals: 0,
      grouped: true,
    });
    expect(parseFigure("90 s")).toMatchObject({ value: 90, suffix: " s" });
  });

  it("leaves a ratio alone: its parts are not independent quantities", () => {
    expect(parseFigure("1 in 4")).toBeNull();
    expect(parseFigure("3 of 10")).toBeNull();
  });

  it("does not count a figure too small to climb", () => {
    expect(parseFigure("1")).toBeNull();
    expect(parseFigure("4 hours")).toBeNull();
    expect(parseFigure("5 hours")).not.toBeNull();
  });

  it("has nothing to count in words", () => {
    expect(parseFigure("Ninety seconds")).toBeNull();
  });
});

describe("formatFigure", () => {
  it("writes every intermediate value the way the author wrote the last one", () => {
    const spec = parseFigure("7.6%")!;
    expect(formatFigure(spec, 0)).toBe("0.0");
    expect(formatFigure(spec, 3.14159)).toBe("3.1");
    expect(formatFigure(spec, 7.6)).toBe("7.6");
  });

  it("keeps the thousands grouping the author used", () => {
    const spec = parseFigure("1,200,000")!;
    expect(formatFigure(spec, 512)).toBe("512");
    expect(formatFigure(spec, 45678)).toBe("45,678");
    expect(formatFigure(spec, 1200000)).toBe("1,200,000");
  });

  it("carries a negative sign all the way down", () => {
    const spec = parseFigure("-12.5°")!;
    expect(formatFigure(spec, -3)).toBe("-3.0");
    expect(formatFigure(spec, 0)).toBe("-0.0");
  });
});

describe("figureAt", () => {
  it("starts at nothing, lands exactly on the value, and slows into it", () => {
    const spec = parseFigure("250")!;
    expect(figureAt(spec, 0)).toBe(0);
    expect(figureAt(spec, 1)).toBe(250);
    // Ease-out: more than half the distance is covered in the first half.
    expect(figureAt(spec, 0.5)).toBeGreaterThan(125);
    // Monotonic, so the number never ticks backwards on the way up.
    let last = -1;
    for (let t = 0; t <= 1; t += 0.05) {
      const at = figureAt(spec, t);
      expect(at).toBeGreaterThanOrEqual(last);
      last = at;
    }
  });

  it("takes about a second — long enough to watch, short enough to wait for", () => {
    expect(COUNT_MS).toBeGreaterThanOrEqual(800);
    expect(COUNT_MS).toBeLessThanOrEqual(1500);
  });
});
