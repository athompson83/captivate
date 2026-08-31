/**
 * The landing hero's world, without a renderer.
 *
 * The hero is the product's own thesis rendered literally: scenes are regions
 * of one continuous space and presenting is a camera travelling between them.
 * That means the interesting part is a flight path, and a flight path is
 * arithmetic — so it lives here, where it can be tested, rather than inside a
 * component that needs a GPU to say anything at all.
 *
 * Every length is in world units. The renderer decides how many pixels one
 * unit is; nothing here knows about pixels, three, or the DOM.
 */

/** What a scene in the hero is showing. Decides how its texture is drawn. */
export type HeroSceneKind = "title" | "bullets" | "chart" | "quote" | "media" | "detail";

export interface HeroScene {
  id: string;
  kind: HeroSceneKind;
  /** Centre, in world units. `z` is depth: negative is further away. */
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
}

/**
 * Six scenes and an aside.
 *
 * Deliberately not a grid. A grid reads as a slide sorter, which is the one
 * thing this picture must not look like — the scenes are placed the way an
 * argument sprawls, at different depths so travelling between them has
 * parallax rather than only scale.
 */
export const HERO_SCENES: readonly HeroScene[] = [
  { id: "open", kind: "title", x: -6.1, y: 1.6, z: 0.4, width: 5.2, height: 3.0 },
  { id: "claim", kind: "bullets", x: 0.4, y: 2.9, z: -0.9, width: 4.0, height: 2.4 },
  { id: "evidence", kind: "chart", x: 5.9, y: 1.1, z: 0.2, width: 4.4, height: 2.7 },
  // The aside: a small scene tucked beside its parent, which is what a dive
  // into a detail looks like from outside.
  { id: "aside", kind: "detail", x: 8.0, y: -1.0, z: 1.5, width: 1.5, height: 0.95 },
  { id: "turn", kind: "quote", x: -3.4, y: -2.5, z: -0.5, width: 4.6, height: 2.6 },
  { id: "close", kind: "media", x: 2.9, y: -2.9, z: 0.6, width: 5.0, height: 3.1 },
] as const;

/** The order the camera visits them in. The last leg returns to the first. */
export const HERO_FLIGHT: readonly string[] = [
  "open",
  "claim",
  "evidence",
  "aside",
  "turn",
  "close",
] as const;

/** Milliseconds held still on a scene before the next leg begins. */
export const HOLD_MS = 1_500;
/** Milliseconds spent travelling between two scenes. */
export const TRAVEL_MS = 1_900;
/** One full circuit of the argument. */
export const LOOP_MS = HERO_FLIGHT.length * (HOLD_MS + TRAVEL_MS);

/**
 * The stage easing, as a function.
 *
 * Matches `--ease-in-out-quart` in `globals.css`: the camera leaves slowly,
 * covers the distance, and arrives slowly. A linear flight reads as a machine
 * panning; this reads as attention moving.
 */
export function easeInOutQuart(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5
    ? 8 * clamped * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 4) / 2;
}

export interface HeroCamera {
  x: number;
  y: number;
  z: number;
}

/**
 * How far back the camera sits to frame one scene.
 *
 * Framed on whichever of width and height is the binding constraint for this
 * viewport, so a narrow phone pulls back far enough to hold the scene's width
 * rather than cropping it — the same fit-to-container arithmetic `Stage` does,
 * in perspective.
 */
export function framingDistance(
  scene: HeroScene,
  aspect: number,
  verticalFovDegrees: number,
  margin = FRAME_MARGIN,
): number {
  const fov = (verticalFovDegrees * Math.PI) / 180;
  const halfHeight = (scene.height * margin) / 2;
  const halfWidth = (scene.width * margin) / 2;
  const forHeight = halfHeight / Math.tan(fov / 2);
  const forWidth = halfWidth / (Math.tan(fov / 2) * Math.max(aspect, 0.2));
  return Math.max(forHeight, forWidth);
}

/**
 * How much room around the scene being visited.
 *
 * Generous, and that is the whole point. Framed tightly, each waypoint fills
 * the view with one abstract card and the hero becomes a slideshow of
 * rectangles — precisely the thing being argued against. At this margin the
 * neighbours stay in frame the whole way, so what the visitor sees is a camera
 * moving over one continuous surface rather than cutting between pictures.
 */
export const FRAME_MARGIN = 3.6;

function sceneById(id: string): HeroScene {
  const scene = HERO_SCENES.find((candidate) => candidate.id === id);
  if (!scene) throw new Error(`hero flight names an unknown scene: ${id}`);
  return scene;
}

/** Where the camera rests while a scene is being looked at. */
export function restingAt(scene: HeroScene, aspect: number, fovDegrees: number): HeroCamera {
  return { x: scene.x, y: scene.y, z: scene.z + framingDistance(scene, aspect, fovDegrees) };
}

/**
 * The camera at a moment in the loop.
 *
 * Time is taken modulo the loop, so the caller passes elapsed milliseconds and
 * never has to think about wrapping — and the position at `LOOP_MS` is exactly
 * the position at zero, which is what makes the loop invisible.
 */
export function cameraAt(elapsedMs: number, aspect: number, fovDegrees: number): HeroCamera {
  const legMs = HOLD_MS + TRAVEL_MS;
  const wrapped = ((elapsedMs % LOOP_MS) + LOOP_MS) % LOOP_MS;
  const leg = Math.floor(wrapped / legMs);
  const withinLeg = wrapped - leg * legMs;

  const from = restingAt(sceneById(HERO_FLIGHT[leg]), aspect, fovDegrees);
  if (withinLeg <= HOLD_MS) return from;

  const to = restingAt(sceneById(HERO_FLIGHT[(leg + 1) % HERO_FLIGHT.length]), aspect, fovDegrees);
  const t = easeInOutQuart((withinLeg - HOLD_MS) / TRAVEL_MS);

  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
  };
}

/**
 * A still framing that holds the whole argument at once.
 *
 * What the hero shows when the visitor has asked for reduced motion. It is not
 * a frozen frame of the flight — a frame of a flight is one scene filling the
 * view, which says nothing — but the wide shot the flight is travelling
 * around, which is the same claim made without moving.
 */
export function wideShot(aspect: number, fovDegrees: number): HeroCamera {
  const minX = Math.min(...HERO_SCENES.map((s) => s.x - s.width / 2));
  const maxX = Math.max(...HERO_SCENES.map((s) => s.x + s.width / 2));
  const minY = Math.min(...HERO_SCENES.map((s) => s.y - s.height / 2));
  const maxY = Math.max(...HERO_SCENES.map((s) => s.y + s.height / 2));
  const bounds: HeroScene = {
    id: "all",
    kind: "title",
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: 0,
    width: maxX - minX,
    height: maxY - minY,
  };
  return { x: bounds.x, y: bounds.y, z: framingDistance(bounds, aspect, fovDegrees, 1.08) };
}

/** The dotted line drawn through the scenes, in visiting order. */
export function flightPath(): HeroCamera[] {
  return HERO_FLIGHT.map((id) => {
    const scene = sceneById(id);
    return { x: scene.x, y: scene.y, z: scene.z };
  });
}
