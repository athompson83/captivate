import "server-only";

import { complete, reserve } from "./rate-limit";
import { logFailure } from "@/lib/observability";
import { type BudgetGroup } from "@/lib/billing/plans";
import { referenceBlock, type Reference } from "@/lib/ingest/reference";
import { composeScene, mediaSlotAspect, type LayoutContent } from "@/lib/editor/layouts";
import {
  drawableScenes,
  drawingCap,
  imagePromptFor,
  replaceMediaWithDrawing,
  replaceMediaWithPhoto,
  settleCover,
} from "@/lib/editor/place-drawing";
import { fillWithGeneratedImage, fillWithStockPhoto, isPhotoFillConfigured } from "./photo-fill";
import { isImageGenerationConfigured, isStockSearchConfigured } from "./visual-sourcing";
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
  sceneName,
} from "./schemas";
import { deriveTitle, fallbackRewrite, fallbackScene, subjectOf } from "./fallback";
import { fallbackMap } from "./narrative-fallback";
import { layoutsForDeck, type AvailableEvidence, type MomentBrief } from "@/lib/narrative/generate";
import { GeneratedDiagram, compileDiagram } from "@/lib/drawing/diagram";
import { GENERATED_PER_DECK, paletteWords, pictureBrief, roomBrief } from "./look";
import { pickGenerated, shapeFor } from "./picture-plan";
import { getTheme } from "@/lib/schema/theme";
import { storeGeneratedImage } from "@/lib/data/sourced-store";
import { generateImage } from "./visual-sourcing";

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
  /**
   * A file the author handed over, read in their browser.
   *
   * It rides on the audience context because every generation that writes
   * *their* talk needs it — the map that proposes the argument and the scenes
   * that render it. A map grounded in last year's deck followed by scenes
   * that never saw it produces a presentation that argues one thing and says
   * another.
   */
  reference?: Reference | null;
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
  prompt: string,
  presentationId: string | null,
  group: BudgetGroup,
  run: () => Promise<StructuredResult<T>>,
): Promise<StructuredResult<T>> {
  // The group says what this draws on, and it is all the caller gets to say.
  // Passing the kinds separately let a caller count one pool and charge
  // another, which is how drafting an argument came to spend a deck; passing
  // the ceilings let it name its own limit, which made the plan gate above
  // this decoration. The database resolves the plan, reads its budgets and
  // checks both ceilings under one lock.
  const ticket = await reserve(kind, group, prompt, presentationId);
  if (!ticket.ok) {
    // A refusal is usually the limit doing its job, and occasionally the
    // ledger being unreachable. The two read identically to the author and
    // very differently to whoever is on call.
    logFailure(`ai.reserve.${kind}`, ticket.error);
    return { ok: false, reason: "provider_error", error: ticket.error };
  }

  const result = await run();
  if (!result.ok) logFailure(`ai.generate.${kind}`, `${result.reason}: ${result.error ?? ""}`);
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

  const result = await spend("map", prompt, null, "draft", () =>
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
- Where the author has supplied reference material, it outranks anything you already know about the subject. Shape the argument around what is actually in it — its examples, its terminology, its emphasis — and never contradict it. It is source material for a talk, not a script: proposing their file back to them in a different order is a failure.
${context.recommendedShape ? `- The chosen template recommends this shape as a starting point, which you may depart from where the subject calls for it:\n${context.recommendedShape}` : ""}`,
      prompt: `Propose the narrative map for this presentation.

${contextLine(context)}
Requested length: about ${minutes} minutes.

Evidence available in this workspace:
${evidenceLines}

Request:
${prompt}
${referenceBlock(context.reference ?? null)}`,
      // 10000, up from 4000. A map is short prose per beat, but there can be
      // eighty beats: the live ledger recorded successful maps at 4820 and
      // 5543 output tokens, which are two-attempt totals — the first attempt
      // had hit the 4000 ceiling and been cut off. When both attempts hit it,
      // the author was told their answer "didn't match the required shape"
      // and handed the structural fallback instead of their argument.
      maxTokens: 10_000,
      // /api/ai/map runs with a 300-second ceiling; two attempts fit inside it
      // with room for the reservation and the write.
      attemptTimeoutMs: 120_000,
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

  const result = await spend("moment", input.title, null, "light", () =>
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
      // /api/ai/moment runs with a 30-second ceiling.
      attemptTimeoutMs: 12_000,
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

export interface MaterialisedScene {
  title: string;
  content: SceneContent;
  speakerNotes: string;
  imagePrompt: string;
  photoQuery: string;
  /** What to diagram, where the picture should be drawn; empty for a photograph. */
  drawingBrief: string;
  /** A composed aside, ready to be woven in as a detail scene. */
  detail: { label: string; title: string; content: SceneContent; speakerNotes: string } | null;
}

export async function buildScenesFromMap(
  briefs: MomentBrief[],
  prompt: string,
  context: AudienceContext,
  presentationId: string | null,
  depth: ContentDepth = "full",
  /** The requested running time; drives how many drawings the deck earns. */
  totalSeconds = 0,
  {
    themeId = null,
    look: fixedLook = "",
  }: {
    /** The deck's theme, so generated pictures carry its palette. */
    themeId?: string | null;
    /**
     * A look the deck already has — the author's, or a previous run's. It
     * wins over whatever the writer would set, so editing the look in the
     * journey panel and regenerating gets pictures to the edited look.
     */
    look?: string;
  } = {},
): Promise<
  | {
      ok: true;
      data: {
        scenes: ({ momentId: string } & MaterialisedScene)[];
        /** The deck's visual direction, for the journey; empty from a fallback. */
        look: string;
        source: "model" | "fallback";
        notice?: string;
      };
    }
  | { ok: false; error: string }
> {
  // Composed as a deck, not moment by moment. A sequence of independently
  // best choices is what put five identical centred lines in a thirteen-scene
  // deck; `composeDeck` reads what has just been on screen. See `compose.ts`.
  const layouts = layoutsForDeck(briefs);

  if (!isAiConfigured()) {
    return {
      ok: true,
      data: {
        scenes: briefs.map((brief, index) => ({
          momentId: brief.momentId,
          ...materialiseFallback(
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
        look: "",
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

  const result = await spend("scenes", prompt, presentationId, "deck", () =>
    generateStructured({
      schema: GeneratedScenes,
      toolName: "write_scenes",
      toolDescription: "Write the content for every moment in an accepted narrative map.",
      system: `${BASE_SYSTEM}

You are writing the scenes for an argument that has already been agreed. Write exactly ${briefs.length} scenes, in order, one per moment, using the layout given for each.

Every scene must do the job its moment states. The audience takeaway is the test: if a scene does not produce it, the scene is wrong.

Where the author has supplied reference material below, write from it. Its facts, examples, numbers and terminology are the content; anything you know that it does not say is not to be stated as fact. Do not copy it out — the author already has that file and wants a talk built from it.

${
  depth === "full"
    ? `Write the presentation, not a template for one. Every field the layout displays carries finished content: body text is real prose making the moment's argument, every bullet is a complete claim someone could defend — never a label like "Key point" — and headings say something true rather than naming a topic. Speaker notes are the words to say out loud: a first-person script of three to six sentences that opens the moment, makes its case, and lands the takeaway. Nothing in any scene should need replacing before it could be presented.`
    : `Write the frame, not the talk: crisp headings, bullets of a few words each as speaking cues, body text only where a layout demands it. Speaker notes are one or two sentences stating the moment's job. The author will write the words themselves.`
}

The writing has to be worth standing in front of. The bar:
- Headings are claims or images, never topic labels. "Ninety seconds without oxygen" stops a room; "Introduction to hypoxia" empties one. If a heading could sit on any deck about this subject, it is not finished.
- The first scene is the cover: its heading is the talk's own name and it must be able to sell the talk alone — short, concrete, a little dangerous. Give it a subheading that makes a promise to the audience, and an imagePrompt for one cinematic photograph.
- Concrete beats abstract every time: a number from the evidence, a named thing, a place, a consequence — not "various factors" or "significant impact". Prefer the second-person where the subject allows it; the audience is in the room.
- Never open with throat-clearing ("In this presentation...", "Let's explore...", "It's important to note"). Open inside the material.
- Vary the texture. A statement scene is one sentence that earns its whole screen; a quote is a real voice, not a paraphrase; consecutive scenes must not share a rhythm. Read the deck as a sequence and break any run of three scenes shaped alike.
- Bullets are parallel in grammar and each one is a claim, not a topic. Two strong bullets beat five thin ones. At most four on a scene, each under twelve words, each readable in one glance; the sentence that explains it belongs in the speaker notes.
- One idea per scene. A scene that makes two points makes neither: lead with the one the takeaway names, and put the other in an aside or the notes.
- The three-second test: everything on the scene is readable from the back of the room in three seconds. The speaker carries the rest. If a scene fails it, cut words, not type size.
- One number per scene, and it is the largest thing on it. A second number belongs on its own scene or in the notes.
- A picture is evidence or metaphor, never decoration. The imagePrompt names the one thing the picture must show and what it must make the room feel; a photograph of "a hospital" shows nothing.
- The arc: open on a tension the audience already feels, build through evidence they can see, and close on the thing they will do differently — not on a summary of what was said.

Every card carries an icon, and the icon is part of the argument rather than decoration on it. Choose the one that means what the card means — \`trending-down\` for a decline, \`shield\` for a protection, \`alert-triangle\` for a risk, \`clock\` for a delay, \`stethoscope\` for an examination. Three cards on one scene should rarely share an icon; if they do, the three ideas are probably one idea. Choose only from the list the schema gives you. A takeaway, an action and a statement carry one icon of their own in \`icon\`, chosen the same way.

Points, not pages. The room leaves with three kinds of thing and the deck is built to hand them over:
- A take-home point (\`takeaway\`): one sentence the audience could repeat in the corridor, led by the icon that is its shape, with one line under it saying why it is true. Written as something to keep, not as a summary.
- A call to action (\`action\`): the heading is an imperative in the second person — what to do, when, in what situation — and each card is one concrete step with its own icon. Three steps at most; one is fine.
- A simple explanation (\`explainer\`): the heading is the whole idea in one plain sentence a newcomer would understand, and the three cards are what it is, why it happens and what follows — each a single short line. The picture beside them shows the mechanism.
- One number (\`figure\`): \`figure.value\` is the figure exactly as a room should read it ("7.6%", "1 in 4", "90 s"), \`figure.label\` is what it measures, the heading is the claim the number proves, and the body is one sentence on what to do about it. Only from the evidence you were given — never a number you are not sure of; if there is none, write the claim and leave \`figure\` empty.
Every scene's body text is at most two sentences. If an explanation needs more, it needs a picture or a second scene, not a paragraph.

Use the whole instrument. An eyebrow situates ("Module 2 · Airway"), a headingAccent carries the clause the claim turns on, cards give a three-up its three ideas, a chart's data uses the evidence's real magnitudes. A scene that uses only heading and bullets when its layout offers more reads as a form letter.

The phrase that matters: where a scene's body carries one phrase the room should leave with — the turn of the sentence, the number, the word that changes the picture — copy it exactly into \`bodyAccent\`, and it is set in the theme's accent inside the prose. Three to eight words, taken verbatim from \`body\`, on most scenes that have a body; never a whole sentence, and nothing on a scene whose body is all of equal weight.

Every scene also carries a \`title\`: three to six words naming it in the presenter's own navigator. It is the only field never drawn on stage — it is how an author finds one scene in a list of thirty — so write it on every scene and keep it short.

Each layout draws a fixed set of fields and shows nothing else, so write into the ones its layout has. A statement whose words are in \`body\` is a blank screen:

- cover, title — eyebrow, heading, headingAccent, subheading (cover also imagePrompt)
- section — eyebrow, heading
- statement — heading only. The whole idea goes in the heading; it is set large and centred.
- quote — quote, attribution. Not heading.
- bullets, closing — heading, then bullets or body (closing also subheading)
- split-left, split-right — heading, then bullets or body, and imagePrompt
- media-full — heading, caption, imagePrompt
- two-column — heading, bullets on the left and bulletsB on the right
- three-up — heading and exactly three cards, each with its own title, body and icon. Not bullets.
- chart — heading, chart, caption
- code — heading, code
- takeaway — eyebrow, icon, heading (the point), headingAccent, body (why it holds)
- action — eyebrow, heading (the imperative), up to three cards (the steps, each with an icon)
- figure — heading (the claim), figure, body
- explainer — heading (the plain-language sentence), exactly three cards (what, why, what follows), imagePrompt

The look: write \`look\`, once for the whole deck — one sentence of visual direction every generated picture will follow: the medium (documentary photography, cut paper, ink and wash, a museum diorama, an architectural model ...), the light, a recurring motif drawn from this subject, and one thing to avoid. Choose it for this talk and this audience the way an art director would, so a talk on trauma care and a talk on brand strategy do not share a look. It is the deck's, not a scene's: no scene subject in it.

Drawings: some pictures should be drawn, not photographed — a mechanism, a pathway, a comparison of amounts, a before-and-after, the parts of a thing and how they relate. For a split-left, split-right or explainer scene whose picture is one of those, write a drawingBrief: one sentence naming the parts, what each is called, and how they relate ("The heart, the vessel and the tissue in a row; blood flows heart to tissue; the vessel narrows in stage two and the flow arrow turns red"). Leave drawingBrief empty where a photograph is the right picture — a face, a place, a moment. A scene with a drawingBrief still carries its imagePrompt, for the deployment that cannot draw.

Pictures: every cover, split-left, split-right, explainer and media-full scene MUST carry an imagePrompt — the picture is half the scene, and an empty half is a broken scene. The imagePrompt describes the one image that would teach or land the moment — a mechanism, a scene, a before-and-after — concretely enough to photograph or sketch. Also give those scenes a photoQuery: two to five plain search words for a stock photo of the same subject. The cover is composed differently, and the difference is *composition* rather than abstraction. Name the one image that is this talk's hero — the subject itself is allowed and often right — but describe it as a photographer would frame it for a title: a clear focal subject somewhere off-centre, real depth behind it, and a quiet region of sky, wall, shadow or ground where a display line can sit without fighting anything. What a cover must not be is the generic establishing shot that could open any talk on the subject, or a busy frame with readable detail across all of it. An atmospheric place-and-light image is one good answer to that and not the only one; a single arresting subject with air around it is usually better.

Asides: for two to four scenes in the deck — the ones hiding a definition, a worked example, or the data behind a claim — add an aside: a small detail scene the presenter opens by clicking, off the main path. Its label names what the click reveals ("See the mechanism"). Give it a real title and either bullets or a short body, and one or two sentences of speaker notes. Most scenes have no aside; use them only where depth-on-demand genuinely helps.

Transitions: where a beat ends a movement, let the last line carry the room into what follows — from this argument, in its own words. Do not announce the next section by name, and do not add a transition sentence to scenes that are not ending a movement.

Where a moment names evidence, write only what that evidence supports. Never introduce a statistic, study or citation that was not given to you.`,
      prompt: `Original request:
${prompt}

${contextLine(context)}

The accepted narrative map:
${plan}
${
  fixedLook.trim()
    ? `
The deck's look is already set, and every picture will follow it; write it back as \`look\` unchanged: ${fixedLook.trim()}`
    : ""
}
${referenceBlock(context.reference ?? null)}`,
      maxTokens: 14000,
      // Both scene routes run at the 300-second platform ceiling, and this
      // call is followed by the drawing and photo pass. 140, up from 100: a
      // seventeen-moment deck at full depth measured 94 and 104 seconds on
      // the production ledger — seconds from the old budget cutting off a
      // deck that was about to finish. Not more, because a schema near-miss
      // is answered a second time and both attempts have to fit the route.
      attemptTimeoutMs: 140_000,
    }),
  );

  if (!result.ok) {
    return {
      ok: true,
      data: {
        scenes: briefs.map((brief, index) => ({
          momentId: brief.momentId,
          ...materialiseFallback(
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
        look: "",
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
        ...materialiseFallback(
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

  const look = fixedLook.trim() || result.data.look.trim();
  await dressScenes(scenes, presentationId, totalSeconds, { mayGenerate: true, look, themeId });

  return { ok: true, data: { source: "model", scenes, look } };
}

/**
 * Fills a generated deck's empty media slots with real pictures.
 *
 * Two sources, partitioned up front and run in parallel:
 *
 *  - **Staged drawings** for side-by-side scenes, scaled to the talk — one
 *    per ten minutes (`drawingCap`) rather than a fixed three. A drawing
 *    needs only the text model that just wrote the deck, so this works on a
 *    keyless deployment.
 *  - **Photographs** for everything else with an empty slot — the cover, any
 *    full-bleed backdrop, and side scenes past the drawing cap — when an
 *    image provider is configured. Stock first (free); the cover alone may
 *    fall back to one budget-gated generated image, because the cover *is*
 *    the deck's first impression and it degrades to a plain title otherwise.
 *
 * Bounded as before: one shared timeout, every failure leaves the
 * placeholder exactly as it was, and each drawing or paid image passes the
 * same reservation boundary a hand-prompted one does. Mutation inside the
 * race is safe — a late result that loses finds its scene already returned
 * (or its cover already settled and the placeholder gone) and its write is
 * never read. Last, covers are settled: a veil that never got its picture is
 * stripped so no deck opens on a full-screen placeholder.
 */
async function dressScenes(
  scenes: {
    title: string;
    content: SceneContent;
    imagePrompt: string;
    photoQuery?: string;
    drawingBrief?: string;
  }[],
  presentationId: string | null,
  totalSeconds: number,
  {
    /**
     * How long the whole pass may take. The deck routes run at the 300-second
     * platform ceiling and can afford 55; `/api/ai/scene` runs at 60 and has
     * already spent up to 25 writing the scene, so it asks for less.
     */
    budgetMs = 55_000,
    /**
     * Whether this pass may spend on generated pictures.
     *
     * A property of the caller, not of the layout: the single-scene route can
     * produce a cover (`GeneratedLayout` excludes only `custom`), and an author
     * asking for a title scene must not have money spent on a picture they
     * never asked for. Generating a deck is the one thing that claims this.
     * With it, up to `GENERATED_PER_DECK` photographic scenes are generated
     * to the deck's look — the cover first — and the rest are found in stock;
     * a generation that fails falls back to stock, and stock never fails to
     * generate. Without it, every picture is stock.
     */
    mayGenerate = false,
    /** The deck's visual direction; empty takes the default look. */
    look = "",
    /** The deck's theme, for the palette in words. */
    themeId = null as string | null,
  }: { budgetMs?: number; mayGenerate?: boolean; look?: string; themeId?: string | null } = {},
): Promise<void> {
  const hasEmptySlot = (content: SceneContent) =>
    content.elements.some(
      (element) => element.type === "image" && !element.url && !element.assetId,
    );

  // Two different questions, and they were being answered by one flag.
  //
  // `isPhotoFillConfigured` is true if *either* stock search or image
  // generation is configured — but generation only ever backfills the cover
  // (it is the one auto-spending image in a deck, and per-scene generation
  // would cost several times what a presentation sells for). So on a
  // deployment with an image key and no stock key, every body scene's only
  // possible picture is a drawing, while this told `drawingCap` that
  // photographs were coming and it should stay conservative. The result was
  // the reported one: a generated cover, and a twenty-minute talk carrying a
  // single drawing with every other media slot empty.
  //
  // What sizes the drawing budget is whether *scenes* can get photographs,
  // which is stock search alone.
  const stockAvailable = isStockSearchConfigured();
  const photosAvailable = isPhotoFillConfigured();
  // What a scene would draw. A drawing brief names a mechanism; a photograph's
  // prompt names a scene, and handing the second to the diagram compiler is
  // how a talk about paramedics got a stick figure beside a box. So where
  // photographs are available, only scenes briefed for a drawing get one;
  // where drawings are the only pictures there are, a scene without a brief
  // is drawn from its photograph's prompt, which is better than a grey box.
  const briefFor = (scene: { imagePrompt: string; drawingBrief?: string }) =>
    scene.drawingBrief?.trim() || (stockAvailable ? "" : scene.imagePrompt);
  const drawings = drawableScenes(
    scenes.map((scene) => ({ scene, content: scene.content, imagePrompt: briefFor(scene) })),
    drawingCap(totalSeconds, !stockAvailable),
  ).map((entry) => entry.scene);
  const drawn = new Set<unknown>(drawings);
  const photos = photosAvailable
    ? scenes.filter(
        (scene) =>
          !drawn.has(scene) && scene.imagePrompt.trim().length > 0 && hasEmptySlot(scene.content),
      )
    : [];

  // One deck, one set of pictures: a photograph already on another scene is
  // not offered again, however well it matches.
  const taken = new Set<string>();

  // Which pictures are made rather than found. Photographic scenes only —
  // anything with a drawing brief is in `drawings` already — and only the
  // caller that may spend. The look and the palette go into every prompt.
  const palette = paletteWords(getTheme(themeId));
  const generated = new Set(
    mayGenerate && isImageGenerationConfigured()
      ? pickGenerated(
          photos.map((scene) => ({ index: scenes.indexOf(scene), layout: scene.content.layout })),
          GENERATED_PER_DECK,
        ).map((index) => scenes[index])
      : [],
  );

  const jobs: Promise<void>[] = [
    ...drawings.map(async (scene) => {
      const brief = briefFor(scene);
      const result = await generateDrawing(brief, presentationId);
      if (!result.ok) return;
      const replaced = replaceMediaWithDrawing(scene.content, result.drawing, brief);
      if (replaced) scene.content = replaced;
    }),
    ...photos.map(async (scene) => {
      const slotAspect = mediaSlotAspect(scene.content.layout) ?? 16 / 9;
      let photo = generated.has(scene)
        ? await fillWithGeneratedImage(
            pictureBrief(scene.imagePrompt, look, palette),
            presentationId,
            { shape: shapeFor(slotAspect), alt: scene.imagePrompt },
          )
        : null;
      if (!photo) {
        photo = await fillWithStockPhoto(
          scene.photoQuery ?? "",
          scene.imagePrompt,
          presentationId,
          {
            slotAspect,
            taken,
          },
        );
      }
      // The cover is the one picture a deck must not open without: a cover
      // stock found nothing for is generated even when the plan above did
      // not reach it.
      if (!photo && mayGenerate && scene.content.layout === "cover" && !generated.has(scene)) {
        photo = await fillWithGeneratedImage(
          pictureBrief(scene.imagePrompt, look, palette),
          presentationId,
          { alt: scene.imagePrompt },
        );
      }
      if (!photo) return;
      const replaced = replaceMediaWithPhoto(scene.content, photo);
      if (replaced) scene.content = replaced;
    }),
  ];

  if (jobs.length > 0) {
    await Promise.race([
      Promise.allSettled(jobs),
      new Promise((resolve) => setTimeout(resolve, budgetMs)),
    ]);
  }

  for (const scene of scenes) {
    scene.content = settleCover(scene.content);
  }
}

/** The most a room may take; a route with less time left gives it less. */
export const ROOM_BUDGET_MS = 75_000;
/** Below this there is not enough time to make one and keep it. */
const ROOM_MIN_MS = 20_000;

/**
 * The room a deck stands in: one generated picture behind the whole show.
 *
 * Made to the deck's look and the theme's palette, empty at the centre and
 * out of focus (`roomBrief`), and returned as the backdrop fields the route
 * writes onto the journey — far back and dimmed, so it is a place rather
 * than a picture. Null where generation is not configured, refused, or too
 * slow: a deck without a room keeps the drawn one it had, and nothing waits
 * for a picture that is not coming.
 */
export async function dressRoom({
  title,
  look,
  themeId,
  presentationId,
  budgetMs = ROOM_BUDGET_MS,
}: {
  title: string;
  look: string;
  themeId: string | null;
  presentationId: string;
  /** What the route has left for this, at most `ROOM_BUDGET_MS`. */
  budgetMs?: number;
}): Promise<{ url: string; assetId: string; alt: string; distance: number; dim: number } | null> {
  if (!isImageGenerationConfigured()) return null;
  const budget = Math.min(ROOM_BUDGET_MS, budgetMs);
  if (budget < ROOM_MIN_MS) return null;
  const prompt = roomBrief(title, look, paletteWords(getTheme(themeId)));
  const alt = `The room behind ${title.trim() || "the presentation"}`;
  // The deadline aborts the provider call rather than racing past it: a
  // generation the route has stopped waiting for is settled as failed and
  // never stored, so nothing is paid for and left unattached.
  const deadline = AbortSignal.timeout(budget);
  const generated = await generateImage(prompt, presentationId, {
    shape: "wide",
    signal: deadline,
  });
  if (!generated.ok || deadline.aborted) return null;
  const saved = await storeGeneratedImage(generated.data, { altText: alt, presentationId });
  if (!saved.ok) return null;
  return { url: saved.data.url, assetId: saved.data.id, alt, distance: 0.85, dim: 0.5 };
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
          materialiseFallback(
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

  const result = await spend("scene", instruction, presentationId, "draft", () =>
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
      // /api/ai/scene runs with a 60-second ceiling.
      attemptTimeoutMs: 25_000,
    }),
  );

  if (!result.ok) return { ok: false, error: result.error };

  // Dressed with the same pass a whole deck gets.
  //
  // It was not, and that is why a scene added to a finished deck arrived with
  // a dashed placeholder where every scene around it had a picture: the one
  // route an author uses *after* seeing the deck was the one route that
  // skipped the step that fills them. No paid image can be spent here — the
  // generated-image fallback is the cover's alone, and a single scene is never
  // a cover — so this is a drawing or a stock photograph or nothing.
  const scene = materialise(result.data);
  await dressScenes([scene], presentationId, 0, { budgetMs: 20_000 });

  return { ok: true, data: { scenes: [scene], source: "model" } };
}

/** A structural fallback scene: no model wrote it, and none will dress it. */
function materialiseFallback(scene: GeneratedScene): MaterialisedScene {
  return materialise(scene, { deriveImagePrompt: false });
}

/**
 * Turn validated model content into a real, composed scene.
 *
 * `deriveImagePrompt` is false for the structural fallbacks. They are built
 * from the map with no model in the loop, and they return *without* passing
 * through `dressScenes` — so nothing will ever fill a slot created here, and
 * nothing will run `settleCover` to strip an unfilled one. Deriving a prompt
 * for them put an empty full-stage veil on the cover, which is a dashed
 * placeholder with the title overlapping it, and an empty frame on every side
 * scene besides. A structural deck is deliberately text: that is what it has
 * to work with.
 */
function materialise(
  scene: GeneratedScene,
  { deriveImagePrompt = true }: { deriveImagePrompt?: boolean } = {},
): MaterialisedScene {
  const imagePrompt = deriveImagePrompt ? imagePromptFor(scene) : scene.imagePrompt;
  const layoutContent: LayoutContent = {
    eyebrow: scene.eyebrow || undefined,
    // The title, when there is no heading. `title` is the scene's name in the
    // navigator and is never drawn on the stage, so a model that puts the line
    // there and nowhere else has written a scene the audience cannot see —
    // which is exactly what happened: nine of ten blank scenes in a production
    // deck were `statement` layouts whose titles were the statement ("Feedback
    // two weeks late helps no one") and whose heading was empty.
    //
    // Only as a fallback. A heading and a title are usually different lengths
    // for good reason, and the heading is the one written to be read from the
    // back of a room.
    heading: scene.heading || undefined,
    // Only as a fallback, and only where the layout has nowhere else to put
    // it — see `LayoutContent.title`.
    title: scene.title || undefined,
    headingAccent: scene.headingAccent || undefined,
    subheading: scene.subheading || undefined,
    body: scene.body || undefined,
    bodyAccent: scene.bodyAccent || undefined,
    bullets: scene.bullets.length ? scene.bullets : undefined,
    bulletsB: scene.bulletsB.length ? scene.bulletsB : undefined,
    quote: scene.quote || undefined,
    attribution: scene.attribution || undefined,
    caption: scene.caption || undefined,
    cards: scene.cards.length ? scene.cards : undefined,
    icon: scene.icon ?? undefined,
    figure: scene.figure ?? undefined,
    chart: scene.chart ?? undefined,
    code: scene.code ?? undefined,
    // A placeholder image element, so the composition is right and the user
    // only has to drop a picture in — see `imagePrompt` below for why this is
    // not conditional on the model having asked.
    media: imagePrompt ? { url: "", alt: imagePrompt } : undefined,
  };

  // An aside is a small scene of its own: heading plus either its bullets or
  // its short body, on the plainest layout. The weave gives it identity and a
  // hotspot; here it is only composed.
  const aside = scene.aside;
  const detail =
    aside && (aside.body.trim() || aside.bullets.length)
      ? {
          label: aside.label,
          title: aside.title,
          content: composeScene("bullets", {
            heading: aside.title,
            bullets: aside.bullets.length ? aside.bullets : undefined,
            body: aside.body || undefined,
          }),
          speakerNotes: aside.speakerNotes,
        }
      : null;

  return {
    // Recovered from the content where the model wrote no name — see
    // `sceneName`. A deck is not worth losing over a label in a sidebar.
    title: sceneName(scene),
    // `layoutFor` chose this layout from the moment's visual intent, before
    // the model wrote a word — so the composition may give way where the
    // content does not fit it. A person picking a layout gets what they picked.
    content: composeScene(scene.layout, layoutContent, { inferredLayout: true }),
    speakerNotes: scene.speakerNotes,
    imagePrompt,
    photoQuery: scene.photoQuery,
    drawingBrief: scene.drawingBrief,
    detail,
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
    `${mode}: ${text.slice(0, 200)}`,
    presentationId,
    "light",
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
        // /api/ai/rewrite runs with a 45-second ceiling.
        attemptTimeoutMs: 18_000,
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

  const result = await spend("speaker_notes", scene.title, presentationId, "light", () =>
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
      // /api/ai/notes runs with a 45-second ceiling.
      attemptTimeoutMs: 18_000,
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

  const result = await spend("visuals", scene.title, presentationId, "light", () =>
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
      // /api/ai/visuals runs with a 45-second ceiling.
      attemptTimeoutMs: 18_000,
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
        // The ledger gets the diagnostic detail when there is one (which
        // fields the model's answer actually got wrong); the user never
        // sees it, only the generic, actionable toast text.
        error: result.detail ?? result.error,
        // A near-miss and a truncated answer bill two full model calls. The
        // ledger recorded nothing for them, which made real spend invisible in
        // the cost record and left the limiter unable to tell a generation
        // that burned twenty thousand tokens from one the provider refused.
        usage: result.usage,
      };
}

/**
 * A picture, composed by the model and drawn by the application.
 *
 * The model is not asked for path data any more. Briefed as an illustrator
 * and handed construction recipes it still returned wobbly fragments at one
 * weight — it can reason about what goes where and cannot draw a curve. So it
 * composes a *diagram*: shapes and symbols in boxes, connected by arrows,
 * cut into stages the presenter walks through with "next". `compileDiagram`
 * turns that into strokes with recipes designed once, so every picture is
 * clean by construction and the staging — each press adds one idea — is the
 * part the model is actually good at.
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

  const result = await spend("drawing", prompt, presentationId, "drawing", () =>
    generateStructured({
      schema: GeneratedDiagram,
      toolName: "compose_diagram",
      toolDescription:
        "Compose one explainer diagram from shapes, symbols and arrows, staged in the order a person would build it at a whiteboard.",
      system: `${BASE_SYSTEM}

You compose one teaching diagram: the kind a good lecturer draws on a whiteboard while explaining. It is drawn by the application from your composition and sketched stroke by stroke in front of a room, one stage per press of "next". It sits beside the scene's text at about half the width of the screen and is read from the back of a lecture theatre.

Draw the mechanism, never the photograph. If the brief describes a scene — a person, a place, a moment — draw what it stands for: the parts, the relation, the change. A stick figure beside a box teaches nothing.

First choose the arrangement, and the application lays the nodes out for you: row (a flow or a sequence, read left to right), column (a hierarchy or a chain, top to bottom), cycle (a loop — three or four things in a ring, joined by arrows that bend around it), radial (a hub with its parts around it: the first node is the hub), compare (two columns: the first half of the nodes on the left, the rest on the right), or free (your own coordinates, for the picture none of those fit). Under any arrangement but free, leave x, y, w and h at 0; the order of the nodes is the order they are placed. Under free the canvas is 800 wide and 500 tall, positions are centres, and everything stays at least 40 from the edges.

What you place:
- Nodes. A node is a shape or a symbol. Shapes: circle, ellipse, box, pill (a container, a state, a stage); cloud (something diffuse); blob (anything organic — an organ, a population, a region); ring (a hub, a target, the centre of a cycle); bar (an amount — set value 0 to 1 for how much of it is filled); stack (several of a thing, or layers). A symbol is a named pictogram from the list the schema gives you (a heart, a brain, a person, a syringe, a building, a clock ...) for a thing with a name.
- Labels. Name what needs naming: give a node a label of one to three words, and an edge a label where the relation needs a word ("blocks", "×3", "after 90 s"). Labels are drawn beside their node in the room's own type. Most nodes carry one; a diagram with nothing named is a puzzle.
- Edges. An arrow says "leads to" or "causes"; a line says "is connected to"; a curve is an arrow that bends, for a return path or a loop; both is an exchange; dashed is a weak, indirect or broken relation; leader is a thin line that only points, for a label to a part. Edges are drawn from the edge of one node to the edge of the next, so nodes should not overlap.

Composition:
- One subject, big. The main node or nodes fill most of the canvas: a lone subject is around 300 to 380 wide, a row of three is about 180 each. Never a scatter of small things. At most 8 nodes and 8 edges.
- Read left to right or top to bottom, the way the room reads. A flow is a row; a hierarchy is a column; a cycle is a ring of three or four; a comparison is two columns; an amount is bars in a row; a before-and-after is the same shape twice with the change marked. Prefer a named arrangement to free: it is laid out better than coordinates ever are.
- Weight carries meaning: mark at most two shapes with fill (the thing the picture is about — never a symbol), mark a part that is damaged, blocked or absent with hatch, and mark the idea a stage adds with accent (the arrow that shows the flow, the part that changes). At most a quarter of the elements are accent.
- Words belong in labels, not in the picture: there is no other text.

Staging:
- 2 to 4 stages, numbered from 0. Stage 0 is the subject as the room first sees it — complete enough to recognise, with its labels. Each later stage adds exactly one idea: a mechanism, a consequence, a comparison. Give every node and edge the stage it first appears in.
- The stage labels name what each stage adds, in a few words each.
- The alt text describes the finished picture for someone who cannot see it, in one or two sentences.`,
      prompt: `Compose a diagram that explains: ${prompt}`,
      maxTokens: 6000,
      // /api/ai/visuals/draw runs with a 120-second ceiling, and the deck
      // pass runs several of these against its own 55-second race. A
      // composition is a few hundred tokens, where path data was thousands.
      attemptTimeoutMs: 40_000,
    }),
  );

  if (!result.ok) return { ok: false, error: result.error };
  const drawing = GeneratedDrawing.safeParse(compileDiagram(result.data));
  if (!drawing.success) {
    logFailure(
      "ai.generate.drawing",
      `compiled diagram failed the drawing schema: ${drawing.error.message}`,
    );
    return { ok: false, error: "The diagram couldn't be drawn. Nothing was changed." };
  }
  return { ok: true, drawing: drawing.data };
}

export { isAiConfigured };
