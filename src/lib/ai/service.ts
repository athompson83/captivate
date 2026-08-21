import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import { composeScene, type LayoutContent } from "@/lib/editor/layouts";
import type { SceneContent } from "@/lib/schema/presentation";
import { BASE_SYSTEM, generateStructured, isAiConfigured, type StructuredResult } from "./provider";
import {
  GeneratedScene,
  GeneratedScenes,
  PresentationOutline,
  RewriteResult,
  SpeakerNotesResult,
  VisualSuggestion,
  REWRITE_LABELS,
  type AiKind,
  type RewriteMode,
} from "./schemas";
import { fallbackOutline, fallbackRewrite, fallbackScene } from "./fallback";

/**
 * Application-level AI operations.
 *
 * Each function records an `ai_generations` row so cost and failures are
 * visible, and each falls back to a deterministic result rather than leaving
 * the user with a dead button when no model is configured.
 */

export interface AudienceContext {
  audience?: string;
  tone?: string;
  sceneCount?: number;
}

async function recordGeneration(
  kind: AiKind,
  prompt: string,
  presentationId: string | null,
  result: {
    status: "succeeded" | "failed" | "invalid_output";
    model?: string;
    usage?: { input: number; output: number };
    error?: string;
  },
) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Written with the user's own client so RLS still applies; the table has no
    // insert policy for `authenticated`, so this runs only where the server has
    // elevated access. Failures here must never break a generation.
    await supabase.from("ai_generations").insert({
      owner_id: user.id,
      presentation_id: presentationId,
      kind,
      prompt: prompt.slice(0, 4000),
      status: result.status,
      model: result.model ?? null,
      input_tokens: result.usage?.input ?? null,
      output_tokens: result.usage?.output ?? null,
      error_message: result.error?.slice(0, 500) ?? null,
      completed_at: new Date().toISOString(),
    } as never);
  } catch {
    // Audit logging is best-effort by design.
  }
}

function contextLine(context: AudienceContext): string {
  const parts: string[] = [];
  if (context.audience) parts.push(`Audience: ${context.audience}.`);
  if (context.tone) parts.push(`Tone: ${context.tone}.`);
  return parts.join(" ");
}

/* -------------------------------------------------------------------------- */
/* Outline                                                                     */
/* -------------------------------------------------------------------------- */

export interface OutlineOutcome {
  outline: PresentationOutline;
  source: "model" | "fallback";
  notice?: string;
}

export async function buildOutline(
  prompt: string,
  context: AudienceContext,
): Promise<{ ok: true; data: OutlineOutcome } | { ok: false; error: string }> {
  const sceneTarget = Math.min(24, Math.max(4, context.sceneCount ?? 10));

  if (!isAiConfigured()) {
    return {
      ok: true,
      data: {
        outline: fallbackOutline(prompt, sceneTarget),
        source: "fallback",
        notice:
          "No language model is configured on this deployment, so Captivate built a structural draft instead. Every scene is real and editable.",
      },
    };
  }

  const result = await generateStructured({
    schema: PresentationOutline,
    toolName: "propose_outline",
    toolDescription: "Propose the structure of a presentation before any scene content is written.",
    system: `${BASE_SYSTEM}

You are proposing an outline only. Choose a layout for each scene that suits what that scene has to do — a comparison is not a bulleted list, a single idea is not three cards. Aim for about ${sceneTarget} scenes in total across all sections.`,
    prompt: `Propose an outline for this presentation.

${contextLine(context)}

Request:
${prompt}`,
    temperature: 0.7,
    maxTokens: 3000,
  });

  await recordGeneration("outline", prompt, null, toRecord(result));

  if (!result.ok) {
    // A provider failure must not block the user: fall back and say so.
    return {
      ok: true,
      data: {
        outline: fallbackOutline(prompt, sceneTarget),
        source: "fallback",
        notice: `${result.error} Captivate built a structural draft instead — you can regenerate once it's available.`,
      },
    };
  }

  return { ok: true, data: { outline: result.data, source: "model" } };
}

/* -------------------------------------------------------------------------- */
/* Scenes                                                                      */
/* -------------------------------------------------------------------------- */

export interface SceneOutcome {
  scenes: { title: string; content: SceneContent; speakerNotes: string; imagePrompt: string }[];
  source: "model" | "fallback";
  notice?: string;
}

export async function buildScenes(
  outline: PresentationOutline,
  prompt: string,
  context: AudienceContext,
  presentationId: string | null,
): Promise<{ ok: true; data: SceneOutcome } | { ok: false; error: string }> {
  const flat = outline.sections.flatMap((section) =>
    section.scenes.map((scene) => ({ ...scene, section: section.title })),
  );

  if (!isAiConfigured()) {
    return {
      ok: true,
      data: {
        scenes: flat.map((s) => materialise(fallbackScene(s, { title: outline.title, prompt }))),
        source: "fallback",
        notice: "No language model is configured, so these scenes are structural placeholders.",
      },
    };
  }

  const result = await generateStructured({
    schema: GeneratedScenes,
    toolName: "write_scenes",
    toolDescription: "Write the content for every scene in an approved outline.",
    system: `${BASE_SYSTEM}

Write content for exactly the scenes given, in the same order, keeping each scene's assigned layout. Fill only the fields that layout uses — a "quote" scene needs quote and attribution, not bullets. Leave unused fields as empty strings or empty arrays.

Where an image would genuinely help, describe it in imagePrompt in plain language. Leave imagePrompt empty when a picture would just be decoration.`,
    prompt: `Presentation: ${outline.title}
${outline.subtitle ? `Subtitle: ${outline.subtitle}\n` : ""}${contextLine(context)}

Original request:
${prompt}

Scenes to write (${flat.length}):
${flat.map((s, i) => `${i + 1}. [${s.layout}] ${s.title} — ${s.purpose}`).join("\n")}`,
    temperature: 0.7,
    maxTokens: 8000,
  });

  await recordGeneration("presentation", prompt, presentationId, toRecord(result));

  if (!result.ok) {
    return {
      ok: true,
      data: {
        scenes: flat.map((s) => materialise(fallbackScene(s, { title: outline.title, prompt }))),
        source: "fallback",
        notice: `${result.error} Captivate created the outline's scenes as editable placeholders instead.`,
      },
    };
  }

  // Trust the outline's length over the model's: pad or trim to match, so the
  // user gets exactly the structure they approved.
  const generated = result.data.scenes;
  const scenes = flat.map((outlineScene, i) => {
    const match = generated[i];
    return materialise(
      match
        ? { ...match, layout: outlineScene.layout }
        : fallbackScene(outlineScene, { title: outline.title, prompt }),
    );
  });

  return { ok: true, data: { scenes, source: "model" } };
}

export async function buildSingleScene(
  instruction: string,
  context: AudienceContext & { presentationTitle?: string; neighbouring?: string[] },
  presentationId: string | null,
): Promise<{ ok: true; data: SceneOutcome } | { ok: false; error: string }> {
  if (!isAiConfigured()) {
    return {
      ok: true,
      data: {
        scenes: [
          materialise(
            fallbackScene(
              {
                title: instruction.slice(0, 60) || "New scene",
                purpose: instruction,
                layout: "bullets",
              },
              { title: context.presentationTitle ?? "", prompt: instruction },
            ),
          ),
        ],
        source: "fallback",
        notice: "No language model is configured, so this scene is a structural placeholder.",
      },
    };
  }

  const result = await generateStructured({
    schema: GeneratedScene,
    toolName: "write_scene",
    toolDescription: "Write a single presentation scene.",
    system: `${BASE_SYSTEM}

Write one scene. Choose the layout that best suits what the scene has to do, then fill only the fields that layout uses.`,
    prompt: `Presentation: ${context.presentationTitle ?? "Untitled"}
${contextLine(context)}
${context.neighbouring?.length ? `\nSurrounding scenes, for continuity:\n${context.neighbouring.map((t, i) => `${i + 1}. ${t}`).join("\n")}` : ""}

Write a scene that does this:
${instruction}`,
    temperature: 0.7,
    maxTokens: 2000,
  });

  await recordGeneration("scene", instruction, presentationId, toRecord(result));

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: { scenes: [materialise(result.data)], source: "model" } };
}

/** Turn validated model content into a real, composed scene. */
function materialise(scene: GeneratedScene): {
  title: string;
  content: SceneContent;
  speakerNotes: string;
  imagePrompt: string;
} {
  const layoutContent: LayoutContent = {
    eyebrow: scene.eyebrow || undefined,
    heading: scene.heading || undefined,
    headingAccent: scene.headingAccent || undefined,
    subheading: scene.subheading || undefined,
    body: scene.body || undefined,
    bullets: scene.bullets.length ? scene.bullets : undefined,
    bulletsB: scene.bulletsB.length ? scene.bulletsB : undefined,
    quote: scene.quote || undefined,
    attribution: scene.attribution || undefined,
    caption: scene.caption || undefined,
    cards: scene.cards.length ? scene.cards : undefined,
    chart: scene.chart ?? undefined,
    code: scene.code ?? undefined,
    // A placeholder image element is created when the model asked for one, so
    // the composition is right and the user only has to drop a picture in.
    media: scene.imagePrompt ? { url: "", alt: scene.imagePrompt } : undefined,
  };

  return {
    title: scene.title,
    content: composeScene(scene.layout, layoutContent),
    speakerNotes: scene.speakerNotes,
    imagePrompt: scene.imagePrompt,
  };
}

/* -------------------------------------------------------------------------- */
/* Text tools                                                                  */
/* -------------------------------------------------------------------------- */

export async function rewriteText(
  text: string,
  mode: RewriteMode,
  context: AudienceContext,
  presentationId: string | null,
): Promise<
  { ok: true; options: string[]; source: "model" | "fallback" } | { ok: false; error: string }
> {
  if (!text.trim()) return { ok: false, error: "There's no text to work with." };

  if (!isAiConfigured()) {
    return { ok: true, options: fallbackRewrite(text, mode), source: "fallback" };
  }

  const result = await generateStructured({
    schema: RewriteResult,
    toolName: "rewrite_text",
    toolDescription: "Return rewritten versions of a piece of presentation text.",
    system: `${BASE_SYSTEM}

You are editing text that appears on a slide, so brevity matters more than completeness. Return ${mode === "alternatives" ? "three" : "one"} option${mode === "alternatives" ? "s" : ""}. Never add facts that were not in the original.`,
    prompt: `${REWRITE_LABELS[mode].instruction}

${contextLine(context)}

Text:
${text}`,
    temperature: mode === "alternatives" ? 0.9 : 0.6,
    maxTokens: 1200,
  });

  await recordGeneration(
    "rewrite",
    `${mode}: ${text.slice(0, 200)}`,
    presentationId,
    toRecord(result),
  );

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, options: result.data.options, source: "model" };
}

export async function writeSpeakerNotes(
  scene: { title: string; text: string; existingNotes: string },
  context: AudienceContext & { presentationTitle?: string },
  presentationId: string | null,
): Promise<{ ok: true; notes: string } | { ok: false; error: string }> {
  if (!isAiConfigured()) {
    return {
      ok: false,
      error:
        "AI isn't configured on this deployment, so notes can't be drafted. You can still write them yourself.",
    };
  }

  const result = await generateStructured({
    schema: SpeakerNotesResult,
    toolName: "write_speaker_notes",
    toolDescription: "Write private speaker notes for one scene.",
    system: `${BASE_SYSTEM}

Speaker notes are what the presenter says, not what the slide shows. Write four to eight sentences: how to open the scene, the one point to emphasise, a question to put to the room where it fits, and how to move on. Never repeat the words already on screen.`,
    prompt: `Presentation: ${context.presentationTitle ?? "Untitled"}
${contextLine(context)}

Scene title: ${scene.title || "(untitled)"}
What is on the scene:
${scene.text || "(empty scene)"}

${scene.existingNotes.trim() ? `Improve these existing notes rather than starting over:\n${scene.existingNotes}` : "There are no notes yet."}`,
    temperature: 0.7,
    maxTokens: 1200,
  });

  await recordGeneration("speaker_notes", scene.title, presentationId, toRecord(result));

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, notes: result.data.notes };
}

export async function suggestVisuals(
  scene: { title: string; text: string },
  context: AudienceContext,
  presentationId: string | null,
): Promise<
  | { ok: true; suggestions: { description: string; placement: string; altText: string }[] }
  | { ok: false; error: string }
> {
  if (!isAiConfigured()) {
    return { ok: false, error: "AI isn't configured on this deployment." };
  }

  const result = await generateStructured({
    schema: VisualSuggestion,
    toolName: "suggest_visuals",
    toolDescription: "Suggest images that would strengthen a scene.",
    system: `${BASE_SYSTEM}

Suggest images only where a picture does work that words cannot. Describe each one concretely enough to search for or commission. Never suggest generic stock imagery of people shaking hands or looking at laptops.`,
    prompt: `${contextLine(context)}

Scene: ${scene.title}
${scene.text}`,
    temperature: 0.8,
    maxTokens: 1000,
  });

  await recordGeneration("visuals", scene.title, presentationId, toRecord(result));

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, suggestions: result.data.suggestions };
}

function toRecord<T>(result: StructuredResult<T>) {
  return result.ok
    ? { status: "succeeded" as const, model: result.model, usage: result.usage }
    : {
        status:
          result.reason === "invalid_output" ? ("invalid_output" as const) : ("failed" as const),
        error: result.error,
      };
}

export { isAiConfigured };
