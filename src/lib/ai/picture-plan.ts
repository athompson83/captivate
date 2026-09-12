import type { SceneLayout } from "@/lib/schema/presentation";

/**
 * Which of a deck's pictures are made, and which are found.
 *
 * Generation costs money and stock does not, so a deck generates a few
 * pictures and finds the rest. Which few is the point: the cover is the
 * first thing a room sees; a full-bleed backdrop is the whole screen; a
 * side picture is half of one. Photographic scenes only — a scene briefed
 * for a drawing gets a drawing. Pure, so the choice is testable without a
 * provider.
 */
export interface PictureCandidate {
  index: number;
  layout: SceneLayout;
}

const PRIORITY: Partial<Record<SceneLayout, number>> = {
  cover: 0,
  "media-full": 1,
  "split-left": 2,
  "split-right": 2,
  explainer: 3,
};

/** The indices to generate, best first, at most `cap` of them. */
export function pickGenerated(candidates: PictureCandidate[], cap: number): number[] {
  return candidates
    .map((candidate, order) => ({ ...candidate, order, rank: PRIORITY[candidate.layout] ?? 9 }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, Math.max(0, cap))
    .map((candidate) => candidate.index);
}

/** The shape a slot wants from the image model. */
export function shapeFor(slotAspect: number): "wide" | "tall" {
  return slotAspect < 1 ? "tall" : "wide";
}
