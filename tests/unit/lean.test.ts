import { describe, expect, it } from "vitest";
import { backdropTransform } from "@/lib/present/backdrop";
import {
  LEAN_REST,
  LEAN_STRENGTH,
  LEVEL,
  approachLean,
  isSettled,
  leanCamera,
  pointerLean,
} from "@/lib/present/lean";

const rect = { left: 100, top: 50, width: 1600, height: 900 };
const camera = { x: 400, y: 300, width: 1600, rotation: 0 };

/**
 * The room answers the hand: what is behind a scene follows a mouse over the
 * world a little, and the scene itself does not move at all.
 */
describe("where the hand is", () => {
  it("is level at the centre and a unit lean at the edges", () => {
    expect(pointerLean(900, 500, rect)).toEqual({ x: 0, y: 0 });
    expect(pointerLean(1700, 50, rect)).toEqual({ x: 1, y: -1 });
    expect(pointerLean(100, 950, rect)).toEqual({ x: -1, y: 1 });
  });

  it("clamps a pointer past the edge rather than leaning the room past it", () => {
    expect(pointerLean(5000, -5000, rect)).toEqual({ x: 1, y: -1 });
  });

  it("is level over a box with no size", () => {
    expect(pointerLean(10, 10, { ...rect, width: 0 })).toEqual(LEVEL);
  });
});

describe("easing toward the hand", () => {
  it("closes the distance at the same rate whatever the frame rate", () => {
    const target = { x: 1, y: 0 };
    let at60 = LEVEL;
    for (let i = 0; i < 12; i++) at60 = approachLean(at60, target, 1 / 60);
    let at30 = LEVEL;
    for (let i = 0; i < 6; i++) at30 = approachLean(at30, target, 1 / 30);
    expect(at60.x).toBeCloseTo(at30.x, 3);
    expect(at60.x).toBeGreaterThan(0.5);
    expect(at60.x).toBeLessThan(1);
  });

  it("snaps onto the target once within rest, so the loop can stop", () => {
    const target = { x: 0.4, y: -0.2 };
    let lean = LEVEL;
    for (let i = 0; i < 200 && !isSettled(lean, target); i++) {
      lean = approachLean(lean, target, 1 / 60);
    }
    expect(lean).toEqual(target);
  });

  it("returns exactly level when the hand leaves", () => {
    let lean = { x: 0.9, y: 0.7 };
    for (let i = 0; i < 200 && !isSettled(lean, LEVEL); i++) {
      lean = approachLean(lean, LEVEL, 1 / 60);
    }
    expect(lean).toEqual({ x: 0, y: 0 });
  });

  it("does not move backwards on a zero or negative step", () => {
    const lean = { x: 0.3, y: 0.3 };
    expect(approachLean(lean, { x: 1, y: 1 }, 0)).toEqual(lean);
    expect(approachLean(lean, { x: 1, y: 1 }, -1)).toEqual(lean);
  });

  it("counts a lean within rest as settled only once snapped", () => {
    expect(isSettled({ x: LEAN_REST / 2, y: 0 }, LEVEL)).toBe(false);
    expect(isSettled(LEVEL, LEVEL)).toBe(true);
  });
});

describe("the camera the room is seen from", () => {
  it("is the camera itself when the room is level", () => {
    expect(leanCamera(camera, LEVEL, 16 / 9)).toBe(camera);
  });

  it("leans by a fraction of the camera's width, so a lean is the same size at any zoom", () => {
    const wide = leanCamera(camera, { x: 1, y: 0 }, 16 / 9);
    const close = leanCamera({ ...camera, width: 400 }, { x: 1, y: 0 }, 16 / 9);
    expect(Math.abs(wide.x - camera.x)).toBeCloseTo(LEAN_STRENGTH * 1600, 6);
    expect(Math.abs(close.x - camera.x)).toBeCloseTo(LEAN_STRENGTH * 400, 6);
    // A whole camera, not a patch: width and rotation come through untouched.
    expect(wide.width).toBe(camera.width);
    expect(wide.rotation).toBe(camera.rotation);
  });

  it("scales the vertical lean by the viewport's aspect, so an edge is an edge both ways", () => {
    const leaned = leanCamera(camera, { x: 0, y: 1 }, 2);
    expect(Math.abs(leaned.y - camera.y)).toBeCloseTo((LEAN_STRENGTH * 1600) / 2, 6);
  });

  it("moves the room with the hand: lean right and the backdrop shifts right", () => {
    const viewport = { width: 1600, height: 900 };
    const plane = { x: -2000, y: -1000, width: 6000, height: 3375 };
    const stage = { width: 1600, height: 900 };
    const translateX = (transform: string) => {
      const matches = [...transform.matchAll(/translate\(([-\d.]+)px, ([-\d.]+)px\)/g)];
      return Number(matches[matches.length - 1][1]);
    };
    const level = translateX(backdropTransform(camera, viewport, plane, stage, 0.5));
    const right = translateX(
      backdropTransform(leanCamera(camera, { x: 1, y: 0 }, 16 / 9), viewport, plane, stage, 0.5),
    );
    const left = translateX(
      backdropTransform(leanCamera(camera, { x: -1, y: 0 }, 16 / 9), viewport, plane, stage, 0.5),
    );
    expect(right).toBeGreaterThan(level);
    expect(left).toBeLessThan(level);
  });

  it("leans left and right as the room sees it when the camera is turned", () => {
    const turned = { ...camera, rotation: 90 };
    const leaned = leanCamera(turned, { x: 1, y: 0 }, 16 / 9);
    // The screen's horizontal is the world's vertical under a quarter turn.
    expect(leaned.x).toBeCloseTo(turned.x, 6);
    expect(Math.abs(leaned.y - turned.y)).toBeCloseTo(LEAN_STRENGTH * 1600, 6);
  });
});
