import type { ElementAnimation, EntranceAnimation } from "@/lib/schema/presentation";

/**
 * Motion presets.
 *
 * Every preset is expressed as a plain from/to pair so playback state stays
 * serialisable and a recording of a presentation reproduces the same motion
 * that the audience saw.
 */

export interface MotionState {
  opacity?: number;
  x?: number;
  y?: number;
  scale?: number;
  filter?: string;
  clipPath?: string;
}

export function entranceFrom(preset: EntranceAnimation): MotionState {
  switch (preset) {
    case "none":
      return { opacity: 1 };
    case "fade":
      return { opacity: 0 };
    case "rise":
      return { opacity: 0, y: 24 };
    case "settle":
      return { opacity: 0, y: -18 };
    case "slide-left":
      return { opacity: 0, x: 48 };
    case "slide-right":
      return { opacity: 0, x: -48 };
    case "scale":
      return { opacity: 0, scale: 0.94 };
    case "reveal":
      return { opacity: 1, clipPath: "inset(0 100% 0 0)" };
    case "blur":
      return { opacity: 0, filter: "blur(12px)" };
    default:
      return { opacity: 0 };
  }
}

export function entranceTo(preset: EntranceAnimation): MotionState {
  const base: MotionState = { opacity: 1, x: 0, y: 0, scale: 1 };
  if (preset === "reveal") return { ...base, clipPath: "inset(0 0% 0 0)" };
  if (preset === "blur") return { ...base, filter: "blur(0px)" };
  return base;
}

/** Scene-level transition, expressed as enter/exit variants. */
export const STAGE_EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Total number of discrete "advance" steps in a scene: 1 for the scene itself,
 * plus one for each element that waits for an explicit advance and each item of
 * a staggered list. Presenter navigation walks these before moving on.
 */
export function buildStepCount(
  elements: { animation: ElementAnimation; type: string; items?: unknown[]; staggered?: boolean }[],
): number {
  let steps = 1;
  for (const el of elements) {
    if (el.animation.onAdvance) steps += 1;
    if (el.type === "list" && el.staggered && Array.isArray(el.items)) {
      steps += Math.max(0, el.items.length - 1);
    }
  }
  return steps;
}
