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
