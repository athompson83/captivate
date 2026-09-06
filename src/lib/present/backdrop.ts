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
 * How many viewports wide the picture's *layer* is, whatever the plane's size.
 *
 * The plane is measured in world units, and a world is large: eleven scenes
 * on a phone put the plane at 18,510 x 40,119 — and the layer was laid out at
 * exactly that, in CSS pixels, with `will-change: transform` on it. That asks
 * the compositor for a texture of 743 megapixels, about 2.9 GB, for a picture
 * the size of a phone screen. A browser given that either tiles it at ruinous
 * cost or loses the tab; on iOS it loses the tab, which is what "the browser
 * keeps crashing" looks like from the other side of the screen.
 *
 * So the layer's size is a *raster* decision and has nothing to do with the
 * plane: two viewports across, which is sharp at the framings a presentation
 * actually uses and costs four viewports of texture — six megabytes on a
 * phone rather than three gigabytes. `backdropTransform` scales it back up to
 * the plane's projected size, so what reaches the screen is unchanged.
 */
const RASTER_VIEWPORTS = 2;

/**
 * The size to lay the picture's layer out at, in CSS pixels.
 *
 * Shares the viewport's aspect, so one scale factor relates it to the plane on
 * both axes.
 */
export function backdropLayer(viewport: Size): Size {
  return {
    width: Math.max(1, viewport.width) * RASTER_VIEWPORTS,
    height: Math.max(1, viewport.height) * RASTER_VIEWPORTS,
  };
}

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
 * `worldTransform` with two changes. The scale divides by the camera's width
 * *plus* the plane's depth, which is the whole of the parallax. And the
 * element it is written to is `backdropLayer`-sized rather than plane-sized
 * (see `RASTER_VIEWPORTS`), so the plane's size enters as a ratio: the scale
 * is multiplied by it and the translation divided by it, which lands the same
 * pixels on the screen from a layer the browser can actually hold.
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
  // World units per layer pixel. The layer shares the viewport's aspect and
  // so does the plane, so one ratio serves both axes.
  const perPixel = plane.width / Math.max(backdropLayer(viewport).width, 1e-6);
  return [
    `translate(${viewport.width / 2}px, ${viewport.height / 2}px)`,
    `rotate(${-camera.rotation}deg)`,
    `scale(${scale * perPixel})`,
    `translate(${(plane.x - camera.x) / perPixel}px, ${(plane.y - camera.y) / perPixel}px)`,
  ].join(" ");
}
