import { describe, expect, it } from "vitest";
import { backdropDepth, backdropPlane, backdropTransform } from "@/lib/present/backdrop";
import { frameRect, type Camera } from "@/lib/present/camera";
import { JourneyConfig } from "@/lib/schema/presentation";

/**
 * A picture behind the whole show, with depth.
 *
 * Two claims, each the kind that looks fine and is wrong: that a flight moves
 * the picture less than the content (parallax), and that the picture covers
 * the screen however far the camera pulls back.
 */

const STAGE = { width: 1600, height: 900 };
const VIEWPORT = { width: 1600, height: 900 };
const bounds = { x: 0, y: 0, width: 1600 * 4, height: 900 * 2 };

const translateOf = (transform: string) => {
  const parts = [...transform.matchAll(/translate\(([-\d.]+)px, ([-\d.]+)px\)/g)];
  const scale = Number(/scale\(([-\d.e]+)\)/.exec(transform)![1]);
  const inner = parts[1];
  return { x: Number(inner[1]) * scale, y: Number(inner[2]) * scale, scale };
};

describe("the backdrop plane", () => {
  it("sits further back the higher the distance setting", () => {
    expect(backdropDepth(0)).toBeLessThan(backdropDepth(0.5));
    expect(backdropDepth(0.5)).toBeLessThan(backdropDepth(1));
    expect(backdropDepth(-3)).toBe(backdropDepth(0));
  });

  it("covers the viewport at the widest framing the camera can take", () => {
    for (const distance of [0, 0.5, 1]) {
      const plane = backdropPlane(bounds, STAGE, 16 / 9, distance);
      const overview = frameRect(bounds, 16 / 9);
      const scale = VIEWPORT.width / (overview.width + backdropDepth(distance) * STAGE.width);
      expect(plane.width * scale).toBeGreaterThanOrEqual(VIEWPORT.width);
      expect(plane.height * scale).toBeGreaterThanOrEqual(VIEWPORT.height);
    }
  });

  it("is centred on the world", () => {
    const plane = backdropPlane(bounds, STAGE, 16 / 9, 0.5);
    expect(plane.x + plane.width / 2).toBeCloseTo(bounds.x + bounds.width / 2, 6);
    expect(plane.y + plane.height / 2).toBeCloseTo(bounds.y + bounds.height / 2, 6);
  });
});

describe("the backdrop under a camera", () => {
  const plane = backdropPlane(bounds, STAGE, 16 / 9, 0.5);
  const at = (x: number): Camera => ({ x, y: 0, width: 1728, rotation: 0 });

  it("slides less than the content when the camera pans", () => {
    const before = translateOf(backdropTransform(at(0), VIEWPORT, plane, STAGE, 0.5));
    const after = translateOf(backdropTransform(at(1000), VIEWPORT, plane, STAGE, 0.5));
    const moved = Math.abs(after.x - before.x);
    const contentMoved = 1000 * (VIEWPORT.width / 1728);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(contentMoved * 0.5);
  });

  it("slides less the further away it is", () => {
    const near =
      translateOf(backdropTransform(at(1000), VIEWPORT, plane, STAGE, 0)).x -
      translateOf(backdropTransform(at(0), VIEWPORT, plane, STAGE, 0)).x;
    const far =
      translateOf(backdropTransform(at(1000), VIEWPORT, plane, STAGE, 1)).x -
      translateOf(backdropTransform(at(0), VIEWPORT, plane, STAGE, 1)).x;
    expect(Math.abs(far)).toBeLessThan(Math.abs(near));
  });

  it("grows less than the content when the camera dives", () => {
    const wide = translateOf(
      backdropTransform({ ...at(0), width: 3456 }, VIEWPORT, plane, STAGE, 0.5),
    );
    const close = translateOf(
      backdropTransform({ ...at(0), width: 1728 }, VIEWPORT, plane, STAGE, 0.5),
    );
    expect(close.scale / wide.scale).toBeGreaterThan(1);
    expect(close.scale / wide.scale).toBeLessThan(2);
  });

  it("is still when the camera is still", () => {
    const a = backdropTransform(at(400), VIEWPORT, plane, STAGE, 0.5);
    const b = backdropTransform(at(400), VIEWPORT, plane, STAGE, 0.5);
    expect(a).toBe(b);
  });
});

describe("the journey config", () => {
  it("has no backdrop until an author sets one, and keeps old rows valid", () => {
    const journey = JourneyConfig.parse({});
    expect(journey.backdrop.url).toBe("");
    expect(journey.backdrop.distance).toBe(0.5);
    const legacy = JourneyConfig.parse({ arrangement: "flow", travel: "fly" });
    expect(legacy.backdrop.url).toBe("");
  });

  it("refuses a backdrop that is not a media source", () => {
    expect(JourneyConfig.safeParse({ backdrop: { url: "javascript:alert(1)" } }).success).toBe(
      false,
    );
    expect(
      JourneyConfig.safeParse({ backdrop: { url: "/api/assets/abc/content", assetId: "abc" } })
        .success,
    ).toBe(true);
  });
});
