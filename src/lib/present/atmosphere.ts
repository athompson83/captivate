import type { ScenePlacement } from "@/lib/schema/presentation";
import type { Palette } from "./ambient";
import type { Camera, Size } from "./camera";
import { cameraScale } from "./camera";

/**
 * The air, prepared for the GPU.
 *
 * `ambientAt` answers "what colour is the room" with a single colour for the
 * whole screen. That is the right answer for a CSS wash and the wrong answer
 * for what the world actually is: standing between two regions, the side of
 * the screen nearest the cold one should be cold. A per-pixel field is the only
 * way to say that, which is why this exists alongside rather than instead of it.
 *
 * Everything here is pure and frame-rate critical. It runs once per frame to
 * pack uniforms; the blending itself happens per pixel in the shader, in OKLab,
 * for the same reason `blendOklab` does — sRGB drags a midpoint through mud.
 */

/**
 * Regions the shader will consider.
 *
 * Fixed, because a uniform array's length is baked into the compiled program
 * and recompiling mid-flight would stutter. Beyond a couple of dozen the
 * nearest contributions have swamped the rest anyway, so the cap costs nothing
 * visible — a long presentation just re-picks which regions are in play as the
 * camera moves.
 */
export const MAX_REGIONS = 24;

export interface Region {
  /** World position of the region's centre. */
  x: number;
  y: number;
  /** OKLab, as the shader wants it: L, a, b. */
  canvas: [number, number, number];
  accent: [number, number, number];
}

/**
 * The regions nearest the camera, closest first.
 *
 * Chosen by distance from the camera rather than by index so that which
 * regions matter follows where the presenter is, not where they started.
 */
export function nearestRegions(
  camera: Camera,
  placements: ScenePlacement[],
  palettes: Palette[],
  limit = MAX_REGIONS,
): Region[] {
  const scored = placements.map((placement, index) => ({
    index,
    placement,
    distance: Math.hypot(camera.x - placement.x, camera.y - placement.y),
  }));

  scored.sort((a, b) => a.distance - b.distance);

  return scored.slice(0, Math.max(0, limit)).map(({ index, placement }) => {
    const palette = palettes[index];
    return {
      x: placement.x,
      y: placement.y,
      canvas: palette ? [palette.canvas.L, palette.canvas.a, palette.canvas.b] : [0, 0, 0],
      accent: palette ? [palette.accent.L, palette.accent.a, palette.accent.b] : [0, 0, 0],
    };
  });
}

/**
 * Flattens regions into the fixed-length arrays a uniform expects.
 *
 * Slots past `count` are left at zero and the shader ignores them — it reads
 * `count`, not the array length. The buffers are reused across frames; the
 * `Region[]` handed in is not, so a frame still allocates in `nearestRegions`.
 * Measured at about four microseconds for sixty scenes, which is a fortieth of
 * a percent of a frame — cheap enough to leave alone, and worth saying plainly
 * rather than claiming an allocation-free path that does not exist.
 */
export function packRegions(
  regions: Region[],
  into: { positions: Float32Array; canvas: Float32Array; accent: Float32Array },
): number {
  const count = Math.min(regions.length, MAX_REGIONS);

  for (let i = 0; i < count; i += 1) {
    const region = regions[i];
    into.positions[i * 2] = region.x;
    into.positions[i * 2 + 1] = region.y;

    into.canvas[i * 3] = region.canvas[0];
    into.canvas[i * 3 + 1] = region.canvas[1];
    into.canvas[i * 3 + 2] = region.canvas[2];

    into.accent[i * 3] = region.accent[0];
    into.accent[i * 3 + 1] = region.accent[1];
    into.accent[i * 3 + 2] = region.accent[2];
  }

  return count;
}

export function regionBuffers() {
  return {
    positions: new Float32Array(MAX_REGIONS * 2),
    canvas: new Float32Array(MAX_REGIONS * 3),
    accent: new Float32Array(MAX_REGIONS * 3),
  };
}

/**
 * What the shader needs to turn a pixel back into a world position.
 *
 * The inverse of `worldTransform`, which maps world to screen as
 * `centre + R(-rotation) · scale · (world − camera)`. Inverting it gives
 * `world = camera + R(rotation) · (screen − centre) / scale`, and the shader
 * does exactly that with the values packed here.
 *
 * Deriving it here rather than in GLSL means the one piece of this that can be
 * silently, subtly wrong is the piece a test can check.
 */
export interface ViewUniforms {
  cameraX: number;
  cameraY: number;
  /** World units per screen pixel. */
  invScale: number;
  /** Rotation in radians, in the direction that undoes the world transform. */
  rotation: number;
  halfWidth: number;
  halfHeight: number;
}

export function viewUniforms(camera: Camera, viewport: Size): ViewUniforms {
  return {
    cameraX: camera.x,
    cameraY: camera.y,
    invScale: 1 / cameraScale(camera, viewport),
    rotation: (camera.rotation * Math.PI) / 180,
    halfWidth: viewport.width / 2,
    halfHeight: viewport.height / 2,
  };
}

/**
 * A texture coordinate to the screen pixel it covers.
 *
 * The one step of the chain that lives only in GLSL, lifted out so it can be
 * tested. three's `PlaneGeometry` puts `uv.v = 1` at the vertices WebGL draws
 * at the *top* of the viewport, and every screen coordinate here has `y = 0`
 * at the top — so v has to be flipped. Getting this wrong reflects the entire
 * field about the camera's horizontal axis, which reads as an odd-looking
 * gradient rather than as a fault, and had already survived one round of
 * review looking exactly like weather.
 */
export function fragmentFromUv(
  uv: { x: number; y: number },
  resolution: Size,
): { x: number; y: number } {
  return { x: uv.x * resolution.width, y: (1 - uv.y) * resolution.height };
}

/**
 * Screen pixel to world position.
 *
 * The CPU twin of the shader's first three lines. It exists so the mapping can
 * be tested against `worldTransform` directly — a shader that puts the air in
 * the wrong place looks like a shader that is merely ugly, and would be
 * debugged as one for a long time.
 */
export function screenToWorld(
  view: ViewUniforms,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  const dx = (screenX - view.halfWidth) * view.invScale;
  const dy = (screenY - view.halfHeight) * view.invScale;

  const cos = Math.cos(view.rotation);
  const sin = Math.sin(view.rotation);

  return {
    x: view.cameraX + dx * cos - dy * sin,
    y: view.cameraY + dx * sin + dy * cos,
  };
}

/**
 * How far the air reaches, in world units.
 *
 * Proportional to a scene's own width so the field behaves the same in a tight
 * arrangement as in a sprawling one — the same reasoning as `ambientAt`'s
 * scene-width distances, and the reason this takes the stage size rather than a
 * constant.
 */
export function falloffFor(stage: Size): number {
  return stage.width * 0.85;
}

/**
 * Device pixel ratio to render the field at.
 *
 * Capped hard. This layer is a slow gradient with no edge anywhere in it, so
 * rendering it at 3× buys nothing a person can see and costs nine times the
 * fill rate on exactly the machines least able to spare it.
 */
export function atmosphereDpr(devicePixelRatio: number): number {
  return Math.max(1, Math.min(1.5, devicePixelRatio || 1));
}

/**
 * Whether this browser can give us a WebGL context at all.
 *
 * Probed on a throwaway canvas before three is asked for a renderer, because
 * three reports a failure by logging to the console — and a fallback the
 * application chose on purpose should not look like an error in a user's
 * console or a red badge in a developer's. The probe releases its context
 * immediately: a canvas can only have one, and the real one needs it.
 */
export function webglAvailable(
  createCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): boolean {
  try {
    const canvas = createCanvas();
    // webgl2 specifically: it is the only context three asks for, so probing
    // for webgl1 would answer a question nobody is going to ask and report
    // available on a browser where the renderer still fails.
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Depth                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How far behind the content each depth layer sits, in scene widths.
 *
 * The shader models a layer at depth `z` as the content plane seen by a camera
 * that is `z` world units further back: its world-units-per-pixel is the
 * camera's plus `z / viewportWidth`. That one line gives the two things a
 * background has to do to read as three-dimensional — slide slower than the
 * content when the camera pans, and grow less when it zooms — without a
 * projection matrix anywhere. The nearest layer is close enough to move with
 * the room; the farthest is far enough that, framing one scene, it drifts at
 * about a seventh of the content's speed.
 *
 * Exported so the shader test can reason about the same numbers the program
 * compiles in.
 */
export const DEPTH_LAYERS: readonly number[] = [0.6, 2.2, 6];

export interface Motion {
  /** 0 when the camera is still, 1 at a fast flight. */
  amount: number;
  /** Unit direction of travel in screen space, or zero when not panning. */
  headingX: number;
  headingY: number;
}

export const STILL: Motion = { amount: 0, headingX: 0, headingY: 0 };

/** Viewport widths per second that count as a fast flight. */
const FULL_PAN = 1.2;
/** Zoom e-folds per second that count as a fast flight. */
const FULL_ZOOM = 2;

/**
 * How fast the camera is moving, from two consecutive frames.
 *
 * Measured on the screen, not in the world: a flight over a wide overview
 * crosses far more world per second than a hop between neighbours, and it is
 * the room's sense of speed that decides how much the air should stir. Pan is
 * in viewport widths per second, zoom in e-folds per second, and either can
 * saturate on its own so a pure dive still reads as travel.
 *
 * The heading is rotated into screen space so a streak across the air lies
 * along the direction the room sees the camera move, whatever the world's
 * rotation under it.
 */
export function cameraMotion(
  previous: Camera | null,
  next: Camera,
  dtSeconds: number,
  viewport: Size,
): Motion {
  if (!previous || !(dtSeconds > 0) || viewport.width <= 0) return STILL;

  const scale = cameraScale(next, viewport);
  const dx = (next.x - previous.x) * scale;
  const dy = (next.y - previous.y) * scale;
  const radians = (-next.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const sx = dx * cos - dy * sin;
  const sy = dx * sin + dy * cos;

  const travelled = Math.hypot(sx, sy);
  const pan = travelled / dtSeconds / viewport.width;
  const zoom =
    Math.abs(Math.log(Math.max(next.width, 1e-6) / Math.max(previous.width, 1e-6))) / dtSeconds;

  const amount = Math.min(1, pan / FULL_PAN + zoom / FULL_ZOOM);
  if (!Number.isFinite(amount)) return STILL;
  return {
    amount,
    headingX: travelled > 0 ? sx / travelled : 0,
    headingY: travelled > 0 ? sy / travelled : 0,
  };
}

/** Seconds for the stirred air to settle by a factor of e once the camera lands. */
const SETTLE_SECONDS = 0.4;

/**
 * Follows a fresh measurement instantly on the way up and settles slowly on
 * the way down.
 *
 * A flight starts abruptly — the first frame of travel should already look
 * like travel — but it ends with the camera easing in, and the air should
 * still be moving for a beat after the content has stopped. A frame with no
 * pan keeps the last heading, so the settling streak does not snap to a
 * random direction on the final frame.
 */
export function settleMotion(current: Motion, sample: Motion, dtSeconds: number): Motion {
  const decayed = current.amount * Math.exp(-Math.max(0, dtSeconds) / SETTLE_SECONDS);
  const panning = sample.headingX !== 0 || sample.headingY !== 0;
  if (sample.amount >= decayed) {
    return {
      amount: sample.amount,
      headingX: panning ? sample.headingX : current.headingX,
      headingY: panning ? sample.headingY : current.headingY,
    };
  }
  return {
    amount: decayed < 1e-3 ? 0 : decayed,
    headingX: current.headingX,
    headingY: current.headingY,
  };
}
