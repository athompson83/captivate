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
 * The veil over the picture, by how close the camera is.
 *
 * A picture behind the whole show is the room the show stands in, and a room
 * is seen whole when the camera pulls back: from the overview, or while a
 * section is being established, the picture should be there at its full
 * strength. On a scene it is a wall behind words, and words over a
 * photograph need the photograph quieter — so the author's `dim` is the
 * veil *on a scene*, and it lifts as the camera widens. Between the two it
 * eases, so a flight out of a scene lets the room come up rather than
 * switching it on.
 *
 * Measured against the focused scene's own framing, not the stage: a scene
 * an author enlarged in the journey map is framed wider and is still a scene
 * with words on it. The band's far edge is wherever the camera is going when
 * it pulls back — a section's framing, the world's — so a section of two
 * scenes is unveiled when the camera lands on it; and while the focus is a
 * scene, a few scene framings out, or the whole world's framing where that
 * comes sooner, so a flight between two scenes lets the room up a little on
 * the way. Pure, and written from the camera loop each frame like the
 * transform beside it.
 */

/** Slack over the scene's own framing before the veil begins to lift. */
export const VEIL_NEAR = 1.25;
/** Scene framings out at which the veil is gone, with no nearer destination. */
export const VEIL_FAR = 3.5;

export interface VeilBand {
  /** The camera width at and below which the veil is full. */
  near: number;
  /** The camera width at and past which the veil is gone. */
  far: number;
}

/**
 * The band the veil eases over.
 *
 * `destination` is the framing the camera is pulling back to when the focus
 * is not a scene, and null while it is one. Never narrower than a little
 * past `near`, so a deck of one scene — whose world is its scene — keeps its
 * veil rather than dividing by nothing.
 */
export function veilBand(
  sceneFraming: number,
  destination: number | null,
  worldFraming: number,
): VeilBand {
  const near = sceneFraming * VEIL_NEAR;
  const far = destination === null ? Math.min(worldFraming, sceneFraming * VEIL_FAR) : destination;
  return { near, far: Math.max(near * 1.15, far) };
}

export function backdropVeil(cameraWidth: number, band: VeilBand, dim: number): number {
  if (!(dim > 0) || !(band.near > 0)) return 0;
  const t = Math.min(1, Math.max(0, (cameraWidth - band.near) / (band.far - band.near)));
  const eased = t * t * (3 - 2 * t);
  return Math.round(dim * (1 - eased) * 1000) / 1000;
}

/**
 * How far past each edge of the viewport the drawn backdrop's layer reaches,
 * as a fraction of the viewport.
 *
 * The layer has to be wider than the screen or the parallax shift below brings
 * its edge into frame. **It is sized in CSS — `absolute inset-[-20%]` — and
 * this constant only mirrors that for the clamp.** Sizing it in JavaScript
 * from the measured viewport is what made the live demo mount to a blank
 * page: the world measures its own box with a `ResizeObserver` to drive the
 * camera, a layer sized from that measurement changed the box, and the two
 * chased each other until React gave up with "maximum update depth exceeded".
 * A size expressed as a percentage of the containing block needs no
 * measurement and cannot join that loop.
 */
export const DRAWN_MARGIN = 0.2;

/**
 * The drawn backdrop's transform, which translates and never scales.
 *
 * A photograph on the plane can be scaled all day: it is one raster and the
 * compositor resamples it. A drawn backdrop is a *paint* — several radial
 * gradients across a layer bigger than the screen — and a transform whose
 * scale changes every frame, which is exactly what a flight produces, makes
 * the browser re-rasterise that paint on every one of those frames.
 *
 * Translation alone keeps the depth that matters. Parallax is read from things
 * moving at different rates across the screen, not from the far plane growing
 * under a zoom — and an abstract wash has no detail whose growth the eye could
 * measure anyway. The shift is the camera's distance from the world's centre
 * at the plane's own scale, which is smaller than the content's by the depth,
 * so the room moves slower than the scenes and holds still while the camera
 * does. Rotation is dropped for the same reason and costs nothing: there is no
 * horizon in a wash to keep level.
 *
 * The layer is already centred by its own negative inset, so this is the shift
 * and nothing else, clamped so an edge never arrives.
 */
export function drawnBackdropTransform(
  camera: Camera,
  viewport: Size,
  plane: Rect,
  stage: Size,
  distance: number,
): string {
  const scale =
    viewport.width / Math.max(camera.width + backdropDepth(distance) * stage.width, 1e-6);
  const marginX = viewport.width * DRAWN_MARGIN;
  const marginY = viewport.height * DRAWN_MARGIN;
  // The plane is already anchored on the world's centre.
  const centreX = plane.x + plane.width / 2;
  const centreY = plane.y + plane.height / 2;
  const dx = Math.max(-marginX, Math.min(marginX, (centreX - camera.x) * scale));
  const dy = Math.max(-marginY, Math.min(marginY, (centreY - camera.y) * scale));
  return `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
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
