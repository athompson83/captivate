import { useEffect, useState } from "react";

/**
 * The opening beat.
 *
 * A show opens wide: the camera sits over the whole argument with the route
 * drawn, holds for a beat, and dives to the first scene. It is the second half
 * of the one move the room did ask for — starting the show — and it does for
 * the whole presentation what establishing does for a section: shows the shape
 * of the thing before its content. The closing image is the same camera
 * position, so a presentation opens and closes on the whole of itself.
 *
 * Any command ends the beat at once, landing on the first scene rather than
 * stepping past it, so a presenter who starts talking is never held.
 */

/** How long the camera holds over the whole argument before the dive. */
export const OPENING_MS = 1800;

/**
 * Whether the viewer has asked for reduced motion.
 *
 * Read at the moment the beat is scheduled rather than at first render: the
 * initial state has to be the same on the server and on the client, and a
 * hold followed by a cut is a flash, not a beat, so a reduced-motion viewer
 * lands on the first scene straight away.
 */
export function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** A show with one scene has nothing wide to show. */
export function opensWide(sceneCount: number): boolean {
  return sceneCount > 1;
}

/**
 * The beat as local state, for the self-driven viewers.
 *
 * `opening` is true while the camera holds; `settle` ends it early. The timer
 * is owned by the effect so that ending early — from a key, a click, a
 * button — tears it down through the effect's cleanup rather than a ref.
 */
export function useOpening(sceneCount: number): { opening: boolean; settle: () => void } {
  const [opening, setOpening] = useState(opensWide(sceneCount));

  useEffect(() => {
    if (!opening) return;
    const timer = setTimeout(() => setOpening(false), reducedMotion() ? 0 : OPENING_MS);
    return () => clearTimeout(timer);
  }, [opening]);

  return { opening, settle: () => setOpening(false) };
}
