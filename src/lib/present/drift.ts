/**
 * A picture that lives.
 *
 * A photograph on a scene arrived and then stood there, and a still picture
 * on a screen is read once and looked past. Now, while its scene is being
 * performed, a photograph closes in — a slow drift toward the point the
 * author marked, six percent over half a minute — or pans across, which is
 * the difference between a slide and a shot. Nothing about it is fast enough
 * to be seen moving; it is seen to have moved.
 *
 * Pure: the transform a picture is heading for and how long it takes. The
 * renderer writes it as a CSS transition so the compositor carries the motion
 * and a departure comes back from wherever the picture had got to, rather
 * than from a keyframe's idea of where it should be. The drift starts from
 * the identity, so a landing never jumps; it is undone in a second and a
 * half, over the flight away. The renderer gives every picture one frame at
 * rest before applying it, because a transition set as an element's first
 * style never runs — a picture built on an advance mounts mid-performance.
 */

/** How far a picture closes in, as a scale. */
export const DRIFT_SCALE = 1.06;
/** How long the drift takes. Longer than most scenes are held, so it never stops on stage. */
export const DRIFT_MS = 26_000;
/** How long the picture takes to come back once its scene is left. */
export const DRIFT_RETURN_MS = 1_400;
/** How far a pan crosses, as a fraction of the picture's width. */
export const PAN_FRACTION = 0.012;

export type DriftKind = "in" | "pan";

export interface DriftStyle {
  transform: string;
  transformOrigin: string;
  transition: string;
}

/**
 * Which way a picture drifts: half close in, half pan, by the element's id
 * rather than at random, so a recording and a rehearsal show the same shot.
 */
export function driftKind(id: string): DriftKind {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return (hash & 1) === 0 ? "in" : "pan";
}

/**
 * The style for a picture, performing or not.
 *
 * The origin is the author's focal point, so closing in is closing in on the
 * thing the picture is of. A pan goes toward the side the scale has made
 * room on: scaling about a point near the left edge opens no margin there,
 * and a pan the other way would show the picture's edge.
 */
export function pictureDrift(
  picture: { id: string; focalX: number; focalY: number },
  performing: boolean,
): DriftStyle {
  const origin = `${(picture.focalX * 100).toFixed(1)}% ${(picture.focalY * 100).toFixed(1)}%`;
  if (!performing) {
    return {
      transform: "none",
      transformOrigin: origin,
      transition: `transform ${DRIFT_RETURN_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
    };
  }
  const kind = driftKind(picture.id);
  const pan =
    kind === "pan"
      ? ` translateX(${(picture.focalX >= 0.5 ? PAN_FRACTION : -PAN_FRACTION) * 100}%)`
      : "";
  return {
    transform: `scale(${DRIFT_SCALE})${pan}`,
    transformOrigin: origin,
    transition: `transform ${DRIFT_MS}ms linear`,
  };
}
