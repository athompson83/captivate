import { z } from "zod";
import { ICON_NAMES } from "@/lib/schema/icons";
import { SceneContent, SceneLayout, DrawnPath } from "@/lib/schema/presentation";
import { NarrativeRole, VisualIntent } from "@/lib/schema/narrative";

/**
 * Schemas for model output.
 *
 * The model never returns presentation state directly. It returns *content* in
 * these shapes, which are validated here and only then poured into the layout
 * engine. That keeps arbitrary model output from ever reaching the document,
 * and keeps composition quality under the application's control rather than
 * the model's.
 */

/** Layouts the generator may choose. `custom` is excluded on purpose. */
export const GeneratedLayout = SceneLayout.exclude(["custom"]);

/**
 * Scene content.
 *
 * Note the tight caps: a heading of 120 characters and at most six bullets of
 * 140 characters each is the structural defence against wall-of-text scenes.
 * The model cannot produce a dense slide because the schema will not hold one.
 */
export const GeneratedScene = z.object({
  title: z.string().min(1).max(120),
  layout: GeneratedLayout,
  heading: z.string().max(120).default(""),
  /**
   * The clause the claim turns on, carried in the theme's accent colour.
   *
   * "When the system pauses, / **survival falls.**" — capped hard, because the
   * emphasis only works when it is a phrase rather than a second sentence.
   */
  headingAccent: z.string().max(60).default(""),
  subheading: z.string().max(220).default(""),
  eyebrow: z.string().max(48).default(""),
  body: z.string().max(320).default(""),
  bullets: z.array(z.string().min(1).max(140)).max(6).default([]),
  bulletsB: z.array(z.string().min(1).max(140)).max(6).default([]),
  quote: z.string().max(300).default(""),
  attribution: z.string().max(120).default(""),
  caption: z.string().max(160).default(""),
  cards: z
    .array(
      z.object({
        title: z.string().min(1).max(60),
        body: z.string().min(1).max(180),
        /**
         * The icon that carries this card's meaning.
         *
         * This field is why every generated card was a plain circle. The
         * composer has read `card.icon` since cards existed — `layouts.ts`
         * falls back to `"circle"` when it is absent — and the schema never
         * offered it, so the model had no way to answer and the fallback was
         * the only thing that ever ran. The pipe was built and the tap was
         * never opened.
         *
         * An enum over the shared registry rather than a string: a name the
         * model invents fails validation and earns the corrective retry, where
         * a free string would resolve to the same silent circle and look
         * exactly like success.
         */
        icon: z.enum(ICON_NAMES).nullable().default(null),
      }),
    )
    .max(3)
    .default([]),
  /**
   * The icon a layout that leads with one should carry: the take-home point,
   * the call to action, a statement. The same registry as a card's icon, for
   * the same reason — an invented name earns a corrective retry rather than a
   * silent circle.
   */
  icon: z.enum(ICON_NAMES).nullable().default(null),
  /**
   * One number and what it measures, for the `figure` layout.
   *
   * The value is a string, not a number: "7.6%", "1 in 4", "90 s" are all
   * figures a room can read and a bare float is none of them. Capped short
   * because it is set large enough to be the whole scene.
   */
  figure: z
    .object({ value: z.string().min(1).max(14), label: z.string().max(90).default("") })
    .nullable()
    .default(null),
  chart: z
    .object({
      chart: z.enum(["bar", "column", "line", "donut"]),
      data: z
        .array(z.object({ label: z.string().max(40), value: z.number() }))
        .min(2)
        .max(8),
      summary: z.string().max(300).default(""),
    })
    .nullable()
    .default(null),
  code: z
    .object({ code: z.string().max(1200), language: z.string().max(24) })
    .nullable()
    .default(null),
  /** A description the app turns into an image search or generation prompt. */
  imagePrompt: z.string().max(240).default(""),
  /** Two to five concrete words for a stock-photo search of the same subject. */
  photoQuery: z.string().max(80).default(""),
  /**
   * Depth on demand: a small aside the presenter reaches by clicking, not by
   * advancing. It becomes a real detail scene (`flowRole: "detail"`) woven in
   * after this one, with a hotspot on this scene's most clickable element.
   */
  aside: z
    .object({
      /** What the clickable affordance says, e.g. "See the mechanism". */
      label: z.string().min(1).max(60),
      title: z.string().min(1).max(120),
      body: z.string().max(320).default(""),
      bullets: z.array(z.string().min(1).max(140)).max(5).default([]),
      speakerNotes: z.string().max(800).default(""),
    })
    .nullable()
    .default(null),
  speakerNotes: z.string().max(1500).default(""),
});
export type GeneratedScene = z.infer<typeof GeneratedScene>;

export const GeneratedScenes = z.object({
  scenes: z.array(GeneratedScene).min(1).max(24),
});

/**
 * What `/api/ai/generate-scenes` hands back to the editor.
 *
 * These scenes go straight into the open document, so the response is parsed
 * like any other input rather than cast. `SceneContent` is the real schema:
 * content that would not survive a reload has no business being written.
 *
 * `scenes` is required and non-empty, which are two separate holes. Defaulting
 * a missing field to `[]` turned a malformed response into a silent success
 * that generated nothing and said it worked — and so did an explicitly empty
 * array, which reached the same "0 scenes generated" toast by another door.
 * The route requires at least one brief and writes one scene per brief, so an
 * empty result is never a legitimate answer.
 */
export const WrittenScenes = z.object({
  scenes: z
    .array(
      z.object({
        momentId: z.string(),
        title: z.string(),
        content: SceneContent,
        speakerNotes: z.string(),
      }),
    )
    .min(1),
  source: z.string().optional(),
  notice: z.string().optional(),
});
export type WrittenScenes = z.infer<typeof WrittenScenes>;

/* -------------------------------------------------------------------------- */
/* The narrative map                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A proposed beat, before anything is written.
 *
 * `purpose` and `takeaway` are required and cannot be empty. That is the whole
 * difference between this and the flat outline it replaces: a beat that cannot
 * say what it is for and what the room leaves with is not a beat, and the
 * schema refuses it rather than letting a title stand in for a reason.
 *
 * Ids are never proposed. Evidence is named by id from a list the application
 * supplied, and every one is verified against that list before it is stored —
 * naming a plausible id is exactly how a model would invent a citation.
 */
export const ProposedMoment = z.object({
  title: z.string().min(1).max(160),
  role: NarrativeRole,
  /** Why this beat exists. Specific to the subject, not a generic label. */
  purpose: z.string().min(1).max(400),
  /** What the audience should understand, feel, question or remember. */
  takeaway: z.string().min(1).max(400),
  visualIntent: VisualIntent.default("auto"),
  /** Share of the movement's time, relative to its siblings. */
  weight: z.number().min(0.2).max(5).default(1),
  evidenceIds: z.array(z.string().max(64)).max(8).default([]),
});
export type ProposedMoment = z.infer<typeof ProposedMoment>;

export const ProposedMovement = z.object({
  label: z.string().min(1).max(24),
  title: z.string().min(1).max(120),
  purpose: z.string().min(1).max(400),
  weight: z.number().min(0.2).max(5).default(1),
  moments: z.array(ProposedMoment).min(1).max(10),
});
export type ProposedMovement = z.infer<typeof ProposedMovement>;

/**
 * Two movements minimum.
 *
 * One movement is a list of beats, not a shape — and the point of planning the
 * argument is that its parts do different jobs.
 */
export const ProposedMap = z.object({
  title: z.string().min(1).max(140),
  /** What the argument does and why it is shaped this way. */
  approach: z.string().max(700).default(""),
  movements: z.array(ProposedMovement).min(2).max(8),
  suggestedThemeId: z.string().max(64).default("midnight"),
});
export type ProposedMap = z.infer<typeof ProposedMap>;

/** A rewritten proposal for one beat, leaving the rest of the map alone. */
export const RewrittenMoment = z.object({
  title: z.string().min(1).max(160),
  purpose: z.string().min(1).max(400),
  takeaway: z.string().min(1).max(400),
});
export type RewrittenMoment = z.infer<typeof RewrittenMoment>;

export const RewriteResult = z.object({
  /** Several options so the user chooses rather than accepting one answer. */
  options: z.array(z.string().min(1).max(2000)).min(1).max(3),
});
export type RewriteResult = z.infer<typeof RewriteResult>;

export const SpeakerNotesResult = z.object({
  notes: z.string().min(1).max(4000),
});

export const VisualSuggestion = z.object({
  suggestions: z
    .array(
      z.object({
        /** What the picture should show, in plain language. */
        description: z.string().min(1).max(240),
        /** Where it belongs on the scene. */
        placement: z.enum(["background", "beside-text", "full-bleed", "inline"]),
        altText: z.string().min(1).max(240),
      }),
    )
    .min(1)
    .max(3),
});

export const FlowReview = z.object({
  summary: z.string().max(600),
  issues: z
    .array(
      z.object({
        sceneIndex: z.number().int().min(0).max(499),
        severity: z.enum(["note", "suggestion", "problem"]),
        message: z.string().min(1).max(400),
      }),
    )
    .max(20)
    .default([]),
  suggestedTransitions: z
    .array(
      z.object({ afterSceneIndex: z.number().int().min(0).max(499), line: z.string().max(240) }),
    )
    .max(20)
    .default([]),
});

/**
 * A drawing the model sketches as vector paths, in drawing order.
 *
 * Deliberately the same shape the DrawingElement stores, so validated output
 * maps 1:1 onto the document with no translation layer to get wrong. Path
 * data passes the same grammar user input would — geometry only, no markup.
 */
export const GeneratedDrawing = z.object({
  viewBox: z.object({
    width: z.number().positive().max(4000),
    height: z.number().positive().max(4000),
  }),
  paths: z.array(DrawnPath).min(1).max(400),
  stageLabels: z.array(z.string().max(120)).max(20).default([]),
  alt: z.string().max(600).default(""),
});
export type GeneratedDrawing = z.infer<typeof GeneratedDrawing>;

export const AI_KINDS = [
  "map",
  "moment",
  "presentation",
  "scene",
  "scenes",
  "speaker_notes",
  "rewrite",
  "visuals",
  "flow",
  "drawing",
] as const;
export type AiKind = (typeof AI_KINDS)[number];

export const RewriteMode = z.enum([
  "rewrite",
  "shorten",
  "expand",
  "simplify",
  "professional",
  "conversational",
  "alternatives",
]);
export type RewriteMode = z.infer<typeof RewriteMode>;

export const REWRITE_LABELS: Record<RewriteMode, { label: string; instruction: string }> = {
  rewrite: {
    label: "Rewrite",
    instruction: "Rewrite it more clearly while keeping the meaning and roughly the same length.",
  },
  shorten: {
    label: "Shorten",
    instruction: "Cut it to the essential idea. Aim for at most half the original length.",
  },
  expand: {
    label: "Expand",
    instruction:
      "Add one concrete detail or example. Stay under roughly double the original length.",
  },
  simplify: {
    label: "Simplify",
    instruction: "Use plainer words and shorter sentences. Keep every fact intact.",
  },
  professional: {
    label: "More formal",
    instruction: "Make the tone more formal and precise without becoming stiff or corporate.",
  },
  conversational: {
    label: "More conversational",
    instruction: "Make it sound like a person speaking to a room, not a document.",
  },
  alternatives: {
    label: "Alternatives",
    instruction: "Offer three genuinely different phrasings of the same idea.",
  },
};
