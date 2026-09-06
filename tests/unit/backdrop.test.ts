import { describe, expect, it } from "vitest";
import {
  backdropDepth,
  backdropLayer,
  backdropPlane,
  backdropTransform,
} from "@/lib/present/backdrop";
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

/**
 * The layer the picture is rasterised on, which is not the plane.
 *
 * The plane is world units and a world is thousands of them across: eleven
 * scenes on a phone put it at 18,510 x 40,119. Laying the element out at that
 * size, in CSS pixels, with `will-change: transform`, asks the compositor for
 * about 2.9 GB of texture for a picture the size of a phone screen — and on a
 * phone that is not a slow frame, it is the tab being killed.
 */
describe("the picture's layer is a raster, not a world", () => {
  /** Where a point of the layer lands on screen, from the transform itself. */
  function project(transform: string, x: number, y: number) {
    const t = [...transform.matchAll(/translate\(([-\d.e+]+)px, ([-\d.e+]+)px\)/g)];
    const scale = Number(/scale\(([-\d.e+]+)\)/.exec(transform)![1]);
    const rotation = Number(/rotate\(([-\d.e+]+)deg\)/.exec(transform)![1]);
    const [ox, oy] = [Number(t[0][1]), Number(t[0][2])];
    const [tx, ty] = [Number(t[1][1]), Number(t[1][2])];
    const sx = (x + tx) * scale;
    const sy = (y + ty) * scale;
    const rad = (rotation * Math.PI) / 180;
    return {
      x: ox + sx * Math.cos(rad) - sy * Math.sin(rad),
      y: oy + sx * Math.sin(rad) + sy * Math.cos(rad),
    };
  }

  /** The transform as it was written when the element was the plane's size. */
  function planeSizedTransform(camera: Camera, distance: number) {
    const plane = backdropPlane(bounds, STAGE, VIEWPORT.width / VIEWPORT.height, distance);
    const scale =
      VIEWPORT.width / Math.max(camera.width + backdropDepth(distance) * STAGE.width, 1e-6);
    return [
      `translate(${VIEWPORT.width / 2}px, ${VIEWPORT.height / 2}px)`,
      `rotate(${-camera.rotation}deg)`,
      `scale(${scale})`,
      `translate(${plane.x - camera.x}px, ${plane.y - camera.y}px)`,
    ].join(" ");
  }

  const cameras: Camera[] = [
    { x: 0, y: 0, width: 1728, rotation: 0 },
    { x: 4200, y: -600, width: 1728, rotation: 0 },
    { x: -900, y: 300, width: 12000, rotation: 0 },
    { x: 700, y: 120, width: 640, rotation: 18 },
  ];

  it("puts the picture exactly where the plane-sized layer put it", () => {
    for (const camera of cameras) {
      for (const distance of [0, 0.5, 1]) {
        const plane = backdropPlane(bounds, STAGE, VIEWPORT.width / VIEWPORT.height, distance);
        const layer = backdropLayer(VIEWPORT);
        const now = backdropTransform(camera, VIEWPORT, plane, STAGE, distance);
        const before = planeSizedTransform(camera, distance);

        // Both corners: the same two screen points from a layer a thousand
        // times smaller. Position and size, in one assertion each.
        for (const [corner, nowPoint, beforePoint] of [
          ["top left", project(now, 0, 0), project(before, 0, 0)],
          [
            "bottom right",
            project(now, layer.width, layer.height),
            project(before, plane.width, plane.height),
          ],
        ] as const) {
          expect(nowPoint.x, `${corner} x at distance ${distance}`).toBeCloseTo(beforePoint.x, 3);
          expect(nowPoint.y, `${corner} y at distance ${distance}`).toBeCloseTo(beforePoint.y, 3);
        }
      }
    }
  });

  it("stays a few viewports whatever the world does", () => {
    // The world that produced the 2.9 GB layer: a long deck on a phone.
    const phone = { width: 430, height: 932 };
    const wide = { x: 0, y: 0, width: 1600 * 40, height: 900 * 3 };
    const plane = backdropPlane(wide, STAGE, phone.width / phone.height, 1);
    const layer = backdropLayer(phone);

    expect(plane.width, "the plane is still world-sized").toBeGreaterThan(20_000);
    expect(layer.width).toBeLessThanOrEqual(phone.width * 3);
    expect(layer.height).toBeLessThanOrEqual(phone.height * 3);
    // Megapixels, which is what the compositor is actually asked for.
    expect((layer.width * layer.height) / 1e6).toBeLessThan(4);
  });

  it("keeps the viewport's aspect, so one ratio serves both axes", () => {
    const layer = backdropLayer({ width: 430, height: 932 });
    expect(layer.width / layer.height).toBeCloseTo(430 / 932, 6);
  });
});
