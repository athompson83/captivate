import { describe, expect, it } from "vitest";
import { blendOklab, mixOklab, oklabCss, parseHex, toOklab } from "@/lib/utils/color";
import { ambientAt, paletteOf, scenePalettes } from "@/lib/present/ambient";
import { getTheme } from "@/lib/schema/theme";
import { composeScene } from "@/lib/editor/layouts";
import type { Camera } from "@/lib/present/camera";
import type { Scene, ScenePlacement } from "@/lib/schema/presentation";

const STAGE = { width: 1600, height: 900 };

describe("colour", () => {
  it("parses both hex forms and shrugs at nonsense", () => {
    expect(parseHex("#fff")).toEqual({ r: 1, g: 1, b: 1 });
    expect(parseHex("000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHex("#FF0000")).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseHex("not a colour")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("converts to OKLab with the expected landmarks", () => {
    // White is L=1 with no chroma; black is the origin. Both are exact in the
    // reference transform, so they are the right things to pin.
    const white = toOklab("#ffffff");
    expect(white.L).toBeCloseTo(1, 3);
    expect(white.a).toBeCloseTo(0, 3);
    expect(white.b).toBeCloseTo(0, 3);

    const black = toOklab("#000000");
    expect(black.L).toBeCloseTo(0, 6);

    // Red is light-ish, strongly positive on a, positive on b.
    const red = toOklab("#ff0000");
    expect(red.L).toBeCloseTo(0.6279, 2);
    expect(red.a).toBeGreaterThan(0.2);
    expect(red.b).toBeGreaterThan(0.1);
  });

  it("does not drag a blue-to-amber blend through grey", () => {
    // The reason for OKLab at all. Interpolating these in sRGB gives a muddy
    // midpoint; here the middle keeps real chroma.
    const midpoint = mixOklab(toOklab("#0F1117"), toOklab("#F0B858"), 0.5);
    const chroma = Math.hypot(midpoint.a, midpoint.b);
    expect(chroma).toBeGreaterThan(0.02);
    expect(midpoint.L).toBeGreaterThan(toOklab("#0F1117").L);
    expect(midpoint.L).toBeLessThan(toOklab("#F0B858").L);
  });

  it("clamps the ends of a mix", () => {
    const from = toOklab("#000000");
    const to = toOklab("#ffffff");
    expect(mixOklab(from, to, -5).L).toBeCloseTo(from.L, 6);
    expect(mixOklab(from, to, 5).L).toBeCloseTo(to.L, 6);
  });

  it("weights a blend and survives having nothing to blend", () => {
    const a = toOklab("#000000");
    const b = toOklab("#ffffff");
    expect(
      blendOklab([
        { color: a, weight: 3 },
        { color: b, weight: 1 },
      ]).L,
    ).toBeCloseTo(b.L * 0.25, 3);

    expect(blendOklab([])).toEqual({ L: 0, a: 0, b: 0 });
    expect(blendOklab([{ color: b, weight: 0 }])).toEqual({ L: 0, a: 0, b: 0 });
  });

  it("emits CSS the browser can actually render", () => {
    expect(oklabCss({ L: 0.5, a: 0.1, b: -0.05 })).toBe("oklab(0.5 0.1 -0.05)");
    expect(oklabCss({ L: 0.5, a: 0, b: 0 }, 0.2)).toBe("oklab(0.5 0 0 / 0.2)");
    // Out-of-range lightness would be an invalid colour and paint nothing.
    expect(oklabCss({ L: 4, a: 0, b: 0 })).toBe("oklab(1 0 0)");
    expect(oklabCss({ L: -4, a: 0, b: 0 })).toBe("oklab(0 0 0)");
  });
});

describe("atmosphere", () => {
  const place = (x: number, y: number, scale = 1): ScenePlacement => ({
    x,
    y,
    scale,
    rotation: 0,
  });

  function scene(themeOverride: string | null, i: number): Scene {
    return {
      id: `00000000-0000-4000-8000-00000000000${i}`,
      presentationId: "00000000-0000-4000-8000-000000000fff",
      sectionId: null,
      position: i,
      title: `Scene ${i}`,
      content: { ...composeScene("statement", { heading: "x" }), themeOverride },
      placement: null,
      speakerNotes: "",
      durationSeconds: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
  }

  const midnight = getTheme("midnight");
  const base = paletteOf(midnight);
  const camera = (x: number): Camera => ({ x, y: 0, width: 1700, rotation: 0 });

  const lightnessOf = (css: string) => Number(/oklab\(([\d.]+)/.exec(css)![1]);

  it("falls back to the deck palette with nothing placed", () => {
    const ambient = ambientAt(camera(0), [], [], STAGE, base);
    expect(ambient.canvas).toBe(oklabCss(base.canvas));
    expect(ambient.glow).toContain("/");
  });

  it("gives each scene its own theme's palette when it overrides", () => {
    const scenes = [scene(null, 0), scene("paper", 1)];
    const palettes = scenePalettes(scenes, midnight);
    expect(palettes[0]).toEqual(base);
    expect(palettes[1]).not.toEqual(base);
  });

  it("takes the colour of the region the camera is over", () => {
    const scenes = [scene(null, 0), scene("paper", 1)];
    const palettes = scenePalettes(scenes, midnight);
    const placements = [place(0, 0), place(20_000, 0)];

    const here = ambientAt(camera(0), placements, palettes, STAGE, base);
    const there = ambientAt(camera(20_000), placements, palettes, STAGE, base);

    expect(here.canvas).not.toBe(there.canvas);

    // The blend is asymptotic, not exact — a distant region keeps a small,
    // bounded weight rather than dropping to zero, which is what stops the
    // colour snapping as the camera crosses some invisible boundary. So the
    // claim is that the region you are over dominates, not that it wins
    // outright.
    expect(lightnessOf(here.canvas)).toBeCloseTo(lightnessOf(oklabCss(palettes[0].canvas)), 2);
    expect(lightnessOf(there.canvas)).toBeCloseTo(lightnessOf(oklabCss(palettes[1].canvas)), 2);
  });

  it("blends continuously on the way between two regions", () => {
    const scenes = [scene(null, 0), scene("paper", 1)];
    const palettes = scenePalettes(scenes, midnight);
    const placements = [place(0, 0), place(8000, 0)];

    const lightness = (x: number) =>
      lightnessOf(ambientAt(camera(x), placements, palettes, STAGE, base).canvas);

    // Midnight is dark, paper is light, so crossing between them is a
    // monotone climb. A jump would mean the camera changed the room abruptly.
    const samples = [0, 2000, 4000, 6000, 8000].map(lightness);
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
    expect(samples[4] - samples[0]).toBeGreaterThan(0.2);
  });

  it("does not let a distant region wash out the one in front of you", () => {
    // Averaging every scene pulls every position toward the same mean, which
    // makes a whole presentation one colour. Only the nearest few count.
    const scenes = [scene(null, 0), ...Array.from({ length: 20 }, (_, i) => scene("paper", i + 1))];
    const palettes = scenePalettes(scenes, midnight);
    const placements = [
      place(0, 0),
      ...Array.from({ length: 20 }, (_, i) => place(60_000 + i * 2000, 0)),
    ];

    const overTheDarkOne = lightnessOf(
      ambientAt(camera(0), placements, palettes, STAGE, base).canvas,
    );
    // Twenty light regions far away must not lift the dark one you are on.
    expect(overTheDarkOne).toBeCloseTo(lightnessOf(oklabCss(palettes[0].canvas)), 2);
  });
});
