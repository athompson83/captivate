import { describe, expect, it } from "vitest";
import {
  PARALLAX_MAX,
  PARALLAX_STRENGTH,
  elementDepth,
  regionParallax,
} from "@/lib/present/parallax";

const STAGE = { width: 1600, height: 900 };
const placement = { x: 0, y: 0, scale: 1, rotation: 0 };
const camera = (x: number, y: number) => ({ x, y, width: 1600, rotation: 0 });

/**
 * Depth inside a scene: words nearer than the surface, pictures farther,
 * sliding against each other by the camera's offset from the scene — and
 * exactly nothing while the camera is on it.
 */
describe("depth inside a scene", () => {
  it("is zero when the camera is centred on the scene", () => {
    expect(regionParallax(camera(0, 0), placement, STAGE)).toEqual({ x: 0, y: 0 });
  });

  it("grows with the camera's offset, in the region's own pixels", () => {
    const offset = regionParallax(camera(100, -50), placement, STAGE);
    expect(offset.x).toBeCloseTo(100 * PARALLAX_STRENGTH, 6);
    expect(offset.y).toBeCloseTo(-50 * PARALLAX_STRENGTH, 6);
    // A smaller region sees the same world distance as more of its own pixels.
    const small = regionParallax(camera(100, 0), { ...placement, scale: 0.5 }, STAGE);
    expect(small.x).toBeCloseTo(200 * PARALLAX_STRENGTH, 6);
  });

  it("is capped so a far scene does not scatter", () => {
    const far = regionParallax(camera(100_000, -100_000), placement, STAGE);
    expect(far.x).toBe(STAGE.width * PARALLAX_MAX);
    expect(far.y).toBe(-STAGE.width * PARALLAX_MAX);
  });

  it("turns with a turned region", () => {
    const turned = regionParallax(camera(100, 0), { ...placement, rotation: 90 }, STAGE);
    expect(turned.x).toBeCloseTo(0, 6);
    expect(Math.abs(turned.y)).toBeCloseTo(100 * PARALLAX_STRENGTH, 6);
  });

  it("puts words in front of the surface and pictures behind it", () => {
    expect(elementDepth("heading")).toBeLessThan(0);
    expect(elementDepth("text")).toBeLessThan(0);
    expect(elementDepth("image")).toBeGreaterThan(0);
    expect(elementDepth("drawing")).toBeGreaterThan(0);
    expect(elementDepth("divider")).toBe(0);
  });
});
