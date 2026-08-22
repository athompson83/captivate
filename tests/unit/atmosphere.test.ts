import { describe, expect, it } from "vitest";
import {
  MAX_REGIONS,
  atmosphereDpr,
  falloffFor,
  fragmentFromUv,
  nearestRegions,
  packRegions,
  regionBuffers,
  screenToWorld,
  viewUniforms,
} from "@/lib/present/atmosphere";
import { paletteOf } from "@/lib/present/ambient";
import { worldTransform, type Camera } from "@/lib/present/camera";
import { getTheme } from "@/lib/schema/theme";
import type { ScenePlacement } from "@/lib/schema/presentation";

/**
 * The atmosphere is a shader, and a shader cannot be unit-tested here. What
 * can be — and what would otherwise be debugged for a very long time as "the
 * background looks a bit wrong" — is the arithmetic it is handed: the mapping
 * from a pixel back to a world position, and which regions are in play.
 */

const VIEWPORT = { width: 1440, height: 900 };
const STAGE = { width: 1600, height: 900 };

function placement(x: number, y: number): ScenePlacement {
  return { x, y, scale: 1, rotation: 0 };
}

/**
 * Where the browser would put a world point, from the transform string the
 * world actually applies. Parsed rather than recomputed, so this checks the
 * real thing rather than a second copy of the same maths.
 */
function throughWorldTransform(camera: Camera, world: { x: number; y: number }) {
  const css = worldTransform(camera, VIEWPORT);

  const translateCentre = /^translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(css);
  const rotate = /rotate\((-?[\d.]+)deg\)/.exec(css);
  const scale = /scale\(([\d.]+)\)/.exec(css);
  const translateCamera = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)\s*$/.exec(css);

  expect(translateCentre, css).not.toBeNull();
  expect(rotate, css).not.toBeNull();
  expect(scale, css).not.toBeNull();
  expect(translateCamera, css).not.toBeNull();

  // The transforms apply right to left, as the browser reads them.
  let x = world.x + Number(translateCamera![1]);
  let y = world.y + Number(translateCamera![2]);

  x *= Number(scale![1]);
  y *= Number(scale![1]);

  const radians = (Number(rotate![1]) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;

  return { x: rx + Number(translateCentre![1]), y: ry + Number(translateCentre![2]) };
}

describe("a pixel back to a place", () => {
  const cameras: Camera[] = [
    { x: 0, y: 0, width: 1600, rotation: 0 },
    { x: 4200, y: -1800, width: 640, rotation: 0 },
    { x: -900, y: 2400, width: 9000, rotation: 0 },
    { x: 300, y: 300, width: 1600, rotation: 30 },
    { x: -2000, y: 750, width: 2400, rotation: -18.5 },
  ];

  it("inverts the transform the world actually applies", () => {
    // A shader that puts the air in the wrong place looks like a shader that
    // is merely ugly, and gets debugged as one. This is the check that says
    // which of the two it is.
    for (const camera of cameras) {
      const view = viewUniforms(camera, VIEWPORT);

      for (const point of [
        { x: 0, y: 0 },
        { x: 1600, y: 900 },
        { x: -3200, y: 450 },
        { x: camera.x, y: camera.y },
      ]) {
        const screen = throughWorldTransform(camera, point);
        const back = screenToWorld(view, screen.x, screen.y);

        expect(back.x, JSON.stringify({ camera, point })).toBeCloseTo(point.x, 4);
        expect(back.y, JSON.stringify({ camera, point })).toBeCloseTo(point.y, 4);
      }
    }
  });

  it("puts the camera's own position at the centre of the screen", () => {
    for (const camera of cameras) {
      const view = viewUniforms(camera, VIEWPORT);
      const centre = screenToWorld(view, VIEWPORT.width / 2, VIEWPORT.height / 2);
      expect(centre.x).toBeCloseTo(camera.x, 6);
      expect(centre.y).toBeCloseTo(camera.y, 6);
    }
  });

  it("covers more world as the camera pulls back", () => {
    const close = viewUniforms({ x: 0, y: 0, width: 800, rotation: 0 }, VIEWPORT);
    const far = viewUniforms({ x: 0, y: 0, width: 8000, rotation: 0 }, VIEWPORT);

    const edgeClose = screenToWorld(close, VIEWPORT.width, VIEWPORT.height / 2).x;
    const edgeFar = screenToWorld(far, VIEWPORT.width, VIEWPORT.height / 2).x;

    expect(edgeFar).toBeGreaterThan(edgeClose * 9);
  });
});

describe("a texture coordinate to a screen pixel", () => {
  const resolution = { width: 1440, height: 900 };

  it("flips v, because the two conventions disagree about which way is up", () => {
    // three's PlaneGeometry puts uv.v = 1 at the vertices WebGL draws at the
    // top; every screen coordinate here has y = 0 there.
    expect(fragmentFromUv({ x: 0, y: 1 }, resolution)).toEqual({ x: 0, y: 0 });
    expect(fragmentFromUv({ x: 1, y: 0 }, resolution)).toEqual({ x: 1440, y: 900 });
  });

  it("puts the top of the screen above the camera in the world", () => {
    // The assertion that matters, and the one that was missing: the whole
    // chain, from the coordinate the shader is handed to the place it decides
    // to sample. Reading v straight through reflected the field about the
    // camera's horizontal axis and a region above you lit the bottom.
    const camera: Camera = { x: 0, y: 0, width: 1600, rotation: 0 };
    const view = viewUniforms(camera, resolution);

    const top = fragmentFromUv({ x: 0.5, y: 1 }, resolution);
    const bottom = fragmentFromUv({ x: 0.5, y: 0 }, resolution);

    expect(screenToWorld(view, top.x, top.y).y).toBeLessThan(camera.y);
    expect(screenToWorld(view, bottom.x, bottom.y).y).toBeGreaterThan(camera.y);
  });

  it("keeps u alone, because x already agrees", () => {
    const view = viewUniforms({ x: 0, y: 0, width: 1600, rotation: 0 }, resolution);
    const left = fragmentFromUv({ x: 0, y: 0.5 }, resolution);
    const right = fragmentFromUv({ x: 1, y: 0.5 }, resolution);

    expect(screenToWorld(view, left.x, left.y).x).toBeLessThan(0);
    expect(screenToWorld(view, right.x, right.y).x).toBeGreaterThan(0);
  });
});

describe("which regions colour the air", () => {
  const palettes = [
    paletteOf(getTheme("midnight")),
    paletteOf(getTheme("midnight")),
    paletteOf(getTheme("midnight")),
  ];

  it("takes the nearest first, so the field follows the presenter", () => {
    const placements = [placement(10_000, 0), placement(0, 0), placement(2000, 0)];
    const camera: Camera = { x: 0, y: 0, width: 1600, rotation: 0 };

    const regions = nearestRegions(camera, placements, palettes);
    expect(regions.map((r) => r.x)).toEqual([0, 2000, 10_000]);
  });

  it("re-picks as the camera moves", () => {
    const placements = [placement(0, 0), placement(20_000, 0)];
    const near = nearestRegions(
      { x: 19_000, y: 0, width: 1600, rotation: 0 },
      placements,
      palettes,
    );
    expect(near[0].x).toBe(20_000);
  });

  it("never hands the shader more slots than its program has", () => {
    // A uniform array's length is baked into the compiled program, so this is
    // not a soft limit — overflowing it would silently write nothing.
    const many = Array.from({ length: MAX_REGIONS + 40 }, (_, i) => placement(i * 100, 0));
    const all = many.map(() => palettes[0]);
    expect(nearestRegions({ x: 0, y: 0, width: 1600, rotation: 0 }, many, all)).toHaveLength(
      MAX_REGIONS,
    );
  });

  it("carries each region's own palette, not the presentation's", () => {
    const distinct = [paletteOf(getTheme("midnight")), paletteOf(getTheme("paper"))];
    const regions = nearestRegions(
      { x: 0, y: 0, width: 1600, rotation: 0 },
      [placement(0, 0), placement(500, 0)],
      distinct,
    );
    expect(regions[0].canvas).not.toEqual(regions[1].canvas);
  });

  it("survives a placement with no matching palette", () => {
    const regions = nearestRegions({ x: 0, y: 0, width: 1600, rotation: 0 }, [placement(0, 0)], []);
    expect(regions[0].canvas).toEqual([0, 0, 0]);
  });
});

describe("packing the uniforms", () => {
  const palettes = [paletteOf(getTheme("midnight")), paletteOf(getTheme("paper"))];

  it("reports how many slots the shader should read", () => {
    const buffers = regionBuffers();
    const regions = nearestRegions(
      { x: 0, y: 0, width: 1600, rotation: 0 },
      [placement(1, 2), placement(3, 4)],
      palettes,
    );
    expect(packRegions(regions, buffers)).toBe(2);
  });

  it("lays positions out as pairs and colours as triples", () => {
    const buffers = regionBuffers();
    const regions = nearestRegions(
      { x: 0, y: 0, width: 1600, rotation: 0 },
      [placement(11, 22), placement(33, 44)],
      palettes,
    );
    packRegions(regions, buffers);

    expect([buffers.positions[0], buffers.positions[1]]).toEqual([11, 22]);
    expect([buffers.positions[2], buffers.positions[3]]).toEqual([33, 44]);
    expect(buffers.canvas[0]).toBeCloseTo(regions[0].canvas[0], 5);
    expect(buffers.canvas[3]).toBeCloseTo(regions[1].canvas[0], 5);
  });

  it("reuses one buffer, so a frame allocates nothing", () => {
    const buffers = regionBuffers();
    const first = buffers.positions;
    packRegions(
      nearestRegions({ x: 0, y: 0, width: 1600, rotation: 0 }, [placement(1, 1)], palettes),
      buffers,
    );
    expect(buffers.positions).toBe(first);
  });

  it("leaves the slots past the count alone rather than clearing them", () => {
    // The shader reads `count`, not the array length. Clearing every frame
    // would be 144 writes to say nothing.
    const buffers = regionBuffers();
    buffers.positions[MAX_REGIONS * 2 - 1] = 999;
    packRegions(
      nearestRegions({ x: 0, y: 0, width: 1600, rotation: 0 }, [placement(1, 1)], palettes),
      buffers,
    );
    expect(buffers.positions[MAX_REGIONS * 2 - 1]).toBe(999);
  });

  it("has room for every slot the program declares", () => {
    const buffers = regionBuffers();
    expect(buffers.positions.length).toBe(MAX_REGIONS * 2);
    expect(buffers.canvas.length).toBe(MAX_REGIONS * 3);
    expect(buffers.accent.length).toBe(MAX_REGIONS * 3);
  });
});

describe("scale and cost", () => {
  it("measures reach in scene widths, so arrangements behave alike", () => {
    expect(falloffFor(STAGE)).toBeGreaterThan(0);
    expect(falloffFor({ width: 3200, height: 1800 })).toBeCloseTo(falloffFor(STAGE) * 2, 6);
  });

  it("caps the pixel ratio, because this layer has no edge to sharpen", () => {
    expect(atmosphereDpr(3)).toBe(1.5);
    expect(atmosphereDpr(2)).toBe(1.5);
    expect(atmosphereDpr(1)).toBe(1);
  });

  it("survives a browser reporting nonsense for its pixel ratio", () => {
    expect(atmosphereDpr(0)).toBe(1);
    expect(atmosphereDpr(Number.NaN)).toBe(1);
  });
});
