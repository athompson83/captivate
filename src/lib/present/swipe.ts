import { useRef, useSyncExternalStore } from "react";

/**
 * Moving through a presentation by hand.
 *
 * A share link is opened on a phone more often than anywhere else, and a
 * phone has no arrow keys. A horizontal swipe is the move a hand makes
 * without being told: left for on, right for back — the same two moves as
 * the click zones, which stay. The stage takes the same gesture on a tablet.
 *
 * The recogniser is deliberately strict. A swipe is a short, mostly
 * horizontal journey; a slow drag or a diagonal one is a scroll or a
 * hesitation and does nothing, so the page never moves under a reader who
 * was only steadying their thumb.
 */

/** How far a pointer must travel, in CSS pixels, to count as a swipe. */
export const SWIPE_MIN_PX = 48;
/** Any longer than this and it is a drag, not a swipe. */
export const SWIPE_MAX_MS = 700;
/** Horizontal travel must exceed vertical by this factor. */
export const SWIPE_RATIO = 2;

export type SwipeDirection = "left" | "right";

export interface PointerSample {
  x: number;
  y: number;
  /** Milliseconds, on any clock shared by both samples. */
  t: number;
}

/** Whether a pointer journey was a swipe, and which way. Pure. */
export function swipeOf(start: PointerSample, end: PointerSample): SwipeDirection | null {
  if (end.t - start.t > SWIPE_MAX_MS) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < SWIPE_MIN_PX) return null;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return null;
  return dx < 0 ? "left" : "right";
}

/**
 * Whether a click landed on a control of its own — a hotspot, a link — rather
 * than on the open stage. Such a click is the control's, and the surface must
 * not also read it as an advance: a tap on a hotspot used to dive *and* step
 * on, and inside the aside the step was the way straight back out.
 */
export function isControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, a") !== null;
}

interface Tracked extends PointerSample {
  id: number;
}

export interface SwipeHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  /**
   * True exactly once after a swipe, for the click that may follow it. A
   * browser can synthesise a click at the end of a short touch, and a surface
   * that advanced on the swipe must not advance again on the click.
   */
  consume: () => boolean;
}

/** Pointer handlers for a surface that moves on a swipe. */
export function useSwipe(onSwipe: (direction: SwipeDirection) => void): SwipeHandlers {
  const tracked = useRef<Tracked | null>(null);
  const swiped = useRef(false);

  return {
    onPointerDown: (e) => {
      // Only the primary button of a mouse; any touch or pen.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // A new journey. Whatever the last one was, the click that ends this
      // one is this one's: a swipe's click never arrived, so a tap that came
      // after it must not be swallowed in its place.
      swiped.current = false;
      tracked.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
    },
    onPointerUp: (e) => {
      const start = tracked.current;
      if (!start || start.id !== e.pointerId) return;
      tracked.current = null;
      const direction = swipeOf(start, { x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (!direction) return;
      swiped.current = true;
      onSwipe(direction);
    },
    onPointerCancel: () => {
      tracked.current = null;
    },
    consume: () => {
      const was = swiped.current;
      swiped.current = false;
      return was;
    },
  };
}

const COARSE = "(pointer: coarse)";

function subscribeCoarse(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(COARSE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const readCoarse = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(COARSE).matches;

/**
 * Whether the primary pointer is a finger, so an invitation can say "swipe"
 * to a hand and "press →" to a keyboard. False on the server, and read as an
 * external store so the first client render agrees with it.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribeCoarse, readCoarse, () => false);
}
