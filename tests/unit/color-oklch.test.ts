import { describe, expect, it } from "vitest";
import { oklabToHex, parseOklch, toOklab } from "@/lib/utils/color";

describe("parseOklch", () => {
  it("parses an oklch() CSS string into L/a/b", () => {
    // oklch(0.5 0 0) is achromatic (a = b = 0) — the simplest case to hand-check.
    const lab = parseOklch("oklch(0.5 0 0)");
    expect(lab.L).toBeCloseTo(0.5, 5);
    expect(lab.a).toBeCloseTo(0, 5);
    expect(lab.b).toBeCloseTo(0, 5);
  });

  it("splits chroma into a/b by hue", () => {
    const lab = parseOklch("oklch(0.7 0.1 90)");
    // hue 90deg: a = C*cos(90deg) ~= 0, b = C*sin(90deg) ~= C
    expect(lab.a).toBeCloseTo(0, 2);
    expect(lab.b).toBeCloseTo(0.1, 2);
  });
});

describe("oklabToHex", () => {
  it("round-trips white and black", () => {
    expect(oklabToHex(toOklab("#ffffff")).toLowerCase()).toBe("#ffffff");
    expect(oklabToHex(toOklab("#000000")).toLowerCase()).toBe("#000000");
  });

  it("round-trips an arbitrary colour within one hex step", () => {
    const original = "#3366cc";
    const roundTripped = oklabToHex(toOklab(original));
    // Allow ±2/255 per channel for float rounding through cube roots.
    const a = Number.parseInt(original.slice(1), 16);
    const b = Number.parseInt(roundTripped.replace("#", ""), 16);
    const da = Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff));
    const dg = Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff));
    const db = Math.abs((a & 0xff) - (b & 0xff));
    expect(da).toBeLessThanOrEqual(2);
    expect(dg).toBeLessThanOrEqual(2);
    expect(db).toBeLessThanOrEqual(2);
  });
});
