import type { Camera, Rect, Size } from "./camera";
import { FRAME_PADDING } from "./camera";

/**
 * A picture behind the whole presentation, at a distance.
 *
 * The atmosphere's depth layers are the content plane seen by a camera some
 * scene-widths further back, and a backdrop is the same idea with a
 * photograph on it: a flight slides it slower than the scenes and a zoom
 * grows it less, which is what makes a still image read as a room the
 * presentation is standing in rather than wallpaper behind it. At rest it is
 * perfectly still — the picture is the setting, and a setting that moves while
 * someone is speaking is a distraction, not depth.
 *
 * Everything here is pure and runs once per frame from the camera loop, for
 * the same reason the camera itself does: sixty transform writes a second and
 * none of them through React.
 */

/** Overscan past the widest framing, so a pan near the edge shows no rim. */
const OVERSCAN = 1.12;

/**
 * How far behind the content the plane sits, in scene widths.
 *
 * `distance` is the author's 0–1 setting. Zero is just behind the scenes,
 * where a flight moves the picture almost as much as the content; one is far
 * enough that the picture barely stirs. The middle reads as a wall a few
 * metres behind a stage.
 */
export function backdropDepth(distance: number): number {
  const clamped = Math.min(1, Math.max(0, distance));
  return 1.5 + clamped * 8.5;
}

/**
 * The plane the picture is painted on, in world units.
 *
 * Sized so the viewport is still covered at the widest framing the camera can
 * take — the whole world, padded the way `frameRect` pads it — and anchored
 * on the world's centre. Nothing here depends on the camera, so it is computed
 * once per document and not per frame.
 */
export function backdropPlane(
  bounds: Rect,
  stage: Size,
  viewportAspect: number,
  distance: number,
): Rect {
  const aspect = viewportAspect > 0 ? viewportAspect : stage.width / stage.height;
  const widest = Math.max(bounds.width, bounds.height * aspect) * (1 + FRAME_PADDING);
  const width = (widest + backdropDepth(distance) * stage.width) * OVERSCAN;
  const height = width / aspect;
  return {
    x: bounds.x + bounds.width / 2 - width / 2,
    y: bounds.y + bounds.height / 2 - height / 2,
    width,
    height,
  };
}

/**
 * The CSS transform that puts the plane under a camera.
 *
 * `worldTransform` with one change: the scale divides by the camera's width
 * *plus* the plane's depth, which is the whole of the parallax. The element it
 * is written to has the plane's world size and its transform origin at the
 * top-left, like the world itself.
 */
export function backdropTransform(
  camera: Camera,
  viewport: Size,
  plane: Rect,
  stage: Size,
  distance: number,
): string {
  const scale =
    viewport.width / Math.max(camera.width + backdropDepth(distance) * stage.width, 1e-6);
  return [
    `translate(${viewport.width / 2}px, ${viewport.height / 2}px)`,
    `rotate(${-camera.rotation}deg)`,
    `scale(${scale})`,
    `translate(${plane.x - camera.x}px, ${plane.y - camera.y}px)`,
  ].join(" ");
}
