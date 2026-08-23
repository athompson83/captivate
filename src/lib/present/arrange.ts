import type { ArrangePreset, JourneyConfig, ScenePlacement } from "@/lib/schema/presentation";
import type { Size } from "./camera";

/**
 * Spatial arrangements.
 *
 * An arrangement turns an ordered list of scenes into positions on the world
 * canvas. It is a starting point, not a cage — every position can be dragged
 * afterwards on the journey map, and a scene that has been moved keeps its own
 * placement while the rest continue to follow the preset.
 *
 * Each preset is a pure function of index, section and count, which is what
 * makes them safe to recompute on every render and easy to test.
 *
 * `reel` is the conventional slideshow: a straight line at constant zoom. It is
 * deliberately the same code path as everything else, because a slideshow is
 * one arrangement out of several rather than a different kind of thing.
 */

export interface ArrangeInput {
  id: string;
  sectionId: string | null;
}

/**
 * Gap between neighbouring regions, as a fraction of a scene's width.
 *
 * Tuned down from 0.3 once scenes stopped being cards. Two bordered boxes need
 * a wide gutter or they look crowded; two areas of one page do not, and content
 * already keeps a safe margin inside its own frame, so the real distance
 * between two blocks of text is this plus twice that margin. The tighter the
 * composition, the more it reads as a single designed surface rather than a row
 * of slides parked next to each other.
 */
const GAP = 0.08;

/**
 * How much smaller each level of a `nested` dive is.
 *
 * Tuned by looking at it: 0.3 over four levels ends at 2.7% of the opening
 * scene, which is a dramatic flight but leaves an invisible speck on the
 * journey map and nothing an author can grab. Three levels at 0.34 still zooms
 * roughly three times per step — unmistakably a dive — while keeping the
 * deepest scene big enough to see and edit.
 */
const NEST_RATIO = 0.34;
/** Levels before a nest surfaces and starts again; keeps scales sane. */
const NEST_DEPTH = 3;

/**
 * Separation that clears a scene whichever direction the next one lies in.
 *
 * Two axis-aligned rectangles miss each other only if they are apart on *an*
 * axis, so the worst case — offset just under a width across and just under a
 * height down — needs the diagonal. Arrangements that step purely sideways can
 * use the width; anything that places at an arbitrary angle cannot, and a
 * spiral built on the width alone overlaps in a narrow band of directions that
 * is easy to miss by eye and trivial to hit in practice.
 */
function clearance(stage: Size): number {
  return Math.hypot(stage.width, stage.height) * (1 + GAP);
}

function placement(x: number, y: number, scale = 1, rotation = 0): ScenePlacement {
  return { x, y, scale, rotation };
}

/** Indices grouped by section, in scene order, with unsectioned scenes first. */
function groupBySection(scenes: ArrangeInput[]): number[][] {
  const groups = new Map<string, number[]>();
  scenes.forEach((scene, index) => {
    const key = scene.sectionId ?? " loose";
    const existing = groups.get(key);
    if (existing) existing.push(index);
    else groups.set(key, [index]);
  });
  return [...groups.values()];
}

function reel(scenes: ArrangeInput[], stage: Size): ScenePlacement[] {
  const step = stage.width * (1 + GAP);
  return scenes.map((_, i) => placement(i * step, 0));
}

function grid(scenes: ArrangeInput[], stage: Size): ScenePlacement[] {
  // Sections become rows when they exist; otherwise fall back to a square-ish
  // grid, which keeps a long unsectioned deck from becoming a single long row.
  const groups = groupBySection(scenes);
  const useSections = groups.length > 1;
  const columns = useSections
    ? Math.max(...groups.map((g) => g.length))
    : Math.max(1, Math.ceil(Math.sqrt(scenes.length)));

  const stepX = stage.width * (1 + GAP);
  const stepY = stage.height * (1 + GAP);
  const out: ScenePlacement[] = new Array(scenes.length);

  if (useSections) {
    groups.forEach((group, row) => {
      group.forEach((sceneIndex, column) => {
        out[sceneIndex] = placement(column * stepX, row * stepY);
      });
    });
    return out;
  }

  scenes.forEach((_, i) => {
    out[i] = placement((i % columns) * stepX, Math.floor(i / columns) * stepY);
  });
  return out;
}

function flow(scenes: ArrangeInput[], stage: Size): ScenePlacement[] {
  // One page, filled.
  //
  // A single long line is a ribbon: it leaves most of the canvas empty and the
  // camera does nothing but track sideways. A serpentine fills a roughly 16:9
  // world instead, so pulling back shows a composition rather than a strip, and
  // the reading order still runs continuously — each row reverses, so the
  // camera never jumps back across the whole page to start the next one.
  //
  // Square-ish in *cells* is 16:9 in world units, because a cell is a scene.
  const columns = Math.max(1, Math.ceil(Math.sqrt(scenes.length)));
  const stepX = stage.width * (1 + GAP);
  const stepY = stage.height * (1 + GAP);

  return scenes.map((_, i) => {
    const row = Math.floor(i / columns);
    const withinRow = i % columns;
    const column = row % 2 === 0 ? withinRow : columns - 1 - withinRow;
    return placement(column * stepX, row * stepY);
  });
}

function timeline(scenes: ArrangeInput[], stage: Size): ScenePlacement[] {
  // A spine with scenes alternating above and below it. The eye reads the
  // sequence as a line of argument rather than as a stack of pages, and the
  // camera's small vertical hops give each move a bit of character.
  const stepX = stage.width * (1 + GAP * 0.7);
  const offset = stage.height * 0.34;
  let previousSection = scenes[0]?.sectionId ?? null;
  let x = 0;

  return scenes.map((scene, i) => {
    if (i > 0) {
      const boundary = scene.sectionId !== previousSection;
      x += stepX * (boundary ? 1.75 : 1);
      previousSection = scene.sectionId;
    }
    return placement(x, i % 2 === 0 ? -offset : offset, 1, i % 2 === 0 ? -1.5 : 1.5);
  });
}

function spiral(scenes: ArrangeInput[], stage: Size): ScenePlacement[] {
  // An Archimedean spiral, walked outward one scene at a time.
  //
  // The obvious closed form — invert the arc-length integral — bunches the
  // first few scenes badly, because near the centre a whole radian of angle
  // covers almost no distance. Solving for the angle that puts the *chord*
  // between neighbours at exactly one scene-width is a few lines of bisection
  // and guarantees no two consecutive scenes ever overlap.
  const spacing = clearance(stage);
  const perRadian = (spacing * 1.28) / (2 * Math.PI);
  const at = (t: number) => ({ x: Math.cos(t) * perRadian * t, y: Math.sin(t) * perRadian * t });
  const chord = (a: number, b: number) => {
    const p = at(a);
    const q = at(b);
    return Math.hypot(q.x - p.x, q.y - p.y);
  };

  const out: ScenePlacement[] = [placement(0, 0)];
  if (scenes.length === 1) return out;

  // The first ring has to clear the scene sitting at the origin.
  let theta = spacing / perRadian;

  for (let i = 1; i < scenes.length; i += 1) {
    if (i > 1) {
      // A full turn always gains more than one scene-width of radius, so the
      // answer is bracketed and bisection cannot run away.
      let low = theta;
      let high = theta + Math.PI * 2;
      for (let step = 0; step < 40; step += 1) {
        const mid = (low + high) / 2;
        if (chord(theta, mid) < spacing) low = mid;
        else high = mid;
      }
      theta = high;
    }

    const point = at(theta);
    out.push(placement(point.x, point.y, 1, Math.sin(theta) * 4));
  }

  return out;
}

function nested(scenes: ArrangeInput[], stage: Size): ScenePlacement[] {
  // The dive. Each scene lives *inside* its predecessor, so advancing pushes
  // the camera deeper into a detail of what the room is already looking at.
  //
  // Depth is capped and then the chain surfaces to a fresh full-size scene
  // alongside: an uncapped dive would reach scales the schema rejects, and the
  // pull-back-and-move-across is a natural place for a new idea to begin.
  const anchors = [
    { dx: 0.26, dy: -0.2 },
    { dx: -0.28, dy: 0.18 },
    { dx: 0.22, dy: 0.24 },
  ];
  const clusterStep = stage.width * 1.9;

  const out: ScenePlacement[] = [];
  let cluster = -1;

  scenes.forEach((_, i) => {
    const depth = i % NEST_DEPTH;
    if (depth === 0) {
      cluster += 1;
      out.push(placement(cluster * clusterStep, 0));
      return;
    }

    const parent = out[i - 1];
    const anchor = anchors[(i - 1) % anchors.length];
    out.push(
      placement(
        parent.x + stage.width * parent.scale * anchor.dx,
        parent.y + stage.height * parent.scale * anchor.dy,
        parent.scale * NEST_RATIO,
        parent.rotation + (depth % 2 === 0 ? 3 : -3),
      ),
    );
  });

  return out;
}

function constellation(scenes: ArrangeInput[], stage: Size): ScenePlacement[] {
  // Sections become clusters on a wide ring, and each cluster's scenes orbit
  // its centre. Crossing into a section is then a real journey to a new part of
  // the world rather than one more step to the right.
  const groups = groupBySection(scenes);
  const out: ScenePlacement[] = new Array(scenes.length);
  const clusterRadius = stage.width * (1.1 + groups.length * 0.45);

  groups.forEach((group, groupIndex) => {
    const angle = (groupIndex / Math.max(1, groups.length)) * Math.PI * 2 - Math.PI / 2;
    const centreX = groups.length === 1 ? 0 : Math.cos(angle) * clusterRadius;
    const centreY = groups.length === 1 ? 0 : Math.sin(angle) * clusterRadius;

    // A ring wide enough that the cluster's own scenes never overlap. The
    // chord between neighbours on a ring of n is 2r·sin(π/n), so solving that
    // for one scene-width is the smallest radius that works — the naive
    // circumference estimate is too tight for a cluster of two or three.
    const spacing = clearance(stage);
    const orbit =
      group.length < 2
        ? 0
        : Math.max(spacing / (2 * Math.sin(Math.PI / group.length)), stage.width * 0.9);

    group.forEach((sceneIndex, i) => {
      if (group.length === 1) {
        out[sceneIndex] = placement(centreX, centreY);
        return;
      }
      const theta = (i / group.length) * Math.PI * 2 - Math.PI / 2;
      out[sceneIndex] = placement(
        centreX + Math.cos(theta) * orbit,
        centreY + Math.sin(theta) * orbit,
        1,
        Math.sin(theta) * 5,
      );
    });
  });

  return out;
}

const PRESETS: Record<ArrangePreset, (scenes: ArrangeInput[], stage: Size) => ScenePlacement[]> = {
  flow,
  reel,
  grid,
  timeline,
  spiral,
  nested,
  constellation,
};

export const ARRANGEMENTS: { id: ArrangePreset; label: string; description: string }[] = [
  {
    id: "flow",
    label: "Flow",
    description: "One page, filled. Reads left to right and back, like a spread.",
  },
  { id: "reel", label: "Reel", description: "A straight line at one zoom — a conventional deck." },
  { id: "grid", label: "Grid", description: "Sections become rows. Good for reference material." },
  {
    id: "timeline",
    label: "Timeline",
    description: "A spine with scenes above and below it, for an argument that builds.",
  },
  {
    id: "spiral",
    label: "Spiral",
    description: "Winds outward. The shape itself reads as widening scope.",
  },
  {
    id: "nested",
    label: "Dive",
    description: "Each scene lives inside the last. Advancing zooms into the detail.",
  },
  {
    id: "constellation",
    label: "Constellation",
    description: "Sections cluster in their own regions of the canvas.",
  },
];

export function arrange(
  preset: ArrangePreset,
  scenes: ArrangeInput[],
  stage: Size,
): ScenePlacement[] {
  if (scenes.length === 0) return [];
  return PRESETS[preset](scenes, stage);
}

/**
 * The placement of every scene: the deck's arrangement, with explicitly placed
 * scenes taking precedence.
 *
 * This is the single source of truth for where a scene is, used by present
 * mode, the journey map and the overview alike — there is no second opinion
 * about the geometry of the world.
 */
export function resolvePlacements(
  scenes: (ArrangeInput & { placement: ScenePlacement | null })[],
  journey: Pick<JourneyConfig, "arrangement">,
  stage: Size,
): ScenePlacement[] {
  const derived = arrange(journey.arrangement, scenes, stage);
  const anyExplicit = scenes.some((scene) => scene.placement !== null);

  const out: ScenePlacement[] = [];
  let previous: ScenePlacement | null = null;

  for (let i = 0; i < scenes.length; i += 1) {
    const explicit = scenes[i].placement;
    if (explicit) {
      out.push(explicit);
      previous = explicit;
      continue;
    }

    // A scene added to a world that has already been arranged by hand should
    // land beside the one before it, at its scale — not back at wherever the
    // preset would have put index 7 of a deck that no longer follows a preset.
    if (anyExplicit && previous) {
      const next = placement(
        previous.x + stage.width * previous.scale * (1 + GAP),
        previous.y,
        previous.scale,
        previous.rotation,
      );
      out.push(next);
      previous = next;
      continue;
    }

    const fallback = derived[i] ?? placement(0, 0);
    out.push(fallback);
    previous = fallback;
  }

  return out;
}
