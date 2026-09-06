import type { SceneElement, ScenePlacement } from "@/lib/schema/presentation";
import type { Camera, Size } from "./camera";

/**
 * Depth inside a scene.
 *
 * Everything behind a scene already has it — the backdrop on its plane, the
 * atmosphere's motes at three distances — and the scene itself was flat: a
 * picture and the words over it moved as one sheet. Now the words sit a
 * little nearer than the surface and the pictures a little farther, and as
 * the camera departs or arrives they slide against each other by an amount
 * proportional to how far the camera is from the scene's centre. On a scene,
 * where the camera is centred, the offset is exactly zero, so nothing is ever
 * misregistered while it is being read; it shows only in the motion.
 *
 * Pure: how far a region's layers are offset for a given camera, in the
 * region's own stage pixels. The world writes the result as two custom
 * properties per region once a frame, and each element's wrapper multiplies
 * them by its depth in CSS — so sixty elements cost two style writes, and the
 * compositor does the rest.
 */

/** How much of the camera's offset a layer at unit depth takes. */
export const PARALLAX_STRENGTH = 0.06;
/** Ceiling as a fraction of the stage width: far scenes must not scatter. */
export const PARALLAX_MAX = 0.03;

export interface ParallaxOffset {
  x: number;
  y: number;
}

/**
 * The offset for a region, in its stage pixels, for a camera in world units.
 *
 * Positive along the camera's own offset: a layer with positive depth (far)
 * drifts with the camera, a layer with negative depth (near) against it —
 * which is what each does relative to the surface between them.
 */
export function regionParallax(
  camera: Camera,
  placement: ScenePlacement,
  stage: Size,
): ParallaxOffset {
  const dx = (camera.x - placement.x) / placement.scale;
  const dy = (camera.y - placement.y) / placement.scale;
  // Into the region's own frame, if it is turned.
  const rad = (-placement.rotation * Math.PI) / 180;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
  const max = stage.width * PARALLAX_MAX;
  return {
    x: Math.max(-max, Math.min(max, rx * PARALLAX_STRENGTH)),
    y: Math.max(-max, Math.min(max, ry * PARALLAX_STRENGTH)),
  };
}

/**
 * Where each kind of element sits: negative is nearer than the surface,
 * positive farther, zero on it. Words come forward, pictures go back — the
 * order a room reads a scene in, made spatial.
 */
export function elementDepth(type: SceneElement["type"]): number {
  switch (type) {
    case "heading":
    case "text":
    case "quote":
    case "list":
    case "callout":
    case "code":
      return -1;
    case "image":
    case "video":
    case "embed":
    case "drawing":
    case "chart":
      return 0.8;
    case "icon":
    case "shape":
      return 0.4;
    default:
      return 0;
  }
}
