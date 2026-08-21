import type { ScenePlacement } from "@/lib/schema/presentation";

/**
 * The camera.
 *
 * Captivate presents by moving a camera across one unbounded world, so the
 * quality of that movement *is* the product. A linear tween between two
 * framings looks wrong in a way people feel but cannot name: zoom is
 * multiplicative, so interpolating it linearly rushes the start and crawls the
 * end, and travelling a long distance at close range is a nauseating blur.
 *
 * The path here is the one from Van Wijk & Nuij, "Smooth and efficient zooming
 * and panning" (InfoVis 2003), which solves for the shortest smooth path in
 * (pan, zoom) space. Two properties come out of it for free and are the reason
 * it is worth the algebra:
 *
 *  - The camera pulls back, travels, and pushes in, without anyone specifying
 *    an arc. It falls out of the geometry — the cheapest way to cross a long
 *    distance is to rise above it.
 *  - Path length is measured in perceptual units, so a journey across the world
 *    takes a little longer than a hop next door, not fifty times longer.
 *
 * World units are stage pixels at `scale: 1`.
 */

/** ρ from the paper. 1.42 ≈ √2 trades travel time against how far it climbs. */
const RHO = 1.42;
const RHO2 = RHO * RHO;
const RHO4 = RHO2 * RHO2;

export interface Camera {
  /** World coordinates at the centre of the viewport. */
  x: number;
  y: number;
  /** World units spanned by the viewport's width. Smaller = closer in. */
  width: number;
  /** World rotation the camera is aligned to, in degrees. */
  rotation: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Breathing room left around a framed subject, as a fraction of its size. */
export const FRAME_PADDING = 0.08;

/* -------------------------------------------------------------------------- */
/* Framing                                                                     */
/* -------------------------------------------------------------------------- */

/** The axis-aligned world box a placed scene occupies, rotation included. */
export function sceneWorldRect(placement: ScenePlacement, stage: Size): Rect {
  const w = stage.width * placement.scale;
  const h = stage.height * placement.scale;
  const radians = (placement.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    x: placement.x - (w * cos + h * sin) / 2,
    y: placement.y - (w * sin + h * cos) / 2,
    width: w * cos + h * sin,
    height: w * sin + h * cos,
  };
}

/** The camera that frames one scene, tilted to sit square with it. */
export function frameScene(
  placement: ScenePlacement,
  stage: Size,
  viewportAspect: number,
  padding = FRAME_PADDING,
): Camera {
  // The camera shares the scene's rotation, so the scene is axis-aligned in
  // camera space and its unrotated size is what has to fit.
  const w = stage.width * placement.scale;
  const h = stage.height * placement.scale;
  return {
    x: placement.x,
    y: placement.y,
    width: Math.max(w, h * viewportAspect) * (1 + padding),
    rotation: placement.rotation,
  };
}

/** The camera that frames an arbitrary world box, square to the world. */
export function frameRect(rect: Rect, viewportAspect: number, padding = FRAME_PADDING): Camera {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    width: Math.max(rect.width, rect.height * viewportAspect) * (1 + padding),
    rotation: 0,
  };
}

/** The world box containing every placed scene. */
export function boundsOf(placements: ScenePlacement[], stage: Size): Rect {
  if (placements.length === 0) return { x: 0, y: 0, width: stage.width, height: stage.height };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const placement of placements) {
    const rect = sceneWorldRect(placement, stage);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The world box currently visible to a camera, ignoring rotation. */
export function visibleRect(camera: Camera, viewportAspect: number): Rect {
  const height = camera.width / viewportAspect;
  // Rotation makes the visible region a rotated rectangle; the circumscribing
  // box is what culling needs, and the diagonal bounds it for any angle.
  const spread = camera.rotation === 0 ? 1 : Math.SQRT2;
  const w = camera.width * spread;
  const h = height * spread;
  return { x: camera.x - w / 2, y: camera.y - h / 2, width: w, height: h };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/* -------------------------------------------------------------------------- */
/* Flight                                                                      */
/* -------------------------------------------------------------------------- */

export interface Flight {
  /** Path length in the paper's perceptual units; drives duration. */
  readonly length: number;
  /** Camera at normalised progress `t` in 0..1. */
  at: (t: number) => Camera;
}

/**
 * Interpolate two camera framings along the optimal zoom-and-pan path.
 *
 * Rotation is not part of the paper's model and is simply carried along the
 * same parameter, taking the short way round — a camera that spins 350° to
 * reach a scene tilted −10° would be absurd.
 */
export function flight(from: Camera, to: Camera): Flight {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);

  const w0 = Math.max(from.width, 1e-6);
  const w1 = Math.max(to.width, 1e-6);

  let spin = ((((to.rotation - from.rotation) % 360) + 540) % 360) - 180;
  if (Math.abs(spin - 180) < 1e-9) spin = 180;

  const withRotation = (x: number, y: number, width: number, t: number): Camera => ({
    x,
    y,
    width,
    rotation: from.rotation + spin * t,
  });

  // Pure zoom: the hyperbolic form degenerates when there is no ground to
  // cover, and geometric interpolation is exactly right.
  if (distance < 1e-6) {
    const ratio = w1 / w0;
    const length = Math.abs(Math.log(ratio)) / RHO;
    return {
      length,
      at: (t) => withRotation(to.x, to.y, w0 * Math.pow(ratio, t), t),
    };
  }

  const b0 = (w1 * w1 - w0 * w0 + RHO4 * distance * distance) / (2 * w0 * RHO2 * distance);
  const b1 = (w1 * w1 - w0 * w0 - RHO4 * distance * distance) / (2 * w1 * RHO2 * distance);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const length = (r1 - r0) / RHO;

  // Degenerate geometry (identical framings) would divide by zero below.
  if (!Number.isFinite(length) || Math.abs(length) < 1e-9) {
    return { length: 0, at: (t) => withRotation(from.x + dx * t, from.y + dy * t, w0, t) };
  }

  const coshR0 = Math.cosh(r0);
  const sinhR0 = Math.sinh(r0);

  return {
    length,
    at: (t) => {
      const s = t * length;
      const along = (w0 / (RHO2 * distance)) * (coshR0 * Math.tanh(RHO * s + r0) - sinhR0);
      return withRotation(
        from.x + dx * along,
        from.y + dy * along,
        (w0 * coshR0) / Math.cosh(RHO * s + r0),
        t,
      );
    },
  };
}

/**
 * A hop between neighbouring scenes in a reel, used to calibrate `pace` so a
 * presentation's configured seconds-per-move means something concrete.
 */
const REFERENCE_LENGTH = flight(
  { x: 0, y: 0, width: 1000, rotation: 0 },
  { x: 1250, y: 0, width: 1000, rotation: 0 },
).length;

/** Seconds a flight should take, given the deck's configured pace. */
export function flightDuration(length: number, pace: number): number {
  if (length <= 1e-9) return 0;
  const scaled = (length / REFERENCE_LENGTH) * pace;
  return Math.min(pace * 2.4, Math.max(pace * 0.45, scaled));
}

/**
 * Eases the *parameter*, not the path.
 *
 * The path already handles how far the camera travels; this only stops it
 * starting and stopping abruptly. A symmetric ease is right here — the flight
 * should settle, not arrive.
 */
export function easeFlight(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 4 * clamped * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

/** Screen pixels per world unit. */
export function cameraScale(camera: Camera, viewport: Size): number {
  return viewport.width / Math.max(camera.width, 1e-6);
}

/**
 * The transform that puts the world under a camera.
 *
 * Written as a single string and applied to one element, so a camera move is
 * one composited transform rather than a re-layout of everything on the canvas.
 */
export function worldTransform(camera: Camera, viewport: Size): string {
  const scale = cameraScale(camera, viewport);
  return [
    `translate(${viewport.width / 2}px, ${viewport.height / 2}px)`,
    `rotate(${-camera.rotation}deg)`,
    `scale(${scale})`,
    `translate(${-camera.x}px, ${-camera.y}px)`,
  ].join(" ");
}

/**
 * The transform for a backdrop that sits behind the world.
 *
 * Parallax is the cheapest depth cue there is, and depth is what stops a
 * camera move reading as a cross-fade between two flat pictures. The backdrop
 * takes a damped share of the camera's translation and a fractional power of
 * its zoom, so it drifts rather than tracks.
 */
export function backdropTransform(camera: Camera, viewport: Size, depth: number): string {
  if (depth <= 0) return "none";
  const scale = Math.pow(cameraScale(camera, viewport), depth);
  return [
    `translate(${viewport.width / 2}px, ${viewport.height / 2}px)`,
    `rotate(${-camera.rotation * depth}deg)`,
    `scale(${scale})`,
    `translate(${-camera.x * depth}px, ${-camera.y * depth}px)`,
  ].join(" ");
}

export function camerasEqual(a: Camera, b: Camera, epsilon = 1e-4): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.rotation - b.rotation) < epsilon
  );
}
