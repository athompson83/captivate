"use client";

import { useCallback, useRef } from "react";

/**
 * Swipe, on a stage that already answers to taps.
 *
 * A phone holding a share link is the device most people actually read a deck
 * on, and a phone's first instinct is to swipe. Until now the only touch move
 * was the clicker convention — tap the right two-thirds to go on, the left
 * third to go back — which nobody discovers unaided. Swiping left goes on and
 * swiping right goes back, the way every carousel has taught a thumb to
 * expect; the taps still work exactly as before.
 *
 * Only horizontal, deliberate movement counts. A vertical drag is a scroll —
 * on the landing page the stage sits in a page that scrolls, and a demo that
 * swallowed scrolling would be a demo nobody got past. A short drag is a tap
 * with a wobble, and is left for the click handler.
 *
 * Touch only. A mouse drag on the stage is the presenter's laser or ink, and
 * a trackpad has arrow keys.
 */

/** Distance, in CSS pixels, a finger has to travel before it is a swipe. */
export const SWIPE_DISTANCE = 48;

/** How much more horizontal than vertical the travel has to be. */
const SWIPE_DOMINANCE = 1.5;

export type Swipe = "forward" | "back";

/**
 * What a completed finger movement meant, or nothing.
 *
 * A left swipe — the content pushed leftwards, the finger travelling to
 * smaller x — moves forward.
 */
export function classifySwipe(dx: number, dy: number, distance = SWIPE_DISTANCE): Swipe | null {
  if (Math.abs(dx) < distance) return null;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_DOMINANCE) return null;
  return dx < 0 ? "forward" : "back";
}

export interface SwipeHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
  /**
   * Whether the pointer sequence that just ended was a swipe. A click handler
   * on the same element asks this first, so a swipe that the browser also
   * reports as a click is not counted twice.
   */
  consumeSwipe: () => boolean;
}

/**
 * Pointer handlers that turn a touch swipe into `forward` or `back`.
 *
 * The element should also carry `touch-action: pan-y`, so a horizontal drag
 * reaches these handlers instead of being taken by the browser as a scroll
 * attempt, while vertical drags keep scrolling the page.
 */
export function useSwipe(onSwipe: (swipe: Swipe) => void): SwipeHandlers {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    swiped.current = false;
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const from = start.current;
      start.current = null;
      if (!from || from.id !== e.pointerId) return;
      const swipe = classifySwipe(e.clientX - from.x, e.clientY - from.y);
      if (!swipe) return;
      swiped.current = true;
      onSwipe(swipe);
    },
    [onSwipe],
  );

  const onPointerCancel = useCallback(() => {
    start.current = null;
  }, []);

  const consumeSwipe = useCallback(() => {
    const was = swiped.current;
    swiped.current = false;
    return was;
  }, []);

  return { onPointerDown, onPointerUp, onPointerCancel, consumeSwipe };
}
