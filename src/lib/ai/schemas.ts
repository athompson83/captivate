import { z } from "zod";
import { SceneLayout } from "@/lib/schema/presentation";

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

export const OutlineScene = z.object({
  title: z.string().min(1).max(120),
  /** One sentence describing what this scene does for the audience. */
  purpose: z.string().min(1).max(300),
  layout: GeneratedLayout,
});

export const PresentationOutline = z.object({
  title: z.string().min(1).max(140),
  subtitle: z.string().max(220).default(""),
  /** Short justification the user can read before committing to generation. */
  approach: z.string().max(600).default(""),
  sections: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        scenes: z.array(OutlineScene).min(1).max(14),
      }),
    )
    .min(1)
    .max(8),
  suggestedThemeId: z.string().max(64).default("midnight"),
});
export type PresentationOutline = z.infer<typeof PresentationOutline>;

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
  subheading: z.string().max(220).default(""),
  eyebrow: z.string().max(48).default(""),
  body: z.string().max(320).default(""),
  bullets: z.array(z.string().min(1).max(140)).max(6).default([]),
  bulletsB: z.array(z.string().min(1).max(140)).max(6).default([]),
  quote: z.string().max(300).default(""),
  attribution: z.string().max(120).default(""),
  caption: z.string().max(160).default(""),
  cards: z
    .array(z.object({ title: z.string().min(1).max(60), body: z.string().min(1).max(180) }))
    .max(3)
    .default([]),
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
  speakerNotes: z.string().max(1500).default(""),
});
export type GeneratedScene = z.infer<typeof GeneratedScene>;

export const GeneratedScenes = z.object({
  scenes: z.array(GeneratedScene).min(1).max(24),
});

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

export const AI_KINDS = [
  "outline",
  "presentation",
  "scene",
  "scenes",
  "speaker_notes",
  "rewrite",
  "visuals",
  "flow",
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
