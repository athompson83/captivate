import "server-only";

import { complete, LIMITS, reserve, type RateLimit } from "./rate-limit";
import { composeScene, type LayoutContent } from "@/lib/editor/layouts";
import { drawableScenes, replaceMediaWithDrawing } from "@/lib/editor/place-drawing";
import type { SceneContent } from "@/lib/schema/presentation";
import { BASE_SYSTEM, generateStructured, isAiConfigured, type StructuredResult } from "./provider";
import {
  GeneratedScene,
  GeneratedScenes,
  ProposedMap,
  RewriteResult,
  RewrittenMoment,
  SpeakerNotesResult,
  VisualSuggestion,
  REWRITE_LABELS,
  type AiKind,
  type RewriteMode,
  GeneratedDrawing,
} from "./schemas";
import { deriveTitle, fallbackRewrite, fallbackScene, subjectOf } from "./fallback";
import { fallbackMap } from "./narrative-fallback";
import { layoutFor, type AvailableEvidence, type MomentBrief } from "@/lib/narrative/generate";

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

/**
 * Runs a model call against a reservation.
 *
 * The claim is made before the call rather than recorded after it, which is
 * the whole difference: a burst of concurrent requests used to read the same
 * count and all pass, because the row the counter reads was not written until
 * the model had already answered.
 *
 * A refusal short-circuits to a failed result instead of throwing, so each
 * caller keeps the behaviour it already had when a generation fails — the
 * narrative map still degrades to its deterministic draft, the text tools
 * still surface the reason. The message says which happened.
 */
async function spend<T>(
  kind: AiKind,
  countKinds: string[],
  prompt: string,
  presentationId: string | null,
  limit: RateLimit,
  run: () => Promise<StructuredResult<T>>,
): Promise<StructuredResult<T>> {
  const ticket = await reserve(kind, countKinds, prompt, presentationId, limit);
  if (!ticket.ok) return { ok: false, reason: "provider_error", error: ticket.error };

  const result = await run();
  // Best-effort: the reservation already counts, so losing this loses cost
  // detail rather than spend protection.
  await complete(ticket.reservation, toRecord(result));
  return result;
}

function contextLine(context: AudienceContext): string {
  const parts: string[] = [];
  if (context.audience) parts.push(`Audience: ${context.audience}.`);
  if (context.tone) parts.push(`Tone: ${context.tone}.`);
  return parts.join(" ");
}

/* -------------------------------------------------------------------------- */
/* The narrative map                                                           */
/* -------------------------------------------------------------------------- */

export interface MapContext extends AudienceContext {
  /** Requested running time. Drives how time is distributed, not how many. */
  totalSeconds: number;
  /** Assets and notes the workspace holds, offered to the model by id. */
  available: AvailableEvidence[];
  /** A template's recommended argument, where one was chosen. */
  recommendedShape?: string;
}

export interface MapOutcome {
  proposal: ProposedMap;
  source: "model" | "fallback";
  notice?: string;
}

/**
 * Proposes the argument before anything is rendered.
 *
 * The model is asked for purpose and takeaway in the subject's own terms, and
 * is told explicitly that a generic open-middle-close shape is a failure when
 * the subject calls for something else — that instruction exists because it is
 * the default failure mode, not because it is a nice thing to say.
 *
 * Evidence is offered as a list of ids the workspace actually holds. Anything
 * the model returns that is not in that list is discarded downstream, so a
 * fabricated citation cannot survive into the map.
 */
export async function buildNarrativeMap(
  prompt: string,
  context: MapContext,
): Promise<{ ok: true; data: MapOutcome } | { ok: false; error: string }> {
  const minutes = Math.max(1, Math.round(context.totalSeconds / 60));
  // The subject of the request, not the request. "A 50-minute lecture on
  // sepsis for paramedic students" is a brief; "Sepsis" is a title.
  const title = deriveTitle(prompt);
  const topic = subjectOf(prompt);

  if (!isAiConfigured()) {
    return {
      ok: true,
      data: {
        proposal: fallbackMap(prompt, title, topic),
        source: "fallback",
        notice:
          "No language model is configured on this deployment, so Captivate proposed a structural argument instead. Every movement and moment is real and editable.",
      },
    };
  }

  const evidenceLines = context.available.length
    ? context.available.map((item) => `- ${item.id} (${item.kind}): ${item.label}`).join("\n")
    : "None available.";

  const result = await spend("map", ["map", "presentation"], prompt, null, LIMITS.heavy, () =>
    generateStructured({
      schema: ProposedMap,
      toolName: "propose_narrative_map",
      toolDescription:
        "Propose the argument of a presentation — its movements and moments — before any content is written.",
      system: `${BASE_SYSTEM}

You are proposing an ARGUMENT, not slides. No content is being written yet.

A movement is a stretch of the argument that does one job. A moment is a beat inside it with a specific effect on the audience.

For every moment, state:
  purpose  — why this beat exists, in terms of this subject. Never "introduce the topic".
  takeaway — what the audience should understand, feel, question or remember afterwards, written as the audience would say it.

Rules:
- Choose a shape that suits the subject. A generic opening / three points / summary structure is a failure unless the subject genuinely calls for it.
- Do not repeat the same role sequence in every movement.
- The presentation runs about ${minutes} minutes. Use weights to say which parts deserve more of it.
- Reference evidence ONLY by an id from the list you are given, and only where that source genuinely supports the claim. Never invent an id, a statistic or a citation. Leave evidenceIds empty when nothing supports it.
${context.recommendedShape ? `- The chosen template recommends this shape as a starting point, which you may depart from where the subject calls for it:\n${context.recommendedShape}` : ""}`,
      prompt: `Propose the narrative map for this presentation.

${contextLine(context)}
Requested length: about ${minutes} minutes.

Evidence available in this workspace:
${evidenceLines}

Request:
${prompt}`,
      maxTokens: 4000,
    }),
  );

  if (!result.ok) {
    return {
      ok: true,
      data: {
        proposal: fallbackMap(prompt, title, topic),
        source: "fallback",
        notice: `${result.error} Captivate proposed a structural argument instead — you can regenerate once it's available.`,
      },
    };
  }

  return { ok: true, data: { proposal: result.data, source: "model" } };
}

/**
 * Rewrites one moment's proposal.
 *
 * Scoped deliberately: it returns a title, a purpose and a takeaway, and the
 * caller applies them to one moment. It cannot renumber, reassign or replace
 * anything else, so a rewrite can never quietly restructure an argument the
 * author has already settled.
 */
export async function rewriteMoment(input: {
  title: string;
  role: string;
  purpose: string;
  takeaway: string;
  movementPurpose: string;
}): Promise<
  { ok: true; data: RewrittenMoment & { notice?: string } } | { ok: false; error: string }
> {
  if (!isAiConfigured()) {
    return {
      ok: false,
      error: "No language model is configured on this deployment, so moments can't be rewritten.",
    };
  }

  const result = await spend("moment", ["moment", "rewrite"], input.title, null, LIMITS.light, () =>
    generateStructured({
      schema: RewrittenMoment,
      toolName: "rewrite_moment",
      toolDescription: "Propose a sharper version of one beat of an argument.",
      system: `${BASE_SYSTEM}

Rewrite ONE beat of an argument. Keep its role — it has a job to do in the shape around it.

Make the purpose specific to this subject: "introduce the topic" is a failure. Write the takeaway as the audience would say it afterwards.`,
      prompt: `The movement this beat belongs to exists to: ${input.movementPurpose || "(not stated)"}

Current beat
  role: ${input.role}
  title: ${input.title || "(untitled)"}
  purpose: ${input.purpose || "(not stated)"}
  takeaway: ${input.takeaway || "(not stated)"}

Propose a sharper version.`,
      maxTokens: 800,
    }),
  );

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: result.data };
}

/* -------------------------------------------------------------------------- */
/* Scenes                                                                      */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Scenes                                                                      */
/* -------------------------------------------------------------------------- */

export interface SceneOutcome {
  scenes: { title: string; content: SceneContent; speakerNotes: string; imagePrompt: string }[];
  source: "model" | "fallback";
  notice?: string;
}

/**
 * Writes scenes from an accepted narrative map.
 *
 * Each request carries the moment's own definition *and* the argument around
 * it — the movement it belongs to, what came before, what comes next, and
 * whether it ends a movement. That is what lets a transition be written from
 * the actual turn in the argument rather than from a sentence stamped onto
 * every scene, and it is why the map is the contract rather than a picture.
 *
 * Layout is chosen by the application from the moment's visual intent, not by
 * the model: intent survives a redesign of the layout engine and a named
 * template does not.
 */
/**
 * How much writing the generator should do.
 *
 * `full` writes the presentation — complete prose, substantive bullets and a
 * speakable script per scene. `outline` writes the frame: headings and short
 * cues for an author who wants to put the words in themselves. The narrative
 * map is identical either way; depth only changes how much of each beat is
 * written down.
 */
export type ContentDepth = "outline" | "full";

export async function buildScenesFromMap(
  briefs: MomentBrief[],
  prompt: string,
  context: AudienceContext,
  presentationId: string | null,
  depth: ContentDepth = "full",
): Promise<
  | {
      ok: true;
      data: {
        scenes: {
          momentId: string;
          title: string;
          content: SceneContent;
          speakerNotes: string;
          imagePrompt: string;
        }[];
        source: "model" | "fallback";
        notice?: string;
      };
    }
  | { ok: false; error: string }
> {
  const layouts = briefs.map((brief, index) => layoutFor(brief.visualIntent, brief.role, index));

  if (!isAiConfigured()) {
    return {
      ok: true,
      data: {
        scenes: briefs.map((brief, index) => ({
          momentId: brief.momentId,
          ...materialise(
            fallbackScene(
              {
                title: brief.title,
                purpose: brief.purpose,
                layout: layouts[index],
                takeaway: brief.takeaway,
                instructions: brief.instructions,
                evidence: brief.evidence,
                movementTitle: brief.movementTitle,
              },
              { title: brief.movementTitle, prompt },
            ),
          ),
        })),
        source: "fallback",
        notice:
          "No language model is configured, so these scenes are structural placeholders. The argument behind them is real.",
      },
    };
  }

  const plan = briefs
    .map((brief, index) => {
      const evidence = brief.evidence.length
        ? brief.evidence.map((item) => item.label || item.id).join("; ")
        : "none";
      return [
        `${index + 1}. [${brief.movementLabel}] ${brief.title} — role: ${brief.role}`,
        `   purpose: ${brief.purpose}`,
        `   audience takeaway: ${brief.takeaway}`,
        `   about ${Math.max(5, brief.estimatedSeconds)} seconds; layout: ${layouts[index]}`,
        `   grounded by: ${evidence}`,
        brief.instructions ? `   author's instruction: ${brief.instructions}` : null,
        brief.endsMovement && brief.nextMovementLabel
          ? `   this beat ends the "${brief.movementLabel}" movement; "${brief.nextMovementLabel}" follows`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const result = await spend(
    "scenes",
    ["scenes", "presentation"],
    prompt,
    presentationId,
    LIMITS.heavy,
    () =>
      generateStructured({
        schema: GeneratedScenes,
        toolName: "write_scenes",
        toolDescription: "Write the content for every moment in an accepted narrative map.",
        system: `${BASE_SYSTEM}

You are writing the scenes for an argument that has already been agreed. Write exactly ${briefs.length} scenes, in order, one per moment, using the layout given for each.

Every scene must do the job its moment states. The audience takeaway is the test: if a scene does not produce it, the scene is wrong.

${
  depth === "full"
    ? `Write the presentation, not a template for one. Every field the layout displays carries finished content: body text is real prose making the moment's argument, every bullet is a complete claim someone could defend — never a label like "Key point" — and headings say something true rather than naming a topic. Speaker notes are the words to say out loud: a first-person script of three to six sentences that opens the moment, makes its case, and lands the takeaway. Nothing in any scene should need replacing before it could be presented.`
    : `Write the frame, not the talk: crisp headings, bullets of a few words each as speaking cues, body text only where a layout demands it. Speaker notes are one or two sentences stating the moment's job. The author will write the words themselves.`
}

Transitions: where a beat ends a movement, let the last line carry the room into what follows — from this argument, in its own words. Do not announce the next section by name, and do not add a transition sentence to scenes that are not ending a movement.

Where a moment names evidence, write only what that evidence supports. Never introduce a statistic, study or citation that was not given to you.

Craft, not template-filling:
- Use the whole instrument. An eyebrow situates ("Module 2 · Airway"), a headingAccent carries the clause the claim turns on, cards give a three-up its three ideas, a chart's data uses the evidence's real magnitudes. A scene that uses only heading and bullets when its layout offers more reads as a form letter.
- Never open with throat-clearing ("In this presentation...", "Let's explore...", "It's important to note"). Open inside the material.
- Bullets are parallel in grammar and each one is a claim, not a topic. Two strong bullets beat five thin ones.
- For a scene with an image slot, imagePrompt describes a single clear line drawing that would teach the moment — a mechanism, a pathway, a before-and-after — not a mood photograph. It will be sketched as staged line art in front of the audience.`,
        prompt: `Original request:
${prompt}

${contextLine(context)}

The accepted narrative map:
${plan}`,
        maxTokens: 12000,
      }),
  );

  if (!result.ok) {
    return {
      ok: true,
      data: {
        scenes: briefs.map((brief, index) => ({
          momentId: brief.momentId,
          ...materialise(
            fallbackScene(
              {
                title: brief.title,
                purpose: brief.purpose,
                layout: layouts[index],
                takeaway: brief.takeaway,
                instructions: brief.instructions,
                evidence: brief.evidence,
                movementTitle: brief.movementTitle,
              },
              { title: brief.movementTitle, prompt },
            ),
          ),
        })),
        source: "fallback",
        notice: `${result.error} Captivate built structural scenes from your map instead.`,
      },
    };
  }

  // The model may return the wrong count; the map decides how many there are.
  const written = result.data.scenes;
  const scenes = briefs.map((brief, index) => {
    const scene = written[index];
    if (!scene) {
      return {
        momentId: brief.momentId,
        ...materialise(
          fallbackScene(
            {
              title: brief.title,
              purpose: brief.purpose,
              layout: layouts[index],
              takeaway: brief.takeaway,
              instructions: brief.instructions,
              evidence: brief.evidence,
              movementTitle: brief.movementTitle,
            },
            { title: brief.movementTitle, prompt },
          ),
        ),
      };
    }
    return {
      momentId: brief.momentId,
      ...materialise({ ...scene, layout: layouts[index] }),
    };
  });

  await drawSceneVisuals(scenes, presentationId);

  return { ok: true, data: { source: "model", scenes } };
}

/**
 * Fills a generated deck's empty media slots with staged drawings.
 *
 * The deck used to arrive with image placeholders waiting for a photograph —
 * which needs a paid image provider the deployment may not have configured,
 * so "generate a presentation" produced a deck with grey boxes in it. A
 * drawing needs only the text model that just wrote the deck.
 *
 * Deliberately bounded: at most three drawings, side-by-side layouts only
 * (a full-bleed backdrop wants a photograph, not line art under text), in
 * parallel, and every failure leaves the placeholder exactly as it was —
 * the author can still source an image by hand. Each drawing passes the
 * same reservation and schema boundary a hand-prompted one does.
 */
async function drawSceneVisuals(
  scenes: { title: string; content: SceneContent; imagePrompt: string }[],
  presentationId: string | null,
): Promise<void> {
  const candidates = drawableScenes(scenes);
  if (candidates.length === 0) return;

  // The pass is a bonus, not the deliverable: past this bound the deck ships
  // with its placeholders and the author draws by hand. Mutation inside the
  // race is safe — a late drawing that loses simply finds its scene already
  // returned and its write is never read.
  await Promise.race([
    Promise.allSettled(
      candidates.map(async (scene) => {
        const drawn = await generateDrawing(scene.imagePrompt, presentationId);
        if (!drawn.ok) return;
        const replaced = replaceMediaWithDrawing(scene.content, drawn.drawing, scene.imagePrompt);
        if (replaced) scene.content = replaced;
      }),
    ),
    new Promise((resolve) => setTimeout(resolve, 55_000)),
  ]);
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

  const result = await spend("scene", ["scene"], instruction, presentationId, LIMITS.heavy, () =>
    generateStructured({
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
      maxTokens: 2000,
    }),
  );

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

  const result = await spend(
    "rewrite",
    ["rewrite"],
    `${mode}: ${text.slice(0, 200)}`,
    presentationId,
    LIMITS.light,
    () =>
      generateStructured({
        schema: RewriteResult,
        toolName: "rewrite_text",
        toolDescription: "Return rewritten versions of a piece of presentation text.",
        system: `${BASE_SYSTEM}

You are editing text that appears on a slide, so brevity matters more than completeness. Return ${mode === "alternatives" ? "three" : "one"} option${mode === "alternatives" ? "s" : ""}. Never add facts that were not in the original.`,
        prompt: `${REWRITE_LABELS[mode].instruction}

${contextLine(context)}

Text:
${text}`,
        maxTokens: 1200,
      }),
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

  const result = await spend(
    "speaker_notes",
    ["speaker_notes"],
    scene.title,
    presentationId,
    LIMITS.light,
    () =>
      generateStructured({
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
        maxTokens: 1200,
      }),
  );

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

  const result = await spend(
    "visuals",
    ["visuals"],
    scene.title,
    presentationId,
    LIMITS.light,
    () =>
      generateStructured({
        schema: VisualSuggestion,
        toolName: "suggest_visuals",
        toolDescription: "Suggest images that would strengthen a scene.",
        system: `${BASE_SYSTEM}

Suggest images only where a picture does work that words cannot. Describe each one concretely enough to search for or commission. Never suggest generic stock imagery of people shaking hands or looking at laptops.`,
        prompt: `${contextLine(context)}

Scene: ${scene.title}
${scene.text}`,
        maxTokens: 1000,
      }),
  );

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

/**
 * A picture the model draws as ordered vector strokes, cut into stages the
 * presenter walks through with "next".
 *
 * The prompt work is all in the staging: a drawing that arrives as one
 * undifferentiated pile of paths animates fine and *teaches* nothing. Each
 * stage must add one idea, in the order a person at a whiteboard would build
 * it, because the stage boundaries become the presenter's pauses.
 */
export async function generateDrawing(
  prompt: string,
  presentationId: string | null,
): Promise<{ ok: true; drawing: GeneratedDrawing } | { ok: false; error: string }> {
  if (!isAiConfigured()) {
    return {
      ok: false,
      error: "AI isn't configured on this deployment, so drawings can't be generated.",
    };
  }

  const result = await spend("drawing", ["drawing"], prompt, presentationId, LIMITS.heavy, () =>
    generateStructured({
      schema: GeneratedDrawing,
      toolName: "draw_picture",
      toolDescription:
        "Return a line drawing as SVG path data, staged in the order a person would sketch it.",
      system: `${BASE_SYSTEM}

You draw single-colour line art that will be sketched stroke by stroke in front of an audience, one stage per press of "next". Rules:

- Return only SVG path data (the d attribute) — absolute commands preferred. No markup, no colours, no fills: strokes on nothing.
- Plan the stages first. Each stage adds exactly one idea, in the order a teacher at a whiteboard would build the picture; 2 to 8 stages, labelled. Number stages from 0; stage 0 is what appears on arrival.
- Within a stage, order paths as they would be drawn by hand.
- Aim for 20 to 120 paths total. Prefer fewer, longer, confident strokes over many fragments.
- Never render words as paths — lettering drawn at stroke weight is illegible. Leave space for the author's own text instead, and say what goes where in the stage label.
- Use a viewBox around 800×500 unless the subject wants otherwise, and keep the drawing clear of the very edges.
- The alt text describes the finished picture for someone who cannot see it.`,
      prompt: `Draw: ${prompt}`,
      maxTokens: 16000,
    }),
  );

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, drawing: result.data };
}

export { isAiConfigured };
