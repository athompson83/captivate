import { describe, expect, it } from "vitest";
import {
  boundsOf,
  cameraScale,
  camerasEqual,
  easeFlight,
  flight,
  flightDuration,
  frameScene,
  rectsIntersect,
  sceneWorldRect,
  visibleRect,
  worldTransform,
  type Camera,
} from "@/lib/present/camera";
import { ARRANGEMENTS, arrange, resolvePlacements } from "@/lib/present/arrange";
import { routeLength, smoothPath } from "@/lib/present/path";
import type { ScenePlacement } from "@/lib/schema/presentation";

const STAGE = { width: 1600, height: 900 };
const WIDE = 16 / 9;

const place = (x: number, y: number, scale = 1, rotation = 0): ScenePlacement => ({
  x,
  y,
  scale,
  rotation,
});

describe("framing", () => {
  it("frames a scene so the whole thing fits with a margin", () => {
    const camera = frameScene(place(0, 0), STAGE, WIDE);
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
    expect(camera.width).toBeGreaterThan(STAGE.width);
    expect(camera.width).toBeLessThan(STAGE.width * 1.2);
  });

  it("pulls back further when the viewport is wider than the scene", () => {
    // A letterboxed scene is fitted by whichever axis runs out first. A 4:3
    // scene in an ultrawide window is height-limited, so the camera has to see
    // more world across to get the whole thing in.
    const tall = { width: 1600, height: 1200 };
    const matched = frameScene(place(0, 0), tall, 4 / 3);
    const ultrawide = frameScene(place(0, 0), tall, 3);
    expect(ultrawide.width).toBeGreaterThan(matched.width);
    expect(matched.width).toBeCloseTo(1600 * 1.08, 6);
  });

  it("does not pull back for a narrow viewport that already fits the height", () => {
    // The converse, which is easy to get backwards: a square window showing a
    // 16:9 scene is width-limited, so nothing extra is needed.
    expect(frameScene(place(0, 0), STAGE, 1).width).toBe(
      frameScene(place(0, 0), STAGE, WIDE).width,
    );
  });

  it("scales the framing with the scene's own scale", () => {
    const big = frameScene(place(0, 0, 1), STAGE, WIDE);
    const small = frameScene(place(0, 0, 0.25), STAGE, WIDE);
    expect(small.width).toBeCloseTo(big.width * 0.25, 6);
  });

  it("aligns the camera to a rotated scene so it reads upright", () => {
    expect(frameScene(place(0, 0, 1, -12), STAGE, WIDE).rotation).toBe(-12);
  });

  it("grows a rotated scene's world box", () => {
    const square = sceneWorldRect(place(0, 0, 1, 0), STAGE);
    const tilted = sceneWorldRect(place(0, 0, 1, 30), STAGE);
    expect(tilted.width).toBeGreaterThan(square.width);
    expect(tilted.height).toBeGreaterThan(square.height);
  });

  it("bounds every placement, including scenes at negative coordinates", () => {
    const bounds = boundsOf([place(-2000, -500), place(3000, 800)], STAGE);
    expect(bounds.x).toBeLessThanOrEqual(-2000 - STAGE.width / 2);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(3000 + STAGE.width / 2);
  });

  it("falls back to one stage-sized box when nothing is placed", () => {
    expect(boundsOf([], STAGE)).toEqual({ x: 0, y: 0, width: 1600, height: 900 });
  });
});

describe("flight", () => {
  const at = (from: Camera, to: Camera, t: number) => flight(from, to).at(t);

  it("starts exactly where it began and ends exactly where it was sent", () => {
    const from: Camera = { x: 0, y: 0, width: 1700, rotation: 0 };
    const to: Camera = { x: 9000, y: -2400, width: 420, rotation: 12 };
    const path = flight(from, to);

    const start = path.at(0);
    expect(start.x).toBeCloseTo(from.x, 4);
    expect(start.y).toBeCloseTo(from.y, 4);
    expect(start.width).toBeCloseTo(from.width, 4);

    const end = path.at(1);
    expect(end.x).toBeCloseTo(to.x, 3);
    expect(end.y).toBeCloseTo(to.y, 3);
    expect(end.width).toBeCloseTo(to.width, 3);
    expect(end.rotation).toBeCloseTo(to.rotation, 6);
  });

  it("pulls back before pushing in when the ground to cover is long", () => {
    // The reason for the whole algorithm: crossing a long distance at close
    // range is a nauseating blur, so the optimal path rises above it. Nobody
    // asked for an arc; it falls out of the geometry.
    const from: Camera = { x: 0, y: 0, width: 1700, rotation: 0 };
    const to: Camera = { x: 60_000, y: 0, width: 1700, rotation: 0 };

    const midpoint = at(from, to, 0.5);
    expect(midpoint.width).toBeGreaterThan(from.width * 3);
  });

  it("does not pull back for a short hop", () => {
    const from: Camera = { x: 0, y: 0, width: 1700, rotation: 0 };
    const to: Camera = { x: 200, y: 0, width: 1700, rotation: 0 };
    expect(at(from, to, 0.5).width).toBeLessThan(from.width * 1.2);
  });

  it("moves monotonically along the line between the two framings", () => {
    const from: Camera = { x: 0, y: 0, width: 900, rotation: 0 };
    const to: Camera = { x: 12_000, y: 4000, width: 900, rotation: 0 };
    const path = flight(from, to);

    let previous = -Infinity;
    for (let t = 0; t <= 1.00001; t += 0.05) {
      const camera = path.at(Math.min(1, t));
      const along = Math.hypot(camera.x - from.x, camera.y - from.y);
      expect(along).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = along;
    }
  });

  it("interpolates a pure zoom geometrically, not linearly", () => {
    // Halfway between 100 and 10000 is 1000 to the eye, not 5050.
    const from: Camera = { x: 0, y: 0, width: 100, rotation: 0 };
    const to: Camera = { x: 0, y: 0, width: 10_000, rotation: 0 };
    expect(at(from, to, 0.5).width).toBeCloseTo(1000, 6);
  });

  it("takes the short way round when spinning", () => {
    const from: Camera = { x: 0, y: 0, width: 1000, rotation: -170 };
    const to: Camera = { x: 0, y: 0, width: 900, rotation: 170 };
    // The short way is -20 degrees through -180, not +340 through zero.
    expect(at(from, to, 0.5).rotation).toBeCloseTo(-180, 6);
  });

  it("measures long journeys as only somewhat longer than short ones", () => {
    // Path length is perceptual, so a trip across the world does not take
    // fifty times as long as a hop next door.
    const near = flight(
      { x: 0, y: 0, width: 1700, rotation: 0 },
      { x: 2000, y: 0, width: 1700, rotation: 0 },
    ).length;
    const far = flight(
      { x: 0, y: 0, width: 1700, rotation: 0 },
      { x: 100_000, y: 0, width: 1700, rotation: 0 },
    ).length;

    expect(far).toBeGreaterThan(near);
    expect(far / near).toBeLessThan(6);
  });

  it("survives being asked to fly nowhere", () => {
    const same: Camera = { x: 10, y: 10, width: 1000, rotation: 0 };
    const path = flight(same, { ...same });
    expect(path.length).toBeCloseTo(0, 9);
    expect(path.at(0.5).x).toBeCloseTo(10, 6);
    expect(Number.isFinite(path.at(1).width)).toBe(true);
  });

  it("clamps duration to a usable range whatever the distance", () => {
    expect(flightDuration(0, 1.1)).toBe(0);
    const tiny = flightDuration(0.001, 1.1);
    const huge = flightDuration(500, 1.1);
    expect(tiny).toBeGreaterThanOrEqual(1.1 * 0.45);
    expect(huge).toBeLessThanOrEqual(1.1 * 2.4);
  });

  it("eases symmetrically and stays in range", () => {
    expect(easeFlight(0)).toBe(0);
    expect(easeFlight(1)).toBe(1);
    expect(easeFlight(0.5)).toBeCloseTo(0.5, 6);
    expect(easeFlight(-3)).toBe(0);
    expect(easeFlight(9)).toBe(1);
  });
});

describe("rendering the world", () => {
  it("converts a camera into pixels per world unit", () => {
    const camera: Camera = { x: 0, y: 0, width: 3200, rotation: 0 };
    expect(cameraScale(camera, { width: 1600, height: 900 })).toBe(0.5);
  });

  it("puts the camera's centre in the middle of the viewport", () => {
    const transform = worldTransform(
      { x: 500, y: 250, width: 1600, rotation: 0 },
      { width: 800, height: 450 },
    );
    expect(transform).toContain("translate(400px, 225px)");
    expect(transform).toContain("translate(-500px, -250px)");
    expect(transform).toContain("scale(0.5)");
  });

  it("counter-rotates the world so an aligned scene reads upright", () => {
    expect(
      worldTransform({ x: 0, y: 0, width: 1600, rotation: 15 }, { width: 1600, height: 900 }),
    ).toContain("rotate(-15deg)");
  });

  it("reports the visible region, widened when the camera is tilted", () => {
    const straight = visibleRect({ x: 0, y: 0, width: 1600, rotation: 0 }, WIDE);
    const tilted = visibleRect({ x: 0, y: 0, width: 1600, rotation: 20 }, WIDE);
    expect(straight.width).toBe(1600);
    expect(tilted.width).toBeGreaterThan(straight.width);
  });

  it("detects overlap for culling", () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectsIntersect(a, { x: 50, y: 50, width: 100, height: 100 })).toBe(true);
    expect(rectsIntersect(a, { x: 120, y: 0, width: 10, height: 10 })).toBe(false);
    // Touching edges do not overlap, so a neighbour is not needlessly drawn.
    expect(rectsIntersect(a, { x: 100, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it("compares cameras with a tolerance so equal targets do not restart a flight", () => {
    const a: Camera = { x: 1, y: 2, width: 3, rotation: 4 };
    expect(camerasEqual(a, { ...a, x: 1 + 1e-9 })).toBe(true);
    expect(camerasEqual(a, { ...a, x: 2 })).toBe(false);
  });
});

describe("arrangements", () => {
  const scenes = (count: number, sectionAt: (i: number) => string | null = () => null) =>
    Array.from({ length: count }, (_, i) => ({ id: `s${i}`, sectionId: sectionAt(i) }));

  it("produces one placement per scene for every preset", () => {
    for (const { id } of ARRANGEMENTS) {
      const placements = arrange(id, scenes(9), STAGE);
      expect(placements).toHaveLength(9);
      for (const placement of placements) {
        expect(Number.isFinite(placement.x)).toBe(true);
        expect(Number.isFinite(placement.y)).toBe(true);
        expect(placement.scale).toBeGreaterThan(0);
      }
    }
  });

  it("never produces a scale the schema would reject", () => {
    // `nested` shrinks every level, so an uncapped dive would fall out of the
    // allowed range within a dozen scenes.
    for (const { id } of ARRANGEMENTS) {
      for (const placement of arrange(id, scenes(40), STAGE)) {
        expect(placement.scale).toBeGreaterThanOrEqual(0.001);
        expect(placement.scale).toBeLessThanOrEqual(1000);
      }
    }
  });

  it("fills a page rather than a ribbon in flow", () => {
    // The reason `flow` exists: nine scenes in a line leave the canvas empty
    // and give the camera nothing to do but track sideways.
    const placements = arrange("flow", scenes(9), STAGE);
    const bounds = boundsOf(placements, STAGE);
    const aspect = bounds.width / bounds.height;
    expect(aspect).toBeGreaterThan(1);
    expect(aspect).toBeLessThan(3);

    const ribbon = boundsOf(arrange("reel", scenes(9), STAGE), STAGE);
    expect(ribbon.width / ribbon.height).toBeGreaterThan(8);
  });

  it("reverses each row so the reading path never jumps back", () => {
    // A serpentine, not a raster scan: the camera should walk to the end of a
    // row and drop to the next, not fly the whole width back to start again.
    const placements = arrange("flow", scenes(9), STAGE);
    const hops = placements
      .slice(1)
      .map((p, i) => Math.hypot(p.x - placements[i].x, p.y - placements[i].y));
    const widest = Math.max(...hops);
    expect(widest).toBeLessThan(STAGE.width * 2);
  });

  it("never sits a flow page at right angles, and never tilts two neighbours alike", () => {
    // A page of scenes all sitting square is a grid, and a grid is what tells
    // an audience they are looking at slides. The tilt is small enough to be
    // felt rather than seen — the camera squares up on arrival — and never
    // repeats across a neighbouring pair, or the page would read as a pattern.
    const placements = arrange("flow", scenes(12), STAGE);
    for (const placement of placements) {
      expect(Math.abs(placement.rotation)).toBeGreaterThan(0.5);
      expect(Math.abs(placement.rotation)).toBeLessThan(4);
    }
    for (let i = 1; i < placements.length; i += 1) {
      expect(placements[i].rotation).not.toBe(placements[i - 1].rotation);
    }
    // The conventional deck stays conventional.
    for (const placement of arrange("reel", scenes(6), STAGE)) expect(placement.rotation).toBe(0);
  });

  it("lays a reel out in a straight line at one zoom", () => {
    const placements = arrange("reel", scenes(4), STAGE);
    expect(placements.every((p) => p.y === 0 && p.scale === 1)).toBe(true);
    const gaps = placements.slice(1).map((p, i) => p.x - placements[i].x);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 6);
  });

  it("never leaves two consecutive scenes half on top of each other", () => {
    // The invariant every arrangement has to hold: neighbours are either
    // clearly apart, or one sits wholly inside the other, which is what a dive
    // means. A partial overlap is just a mess — and it is what a spiral gets
    // wrong near its centre if the spacing is estimated rather than solved.
    const contains = (outer: ReturnType<typeof sceneWorldRect>, inner: typeof outer) =>
      inner.x >= outer.x &&
      inner.y >= outer.y &&
      inner.x + inner.width <= outer.x + outer.width &&
      inner.y + inner.height <= outer.y + outer.height;

    for (const { id } of ARRANGEMENTS) {
      for (const count of [2, 3, 5, 12]) {
        const placements = arrange(id, scenes(count), STAGE);
        for (let i = 1; i < placements.length; i += 1) {
          const a = sceneWorldRect(placements[i - 1], STAGE);
          const b = sceneWorldRect(placements[i], STAGE);
          const clean = !rectsIntersect(a, b) || contains(a, b) || contains(b, a);
          expect(clean, `${id} overlaps at ${i} of ${count}`).toBe(true);
        }
      }
    }
  });

  it("clears a scene in whichever direction the next one lies", () => {
    // The near miss this guards: a separation that clears the *width* still
    // overlaps when the offset is mostly diagonal, because two rectangles miss
    // each other only by being apart on an axis. A spiral hits that band.
    const diagonal = Math.hypot(STAGE.width, STAGE.height);
    for (const preset of ["spiral", "constellation"] as const) {
      const placements = arrange(preset, scenes(8), STAGE);
      for (let i = 1; i < placements.length; i += 1) {
        const gap = Math.hypot(
          placements[i].x - placements[i - 1].x,
          placements[i].y - placements[i - 1].y,
        );
        expect(gap, `${preset} at ${i}`).toBeGreaterThanOrEqual(diagonal);
      }
    }
  });

  it("keeps a two-scene constellation apart", () => {
    // The circumference estimate is too tight for a small ring; the chord is
    // what actually has to clear a scene width.
    const placements = arrange("constellation", scenes(2), STAGE);
    expect(
      Math.hypot(placements[0].x - placements[1].x, placements[0].y - placements[1].y),
    ).toBeGreaterThanOrEqual(STAGE.width);
  });

  it("does not overlap neighbouring scenes in a reel", () => {
    const placements = arrange("reel", scenes(5), STAGE);
    for (let i = 1; i < placements.length; i += 1) {
      const previous = sceneWorldRect(placements[i - 1], STAGE);
      const current = sceneWorldRect(placements[i], STAGE);
      expect(rectsIntersect(previous, current)).toBe(false);
    }
  });

  it("puts each dive inside the scene before it", () => {
    // One chain's worth: the scene after a full chain surfaces alongside it.
    const placements = arrange("nested", scenes(3), STAGE);
    for (let i = 1; i < placements.length; i += 1) {
      const parent = sceneWorldRect(placements[i - 1], STAGE);
      const child = sceneWorldRect(placements[i], STAGE);
      expect(child.width).toBeLessThan(parent.width);
      expect(child.x).toBeGreaterThan(parent.x);
      expect(child.x + child.width).toBeLessThan(parent.x + parent.width);
    }
  });

  it("surfaces the dive rather than shrinking forever", () => {
    const placements = arrange("nested", scenes(9), STAGE);
    // Each chain restarts at full size, one cluster along.
    expect(placements[0].scale).toBe(1);
    expect(placements[3].scale).toBe(1);
    expect(placements[6].scale).toBe(1);
    expect(placements[3].x).toBeGreaterThan(placements[0].x);
  });

  it("keeps the deepest dive big enough to see and grab", () => {
    // A level small enough to vanish on the journey map is a level nobody can
    // edit, which is what an over-aggressive ratio produces.
    const deepest = Math.min(...arrange("nested", scenes(30), STAGE).map((p) => p.scale));
    expect(deepest).toBeGreaterThan(0.1);
  });

  it("gives each section its own region in a constellation", () => {
    const placements = arrange(
      "constellation",
      scenes(6, (i) => (i < 3 ? "a" : "b")),
      STAGE,
    );
    const centre = (group: typeof placements) => ({
      x: group.reduce((sum, p) => sum + p.x, 0) / group.length,
      y: group.reduce((sum, p) => sum + p.y, 0) / group.length,
    });
    const a = centre(placements.slice(0, 3));
    const b = centre(placements.slice(3));
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(STAGE.width);
  });

  it("makes sections into rows in a grid", () => {
    const placements = arrange(
      "grid",
      scenes(6, (i) => (i < 3 ? "a" : "b")),
      STAGE,
    );
    expect(new Set(placements.slice(0, 3).map((p) => p.y)).size).toBe(1);
    expect(placements[3].y).toBeGreaterThan(placements[0].y);
  });
});

describe("resolving placements", () => {
  const scenes = [
    { id: "a", sectionId: null, placement: null },
    { id: "b", sectionId: null, placement: null },
    { id: "c", sectionId: null, placement: null },
  ];

  it("derives from the arrangement when nothing has been placed by hand", () => {
    const resolved = resolvePlacements(scenes, { arrangement: "reel" }, STAGE);
    expect(resolved).toEqual(arrange("reel", scenes, STAGE));
  });

  it("lets a hand-placed scene win over the preset", () => {
    const moved = place(-5000, 900, 0.5, 8);
    const resolved = resolvePlacements(
      [scenes[0], { ...scenes[1], placement: moved }, scenes[2]],
      { arrangement: "reel" },
      STAGE,
    );
    expect(resolved[1]).toEqual(moved);
  });

  it("puts a new scene beside the previous one once a world is hand-arranged", () => {
    // The bug this guards: a scene added to a world someone has arranged by
    // hand should not jump back to wherever the preset would have put index 2.
    const resolved = resolvePlacements(
      [
        { ...scenes[0], placement: place(0, 0, 0.4) },
        { ...scenes[1], placement: place(900, 0, 0.4) },
        scenes[2],
      ],
      { arrangement: "reel" },
      STAGE,
    );

    expect(resolved[2].scale).toBe(0.4);
    expect(resolved[2].x).toBeGreaterThan(900);
    expect(resolved[2].y).toBe(0);
    expect(resolved[2].x).toBeLessThan(arrange("reel", scenes, STAGE)[2].x);
  });

  it("handles an empty presentation", () => {
    expect(resolvePlacements([], { arrangement: "spiral" }, STAGE)).toEqual([]);
  });
});

describe("the route", () => {
  it("draws nothing for no waypoints and a point for one", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([{ x: 5, y: 6 }])).toBe("M 5 6");
  });

  it("passes through every waypoint", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: 220, y: -30 },
    ];
    const path = smoothPath(points);
    expect(path.startsWith("M 0 0")).toBe(true);
    expect(path).toContain("220 -30");
    expect(path.match(/C /g)).toHaveLength(2);
  });

  it("is a straight polyline at zero tension", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(smoothPath(points, 0)).toBe("M 0 0 C 0 0, 10 0, 10 0");
  });

  it("measures the route", () => {
    expect(
      routeLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
        { x: 3, y: 14 },
      ]),
    ).toBe(15);
  });
});
