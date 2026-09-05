import type { Camera } from "./camera";

/**
 * The room answers the hand.
 *
 * Everything behind a scene has depth — the backdrop on its plane, the
 * atmosphere's motes at three distances — and a flight is when that depth
 * shows. Between flights a visitor with a mouse over the world saw a still
 * picture, and the one thing 3D practice agrees on is that depth is believed
 * when it answers the viewer: move, and the far things move less than the
 * near ones. Here the near thing is the scene, which stays exactly where it
 * is — a scene being read is never misregistered — and the room behind it
 * follows the hand a little, the way the view through a window shifts when
 * you lean.
 *
 * Pure. The world reads the pointer in its own frame loop, eases the lean
 * toward where the hand is, and hands the leaned camera to the layers that
 * are the room: the backdrop and the air. Never the content, never through
 * React, never on a touch screen (a finger on the stage is a swipe), and
 * never under a reduced-motion preference.
 */

/** How far the room leans at the edge of the viewport, as a fraction of the camera's width. */
export const LEAN_STRENGTH = 0.02;
/** Seconds for the lean to close most of the distance to where the hand is. */
export const LEAN_TAU = 0.18;
/** Below this, in unit lean, the room counts as at rest and the loop stops. */
export const LEAN_REST = 0.002;

export interface Lean {
  /** −1 at the left edge of the viewport, +1 at the right, 0 at the centre. */
  x: number;
  /** −1 at the top, +1 at the bottom. */
  y: number;
}

export const LEVEL: Lean = { x: 0, y: 0 };

/**
 * Where the hand is, as a unit lean. A pointer outside the box — a
 * `pointerleave` fired with the last known position, a fast exit — clamps to
 * the edge rather than leaning the room past it.
 */
export function pointerLean(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): Lean {
  if (rect.width <= 0 || rect.height <= 0) return LEVEL;
  const x = ((clientX - rect.left) / rect.width - 0.5) * 2;
  const y = ((clientY - rect.top) / rect.height - 0.5) * 2;
  return { x: clamp(x), y: clamp(y) };
}

/** A lean never goes past the edge of the viewport. */
function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/**
 * Eases the lean toward its target by `dtSeconds`.
 *
 * An exponential approach rather than a fixed fraction per frame, so the
 * motion is the same at 30 and 120 frames a second: the distance closes by a
 * factor of e every `tau` seconds. Snaps to the target once within rest so
 * the loop can stop and the room lands exactly where the hand is.
 */
export function approachLean(current: Lean, target: Lean, dtSeconds: number, tau = LEAN_TAU): Lean {
  const k = 1 - Math.exp(-Math.max(0, dtSeconds) / tau);
  const x = current.x + (target.x - current.x) * k;
  const y = current.y + (target.y - current.y) * k;
  return Math.abs(target.x - x) < LEAN_REST && Math.abs(target.y - y) < LEAN_REST
    ? { x: target.x, y: target.y }
    : { x, y };
}

/** Whether the lean has arrived where it was going. */
export function isSettled(current: Lean, target: Lean): boolean {
  return current.x === target.x && current.y === target.y;
}

/**
 * The camera the room is seen from.
 *
 * The room follows the hand: lean right and what is behind the scene shifts
 * right, which is what the far side of a window does relative to its frame
 * when you move your head. So the camera moves the *other* way, by a
 * fraction of its own width — a lean is the same size at any zoom — and the
 * vertical lean is scaled by the viewport's aspect so an edge is an edge in
 * both directions. The screen-space offset is rotated into the world so a
 * turned camera still leans left and right as the room sees it.
 */
export function leanCamera(
  camera: Camera,
  lean: Lean,
  viewportAspect: number,
  strength = LEAN_STRENGTH,
): Camera {
  if (lean.x === 0 && lean.y === 0) return camera;
  const aspect = viewportAspect > 0 ? viewportAspect : 16 / 9;
  const sx = -lean.x * strength * camera.width;
  const sy = (-lean.y * strength * camera.width) / aspect;
  const radians = (camera.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    ...camera,
    x: camera.x + sx * cos - sy * sin,
    y: camera.y + sx * sin + sy * cos,
  };
}
