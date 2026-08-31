import { describe, expect, it } from "vitest";
import {
  FRAME_MARGIN,
  HERO_FLIGHT,
  HERO_SCENES,
  HOLD_MS,
  LOOP_MS,
  TRAVEL_MS,
  cameraAt,
  easeInOutQuart,
  flightPath,
  framingDistance,
  restingAt,
  wideShot,
} from "@/lib/marketing/hero-world";

const ASPECT = 16 / 9;
const FOV = 42;

describe("the hero flight", () => {
  it("visits every scene", () => {
    expect([...HERO_FLIGHT].sort()).toEqual(HERO_SCENES.map((s) => s.id).sort());
  });

  it("comes to rest framing the scene it is visiting", () => {
    HERO_FLIGHT.forEach((id, index) => {
      const scene = HERO_SCENES.find((s) => s.id === id)!;
      const camera = cameraAt(index * (HOLD_MS + TRAVEL_MS) + HOLD_MS / 2, ASPECT, FOV);
      expect(camera.x).toBeCloseTo(scene.x, 5);
      expect(camera.y).toBeCloseTo(scene.y, 5);
    });
  });

  it("closes the loop, so nothing jumps at the seam", () => {
    const start = cameraAt(0, ASPECT, FOV);
    const end = cameraAt(LOOP_MS, ASPECT, FOV);
    expect(end).toEqual(start);
    // And the instant before the seam is already almost there.
    const nearly = cameraAt(LOOP_MS - 1, ASPECT, FOV);
    expect(Math.abs(nearly.x - start.x)).toBeLessThan(0.05);
    expect(Math.abs(nearly.y - start.y)).toBeLessThan(0.05);
  });

  it("moves continuously — no leg starts somewhere the last one did not end", () => {
    // A discontinuity here is a visible cut, which is the one transition this
    // product does not have between scenes.
    let previous = cameraAt(0, ASPECT, FOV);
    for (let t = 0; t <= LOOP_MS; t += 16) {
      const camera = cameraAt(t, ASPECT, FOV);
      const step = Math.hypot(camera.x - previous.x, camera.y - previous.y, camera.z - previous.z);
      expect(step).toBeLessThan(0.6);
      previous = camera;
    }
  });

  it("wraps negative and long-running clocks rather than flying off", () => {
    expect(cameraAt(-HOLD_MS / 2, ASPECT, FOV)).toEqual(
      cameraAt(LOOP_MS - HOLD_MS / 2, ASPECT, FOV),
    );
    expect(cameraAt(LOOP_MS * 37 + 500, ASPECT, FOV)).toEqual(cameraAt(500, ASPECT, FOV));
  });
});

describe("framing", () => {
  it("pulls back far enough to hold a wide scene on a narrow viewport", () => {
    const scene = HERO_SCENES.find((s) => s.id === "close")!;
    const wide = framingDistance(scene, 16 / 9, FOV);
    const narrow = framingDistance(scene, 0.55, FOV);
    // A phone is width-bound, so it must retreat further than a laptop does.
    expect(narrow).toBeGreaterThan(wide);
  });

  it("never places the camera behind the scene it is framing", () => {
    for (const scene of HERO_SCENES) {
      expect(restingAt(scene, ASPECT, FOV).z).toBeGreaterThan(scene.z);
    }
  });

  it("holds every scene in the still framing", () => {
    // The reduced-motion view is the wide shot, so it has to actually contain
    // the argument rather than being a frozen frame of one scene.
    const camera = wideShot(ASPECT, FOV);
    const halfHeight = Math.tan((FOV * Math.PI) / 180 / 2) * camera.z;
    const halfWidth = halfHeight * ASPECT;
    for (const scene of HERO_SCENES) {
      expect(Math.abs(scene.x - camera.x) + scene.width / 2).toBeLessThanOrEqual(halfWidth);
      expect(Math.abs(scene.y - camera.y) + scene.height / 2).toBeLessThanOrEqual(halfHeight);
    }
  });
});

describe("the framing margin", () => {
  it("keeps a scene's neighbours in frame while it is being visited", () => {
    // Framed tightly, every waypoint fills the view with one abstract card and
    // the hero becomes the slideshow it exists to argue against.
    expect(FRAME_MARGIN).toBeGreaterThan(2.5);

    const visited = HERO_SCENES.find((s) => s.id === "claim")!;
    const camera = restingAt(visited, ASPECT, FOV);
    const halfHeight = Math.tan((FOV * Math.PI) / 180 / 2) * (camera.z - visited.z);
    const halfWidth = halfHeight * ASPECT;

    const alsoVisible = HERO_SCENES.filter(
      (scene) =>
        scene.id !== visited.id &&
        Math.abs(scene.x - camera.x) < halfWidth &&
        Math.abs(scene.y - camera.y) < halfHeight,
    );
    expect(alsoVisible.length).toBeGreaterThan(0);
  });
});

describe("the easing", () => {
  it("starts at rest and arrives at rest", () => {
    expect(easeInOutQuart(0)).toBe(0);
    expect(easeInOutQuart(1)).toBe(1);
    expect(easeInOutQuart(0.5)).toBeCloseTo(0.5, 6);
  });

  it("never goes backwards, and never overshoots", () => {
    let previous = -1;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const value = easeInOutQuart(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });

  it("clamps rather than extrapolating", () => {
    expect(easeInOutQuart(-4)).toBe(0);
    expect(easeInOutQuart(9)).toBe(1);
  });
});

describe("the drawn path", () => {
  it("threads the scene centres in visiting order", () => {
    const path = flightPath();
    expect(path).toHaveLength(HERO_FLIGHT.length);
    path.forEach((point, index) => {
      const scene = HERO_SCENES.find((s) => s.id === HERO_FLIGHT[index])!;
      expect(point).toEqual({ x: scene.x, y: scene.y, z: scene.z });
    });
  });
});

describe("the loop's shape", () => {
  it("spends more time travelling than waiting, so it is never static", () => {
    expect(TRAVEL_MS).toBeGreaterThan(HOLD_MS);
    expect(LOOP_MS).toBe(HERO_FLIGHT.length * (HOLD_MS + TRAVEL_MS));
  });
});
