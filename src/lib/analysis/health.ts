import type { PresentationDocument, SceneElement } from "@/lib/schema/presentation";
import { getTheme } from "@/lib/schema/theme";
import { contrastRatio } from "@/lib/utils/color";
import { balance, pacingOf, wordsOn, type Pacing } from "./pacing";

/**
 * Presentation health.
 *
 * A score is only worth showing if it can be argued with, so every check states
 * what it measured, what it wanted, and what to do — and the score is nothing
 * more than the weighted mean of the checks. There is no secret formula.
 *
 * The checks are chosen for one property: each one is something a presenter
 * would actually change their deck over. "Two of your eleven images have no alt
 * text" is a fix. "Your engagement score is 71" is not, so nothing here says
 * anything of the kind.
 */

export type CheckStatus = "pass" | "warn" | "fail";

export interface HealthCheck {
  id: string;
  label: string;
  status: CheckStatus;
  /** One line stating what was found. Always concrete. */
  detail: string;
  /** What to do about it, where there is something to do. */
  fix?: string;
  /** How much this check counts toward the score. */
  weight: number;
}

export interface Health {
  /** 0..100. The weighted mean of the checks, nothing more. */
  score: number;
  grade: "Excellent" | "Good" | "Needs work";
  checks: HealthCheck[];
  pacing: Pacing;
}

/** Above this many words on one scene, the room reads instead of listening. */
const DENSE_WORDS = 60;

/** WCAG AA for large text. Scene type is large by definition. */
const MIN_CONTRAST = 3;

const STATUS_VALUE: Record<CheckStatus, number> = { pass: 1, warn: 0.5, fail: 0 };

function mediaElements(elements: SceneElement[]) {
  return elements.filter(
    (element) => !element.hidden && (element.type === "image" || element.type === "video"),
  );
}

export function analyse(doc: PresentationDocument): Health {
  const { scenes: allScenes, sections, presentation } = doc;
  const pacing = pacingOf(allScenes, sections);

  /**
   * Analysis says what it measured, and what it measures is the argument.
   *
   * A detail scene is an aside behind a hotspot: it may never be opened, it is
   * not a beat of the running order, and it does not need speaker notes for a
   * stretch of talk it is not part of. Counting asides made a deck report more
   * scenes than it has, dragged the notes score down for notes nobody needed,
   * and — because a detail scene can carry a different section id — split one
   * movement into two in the structure check.
   *
   * Rendering checks that are about a scene in isolation (contrast, alt text,
   * a wall of text) still look at every scene, aside or not: those are true of
   * anything an audience can end up looking at.
   */
  const scenes = allScenes.filter((scene) => scene.flowRole !== "detail");

  /**
   * An empty presentation is not healthy, and most checks pass vacuously on
   * one: "no scene is a wall of text" is true and meaningless with no scenes.
   * Scoring it on those passes reported an empty deck as Good, so it gets its
   * own answer rather than a fudged set of weights.
   */
  if (scenes.length === 0) {
    return {
      score: 0,
      grade: "Needs work",
      pacing,
      checks: [
        {
          id: "structure",
          label: "Narrative structure",
          status: "fail",
          detail: "No scenes yet.",
          fix: "Add a scene, or generate a starting structure from a prompt.",
          weight: 1,
        },
      ],
    };
  }

  const checks: HealthCheck[] = [];

  /* Structure ------------------------------------------------------------- */

  const movementCount = pacing.movements.filter((m) => m.label).length;
  checks.push({
    id: "structure",
    label: "Narrative structure",
    weight: 1.5,
    ...(movementCount === 0
      ? {
          status: "warn" as const,
          detail: `${scenes.length} scenes, no movements.`,
          fix: "Group scenes into movements so the room can see the shape of the argument.",
        }
      : movementCount < 3
        ? {
            status: "warn" as const,
            detail: `${movementCount} movement${movementCount === 1 ? "" : "s"} across ${scenes.length} scenes.`,
            fix: "Most arguments have at least an opening, a middle and a close.",
          }
        : {
            status: "pass" as const,
            detail: `${movementCount} movements across ${scenes.length} scenes.`,
          }),
  });

  /* Pacing ---------------------------------------------------------------- */

  const evenness = balance(pacing);
  const longest = [...pacing.movements].sort((a, b) => b.seconds - a.seconds)[0];
  checks.push({
    id: "pacing",
    label: "Balanced pacing",
    weight: 1,
    ...(pacing.movements.length < 2
      ? { status: "pass" as const, detail: "Too short to be unbalanced." }
      : evenness >= 0.7
        ? { status: "pass" as const, detail: "Time is spread evenly across the movements." }
        : {
            status: evenness >= 0.45 ? ("warn" as const) : ("fail" as const),
            detail: `"${longest?.label || "One movement"}" takes ${Math.round((longest?.share ?? 0) * 100)}% of the time.`,
            fix: "Split it, or move some of its material into the movements around it.",
          }),
  });

  /* Density --------------------------------------------------------------- */

  // Every scene an audience can end up looking at, asides included — a wall of
  // text is a wall of text whether it was reached by advancing or by clicking.
  const dense = allScenes.filter((scene) => wordsOn(scene.content.elements) > DENSE_WORDS);
  checks.push({
    id: "density",
    label: "Readable scenes",
    weight: 1.25,
    ...(dense.length === 0
      ? { status: "pass" as const, detail: "No scene is a wall of text." }
      : {
          status:
            dense.length <= Math.max(1, allScenes.length * 0.15)
              ? ("warn" as const)
              : ("fail" as const),
          detail: `${dense.length} scene${dense.length === 1 ? "" : "s"} over ${DENSE_WORDS} words.`,
          fix: "A room reads or listens, not both. Move the detail into your lecture notes.",
        }),
  });

  /* Contrast -------------------------------------------------------------- */

  // The theme's own pairs, and only those. A scene may carry a solid
  // background and a run may carry a colour override, and neither is walked
  // here — so the detail line says which of those it looked at. A ratio that
  // reads like a verdict on the deck, when it is a verdict on the palette, is
  // the failure this file's rule exists to prevent.
  const theme = getTheme(presentation.themeId);
  const inkOnCanvas = contrastRatio(theme.tokens.ink, theme.tokens.canvas);
  const accentOnCanvas = contrastRatio(theme.tokens.accent, theme.tokens.canvas);
  const worst = Math.min(inkOnCanvas, accentOnCanvas);
  checks.push({
    id: "contrast",
    label: "Legible from the back",
    weight: 1.25,
    ...(worst >= MIN_CONTRAST
      ? {
          status: "pass" as const,
          detail: `The theme puts text at ${inkOnCanvas.toFixed(1)}:1 against its background. Per-scene backgrounds and colour overrides are not measured.`,
        }
      : {
          status: worst >= 2.2 ? ("warn" as const) : ("fail" as const),
          detail: `The theme's lowest contrast is ${worst.toFixed(1)}:1, under the ${MIN_CONTRAST}:1 needed for large text. Per-scene backgrounds and colour overrides are not measured.`,
          fix: "Choose a theme with more separation between text and background.",
        }),
  });

  /* Alt text -------------------------------------------------------------- */

  const media = allScenes.flatMap((scene) => mediaElements(scene.content.elements));
  const described = media.filter(
    (element) => (element.type === "image" || element.type === "video") && element.alt.trim(),
  );
  checks.push({
    id: "alt-text",
    label: "Media described",
    weight: 1,
    ...(media.length === 0
      ? { status: "pass" as const, detail: "No media to describe." }
      : described.length === media.length
        ? {
            status: "pass" as const,
            detail: `All ${media.length} images and videos have alt text.`,
          }
        : {
            status: described.length >= media.length / 2 ? ("warn" as const) : ("fail" as const),
            detail: `${media.length - described.length} of ${media.length} have no alt text.`,
            fix: "Describe what the picture is doing in the argument, not what it depicts.",
          }),
  });

  /* Speaker notes --------------------------------------------------------- */

  const withNotes = scenes.filter((scene) => scene.speakerNotes.trim().length > 0);
  checks.push({
    id: "notes",
    label: "Prepared to speak",
    weight: 0.75,
    ...(withNotes.length >= scenes.length * 0.6
      ? {
          status: "pass" as const,
          detail: `${withNotes.length} of ${scenes.length} scenes have speaker notes.`,
        }
      : {
          status: withNotes.length > 0 ? ("warn" as const) : ("fail" as const),
          detail: `${withNotes.length} of ${scenes.length} scenes have speaker notes.`,
          fix: "Notes are what you say, not what is on the scene. They never reach the room.",
        }),
  });

  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.reduce((sum, check) => sum + STATUS_VALUE[check.status] * check.weight, 0);
  const score = totalWeight === 0 ? 0 : Math.round((earned / totalWeight) * 100);

  return {
    score,
    grade: score >= 85 ? "Excellent" : score >= 65 ? "Good" : "Needs work",
    checks,
    pacing,
  };
}
