import { z } from "zod";

/**
 * The narrative map.
 *
 * This is the contract scene generation works from, not a picture drawn after
 * the fact. A presentation is a sequence of **movements** — stretches of the
 * argument that each do one job — and each movement holds ordered **moments**:
 * intentional beats with a stated purpose, an audience takeaway, and a role in
 * the argument. Scenes are what a moment is eventually rendered as.
 *
 * Three words, used consistently:
 *
 *   Movement — a stretch of the argument. Persisted as a section row.
 *   Moment   — a beat inside it, defined before anything is generated.
 *   Scene    — the rendered output. Never called a slide.
 *
 * The database keeps the name `sections` for movements, because renaming a
 * table that every policy, index and foreign key already references would be
 * migration risk bought for nothing. The interface says Movement everywhere.
 */

/* -------------------------------------------------------------------------- */
/* Roles                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What a moment *does* to an audience.
 *
 * Controlled but extensible: adding a role is a one-line change here plus its
 * explanation below. Nothing forces a presentation to use every role, and a
 * template's recommendations are a starting point rather than a shape the user
 * is locked into.
 */
export const NarrativeRole = z.enum([
  "hook",
  "provocation",
  "question",
  "context",
  "frame",
  "claim",
  "reframe",
  "evidence",
  "example",
  "demonstration",
  "contrast",
  "application",
  "synthesis",
  "transition",
  "callback",
  "close",
]);
export type NarrativeRole = z.infer<typeof NarrativeRole>;

/**
 * Every role in plain language.
 *
 * "Provocation" and "synthesis" are not words most people organise a talk
 * with, so the interface never shows a bare role name. `plain` is what a
 * presenter reads; `label` is the short chip beside it.
 */
export const ROLE_META: Record<NarrativeRole, { label: string; plain: string }> = {
  hook: { label: "Hook", plain: "Get their attention before anything else." },
  provocation: { label: "Provocation", plain: "Unsettle a belief they walked in with." },
  question: { label: "Question", plain: "Ask the thing the rest of this answers." },
  context: { label: "Context", plain: "Give them what they need to follow along." },
  frame: { label: "Frame", plain: "Set up how to think about what follows." },
  claim: { label: "Claim", plain: "State the thing you are arguing." },
  reframe: { label: "Reframe", plain: "Replace their model with a better one." },
  evidence: { label: "Evidence", plain: "Show why the claim holds." },
  example: { label: "Example", plain: "Make it concrete with a real case." },
  demonstration: { label: "Demonstration", plain: "Show it happening rather than describe it." },
  contrast: { label: "Contrast", plain: "Set it against the thing it gets confused with." },
  application: { label: "Application", plain: "Show them what to do differently." },
  synthesis: { label: "Synthesis", plain: "Pull the threads into one idea." },
  transition: { label: "Transition", plain: "Carry the room from one movement to the next." },
  callback: { label: "Callback", plain: "Return to something from earlier, changed." },
  close: { label: "Close", plain: "Leave them with what matters." },
};

export const ROLE_ORDER = Object.keys(ROLE_META) as NarrativeRole[];

/* -------------------------------------------------------------------------- */
/* Visual intent                                                               */
/* -------------------------------------------------------------------------- */

/**
 * How a moment should *look*, said at the level of composition rather than by
 * naming a template.
 *
 * Deliberately one step above the layout enum: "this is a comparison" survives
 * a redesign of the layout engine, where "this is the two-column layout" does
 * not. Scene generation maps intent to a layout; the map does not pre-empt it.
 */
export const VisualIntent = z.enum([
  "auto",
  "statement",
  "comparison",
  "data",
  "sequence",
  "imagery",
  "quotation",
  "enumeration",
  "demonstration",
]);
export type VisualIntent = z.infer<typeof VisualIntent>;

export const VISUAL_INTENT_META: Record<VisualIntent, { label: string; plain: string }> = {
  auto: { label: "Let Captivate choose", plain: "Pick a composition from the role and content." },
  statement: { label: "One statement", plain: "A single claim, large, and nothing else." },
  comparison: { label: "A comparison", plain: "Two things set against each other." },
  data: { label: "Data", plain: "A figure or chart carrying the point." },
  sequence: { label: "A sequence", plain: "Steps or stages, in order." },
  imagery: { label: "Imagery", plain: "A picture doing the work." },
  quotation: { label: "A quotation", plain: "Someone else's words." },
  enumeration: { label: "A short list", plain: "A handful of points, not a wall." },
  demonstration: { label: "A demonstration", plain: "Something shown happening." },
};

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A reference to something that already exists in the workspace.
 *
 * A *reference*, never a copy. The label is denormalised purely so the map can
 * render without loading every asset, and it is refreshed from the source when
 * one is available — the id is what the relationship is.
 */
export const EvidenceRef = z.object({
  kind: z.enum(["asset", "note"]),
  id: z.string().uuid(),
  /** Cached display name. The reference is the id; this is for rendering. */
  label: z.string().max(200).default(""),
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

/* -------------------------------------------------------------------------- */
/* Moments                                                                     */
/* -------------------------------------------------------------------------- */

/** Longest a single moment may claim, so one beat cannot eat a whole talk. */
export const MAX_MOMENT_SECONDS = 3600;

export const Moment = z.object({
  id: z.string().uuid(),
  presentationId: z.string().uuid(),
  /** The owning movement. Null is a moment not yet placed in one. */
  movementId: z.string().uuid().nullable(),
  title: z.string().max(160),
  role: NarrativeRole,
  /** Why this moment exists. Shown on the map without opening anything. */
  purpose: z.string().max(600).default(""),
  /** What the audience should carry out of it. */
  takeaway: z.string().max(600).default(""),
  estimatedSeconds: z.number().int().min(0).max(MAX_MOMENT_SECONDS).default(0),
  evidence: z.array(EvidenceRef).max(24).default([]),
  visualIntent: VisualIntent.default("auto"),
  /** Anything the author wants this one moment's generation to honour. */
  instructions: z.string().max(1200).default(""),
  /** Locked moments are never replaced by regeneration. */
  locked: z.boolean().default(false),
  position: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Moment = z.infer<typeof Moment>;

/* -------------------------------------------------------------------------- */
/* The map                                                                     */
/* -------------------------------------------------------------------------- */

/** A movement with its moments, ready to render or to generate from. */
export interface MappedMovement {
  id: string | null;
  title: string;
  /** Short name for the rail. Falls back to the title where unset. */
  label: string;
  purpose: string;
  position: number;
  moments: Moment[];
  estimatedSeconds: number;
  /** True where this movement exists only because moments had no home. */
  unplaced: boolean;
}

export interface NarrativeMap {
  movements: MappedMovement[];
  totalSeconds: number;
  momentCount: number;
  /** True where the map was derived from existing scenes rather than authored. */
  derived: boolean;
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A template's recommended argument, not just its look.
 *
 * Weights rather than seconds: a lecture template should propose the same
 * *proportions* whether someone asked for fifteen minutes or fifty.
 */
export const NarrativeShapeMovement = z.object({
  label: z.string().max(24),
  title: z.string().max(120),
  purpose: z.string().max(600),
  /** Share of the running time, relative to the other movements. */
  weight: z.number().min(0.1).max(10).default(1),
  moments: z
    .array(
      z.object({
        title: z.string().max(160),
        role: NarrativeRole,
        purpose: z.string().max(600),
        takeaway: z.string().max(600).default(""),
        visualIntent: VisualIntent.default("auto"),
        weight: z.number().min(0.1).max(10).default(1),
      }),
    )
    .min(1)
    .max(12),
});
export type NarrativeShapeMovement = z.infer<typeof NarrativeShapeMovement>;

export const NarrativeShape = z.array(NarrativeShapeMovement).min(1).max(10);
export type NarrativeShape = z.infer<typeof NarrativeShape>;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Distributes a target duration across weighted parts.
 *
 * The remainder goes to the largest parts rather than being dropped, so the
 * totals always add up to exactly what was asked for. A running total that is
 * eleven seconds short of the number above it reads as a bug, and is.
 */
export function distributeSeconds(weights: number[], totalSeconds: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || weights.length === 0) return weights.map(() => 0);

  const exact = weights.map((weight) => (weight / sum) * totalSeconds);
  const floored = exact.map((value) => Math.floor(value));
  let remainder = Math.round(totalSeconds) - floored.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (const { index } of order) {
    if (remainder <= 0) break;
    floored[index] += 1;
    remainder -= 1;
  }

  return floored;
}

/** The label the rail should show for a movement. */
export function movementLabel(movement: { label: string; title: string }): string {
  return movement.label.trim() || movement.title.trim();
}
