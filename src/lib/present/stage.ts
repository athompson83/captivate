import { ASPECT_VALUES, type AspectRatio } from "@/lib/schema/presentation";

/**
 * The stage renders at a fixed internal pixel size and is scaled with a CSS
 * transform to fit whatever container it is in. One code path therefore serves
 * a 180px dashboard thumbnail, a 900px editor canvas and a 4K projector, and
 * type never reflows between them — what you author is exactly what projects.
 */
export const STAGE_BASE_WIDTH = 1600;

export function stageSize(aspect: AspectRatio) {
  const ratio = ASPECT_VALUES[aspect];
  return { width: STAGE_BASE_WIDTH, height: Math.round(STAGE_BASE_WIDTH / ratio) };
}

/** Root type size for the stage; every text size is a multiple of this. */
export function stageRem(width = STAGE_BASE_WIDTH) {
  return width / 100;
}

/** Largest scale that fits `inner` inside `outer` without cropping. */
export function fitScale(
  outer: { width: number; height: number },
  inner: { width: number; height: number },
) {
  if (inner.width <= 0 || inner.height <= 0) return 1;
  return Math.min(outer.width / inner.width, outer.height / inner.height);
}

/** Convert a pointer event to normalised 0..1 stage coordinates. */
export function pointerToStage(
  e: { clientX: number; clientY: number },
  rect: DOMRect,
): { x: number; y: number } {
  return {
    x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
  };
}
