import { describe, expect, it } from "vitest";
import {
  MAX_CAMERA_SIZE,
  MIN_CAMERA_SIZE,
  cameraAspect,
  clampPlacement,
  sizeFromCorner,
} from "@/components/present/presenter-camera";

/** A 16:9 stage, which is what the world canvas presents on. */
const STAGE = { width: 1600, height: 900 };
const WIDE = cameraAspect("rounded");

describe("keeping the presenter on the stage", () => {
  it("stops the feed hanging off the right edge", () => {
    // The old clamp allowed x up to 0.96 whatever the size, so a feed a third
    // of the stage wide put a sixth of the presenter past the edge.
    const placed = clampPlacement({ x: 0.96, y: 0.5, size: 0.34 }, STAGE, WIDE);
    expect(placed.x).toBeCloseTo(1 - 0.34 / 2, 5);
    expect(placed.x + placed.size / 2).toBeLessThanOrEqual(1);
  });

  it("stops the feed hanging off the left edge", () => {
    const placed = clampPlacement({ x: 0, y: 0.5, size: 0.3 }, STAGE, WIDE);
    expect(placed.x - placed.size / 2).toBeGreaterThanOrEqual(-1e-9);
  });

  it("accounts for the box's real height, not its width", () => {
    // A 16:9 box 0.4 of a 16:9 stage wide is 0.4 of its height too.
    const placed = clampPlacement({ x: 0.5, y: 0.99, size: 0.4 }, STAGE, WIDE);
    expect(placed.y).toBeCloseTo(1 - 0.2, 5);
  });

  it("is taller for a circle than for a wide feed at the same size", () => {
    const circle = clampPlacement({ x: 0.5, y: 1, size: 0.3 }, STAGE, cameraAspect("circle"));
    const wide = clampPlacement({ x: 0.5, y: 1, size: 0.3 }, STAGE, WIDE);
    expect(circle.y).toBeLessThan(wide.y);
  });

  it("centres a feed too tall to fit rather than pinning it to an edge", () => {
    const tall = clampPlacement({ x: 0.5, y: 0.1, size: 0.5 }, { width: 400, height: 300 }, 0.4);
    expect(tall.y).toBe(0.5);
  });

  it("holds the size limits", () => {
    expect(clampPlacement({ x: 0.5, y: 0.5, size: 0.001 }, STAGE, WIDE).size).toBe(MIN_CAMERA_SIZE);
    expect(clampPlacement({ x: 0.5, y: 0.5, size: 9 }, STAGE, WIDE).size).toBe(MAX_CAMERA_SIZE);
  });

  it("leaves a feed that already fits exactly where it was put", () => {
    const placed = clampPlacement({ x: 0.4, y: 0.6, size: 0.2 }, STAGE, WIDE);
    expect(placed).toEqual({ x: 0.4, y: 0.6, size: 0.2 });
  });
});

describe("resizing from the corner", () => {
  const centre = { x: 0.5 * STAGE.width, y: 0.5 * STAGE.height };

  it("follows a purely vertical drag", () => {
    // The previous implementation added only the horizontal component, so
    // dragging the corner handle straight down changed nothing at all.
    const grown = sizeFromCorner({ x: centre.x, y: centre.y + 160 }, centre, STAGE, WIDE);
    expect(grown).toBeGreaterThan(MIN_CAMERA_SIZE);
    expect(grown).toBeCloseTo((2 * 160 * WIDE) / STAGE.width, 5);
  });

  it("follows a purely horizontal drag", () => {
    const grown = sizeFromCorner({ x: centre.x + 240, y: centre.y }, centre, STAGE, WIDE);
    expect(grown).toBeCloseTo((2 * 240) / STAGE.width, 5);
  });

  it("puts the corner under the pointer on a diagonal drag", () => {
    const size = sizeFromCorner({ x: centre.x + 240, y: centre.y + 135 }, centre, STAGE, WIDE);
    // 240px is half of a 480px-wide box; 135px is half of its 270px height.
    expect((size * STAGE.width) / 2).toBeCloseTo(240, 3);
  });

  it("never returns a size outside the limits", () => {
    expect(sizeFromCorner({ x: centre.x - 900, y: centre.y - 900 }, centre, STAGE, WIDE)).toBe(
      MIN_CAMERA_SIZE,
    );
    expect(sizeFromCorner({ x: centre.x + 9000, y: centre.y }, centre, STAGE, WIDE)).toBe(
      MAX_CAMERA_SIZE,
    );
  });
});
