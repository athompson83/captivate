import type { DrawnPath, SceneContent, SceneElement, SceneLayout } from "@/lib/schema/presentation";
import { elementId, layoutSlots } from "./layouts";

/**
 * Re-exported rather than defined here: `settleCover` moved to `layouts.ts`,
 * beside the composition it corrects, so `relayoutScene` can apply it without
 * this module and that one importing each other.
 */
export { settleCover } from "./layouts";

/**
 * The most presses a drawing may cost to finish.
 *
 * Stage 0 is on the scene when the author arrives, so four stages is three
 * presses. The model was asked for "2 to 8" and took the invitation: a picture
 * could eat eight advances on its own, which stops being a build and starts
 * being an obstacle between the presenter and their next point. Three presses
 * is a beat, a development and a conclusion — enough to build an idea in front
 * of a room, few enough that nobody is clicking a picture into existence while
 * an audience waits.
 */
export const MAX_DRAWING_STAGES = 4;

/** Every number in a path's data. A coordinate is always one of these. */
const NUMBER = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;

/**
 * The box that actually contains the ink.
 *
 * Approximate, and deliberately so in the safe direction: it takes *every*
 * number in the path data, which for a curve includes its control points. A
 * Bézier is contained by the hull of its control points, so the result is a
 * superset of the true bounds — it can be slightly too generous, never too
 * tight, and too tight is the one that would shave a stroke off.
 *
 * Arc flags are counted as coordinates too, which is the same harmless kind of
 * wrong: they are 0 or 1, well inside any real drawing's extent.
 */
function inkBounds(paths: readonly { d: string }[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let sawPair = false;

  for (const path of paths) {
    const numbers = path.d.match(NUMBER);
    if (!numbers) continue;
    // Pairwise, because path data is a stream of x,y coordinates. An odd
    // trailing number (H and V take one) is skipped rather than guessed at.
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      const x = Number(numbers[i]);
      const y = Number(numbers[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      sawPair = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  return sawPair ? { minX, minY, maxX, maxY } : null;
}

/**
 * Makes a generated drawing safe to place, without discarding any of it.
 *
 * Two things a model gets wrong that the document cannot carry.
 *
 * **Ink outside the declared viewBox.** The picture is placed in a frame and
 * the frame is where it belongs, but nothing made the paths stay inside the
 * box the model said they were in — and the renderer drew them anyway, over
 * whatever the scene had there. A chart with two drawing fragments floating
 * across it is what that looks like from the room. The viewBox is widened to
 * contain the ink rather than the ink being clipped to the viewBox: clipping
 * would silently amputate a picture, and a drawing missing a limb is worse
 * than one drawn slightly small.
 *
 * **More stages than a presenter can spend.** See `MAX_DRAWING_STAGES`. The
 * distinct stages are compressed onto the allowed range in order, so a picture
 * built in eight steps still builds in the same sequence — it just arrives in
 * four. Labels are compressed with them, joined so nothing an author wrote is
 * thrown away.
 */
export function normaliseDrawing<
  T extends {
    viewBox: { width: number; height: number };
    paths: DrawnPath[];
    stageLabels: string[];
  },
>(drawing: T): T {
  // ---- The box, widened to hold every stroke -------------------------------
  let viewBox = drawing.viewBox;
  const bounds = inkBounds(drawing.paths);
  if (bounds) {
    // Only ever grown, and only from the origin outwards: shifting the box
    // would move the picture within its frame, and the model composed it
    // where it meant to. Negative coordinates are the one case that needs the
    // origin moved, and there the shift is exactly what keeps the ink visible.
    const width = Math.max(drawing.viewBox.width, bounds.maxX);
    const height = Math.max(drawing.viewBox.height, bounds.maxY);
    viewBox = {
      width: Math.min(4000, Math.max(1, Math.ceil(width))),
      height: Math.min(4000, Math.max(1, Math.ceil(height))),
    };
  }

  // ---- The stages, compressed onto what a presenter will spend -------------
  const distinct = [...new Set(drawing.paths.map((path) => path.stage))].sort((a, b) => a - b);
  if (distinct.length <= MAX_DRAWING_STAGES) {
    return { ...drawing, viewBox };
  }

  // Which of the allowed stages each original stage folds into. Proportional,
  // so an eight-stage picture becomes two original stages per press rather
  // than seven crammed into the first and one into the last.
  const foldedTo = new Map<number, number>();
  for (const [index, stage] of distinct.entries()) {
    foldedTo.set(stage, Math.floor((index * MAX_DRAWING_STAGES) / distinct.length));
  }

  const labels: string[] = [];
  for (const [index, stage] of distinct.entries()) {
    const target = foldedTo.get(stage)!;
    const label = drawing.stageLabels[index]?.trim();
    if (!label) continue;
    labels[target] = labels[target] ? `${labels[target]}, ${label}` : label;
  }

  return {
    ...drawing,
    viewBox,
    paths: drawing.paths.map((path) => ({ ...path, stage: foldedTo.get(path.stage) ?? 0 })),
    stageLabels: labels.map((label) => (label ?? "").slice(0, 120)),
  };
}

/**
 * Swaps a generated scene's empty media placeholder for a drawing.
 *
 * A deck written by the model used to arrive with image slots that were
 * *empty* — the placeholder waited for a photograph that needed a paid
 * provider key the deployment may not have. A drawing needs only the text
 * model that just wrote the deck, so the media slot can arrive with a real
 * staged illustration in it instead of a grey box.
 *
 * Pure and narrow on purpose: it touches exactly one element — the untouched
 * placeholder the layout composer created (an image with no url and no
 * asset) — and returns null rather than guessing when there isn't one. An
 * author's own image, however it got there, is never replaced.
 */
export function replaceMediaWithDrawing(
  content: SceneContent,
  drawing: {
    viewBox: { width: number; height: number };
    paths: DrawnPath[];
    stageLabels: string[];
    alt: string;
  },
  prompt: string,
): SceneContent | null {
  const index = content.elements.findIndex(
    (element) => element.type === "image" && !element.url && !element.assetId,
  );
  if (index === -1) return null;

  const placeholder = content.elements[index] as Extract<SceneElement, { type: "image" }>;
  // Bounded before it is placed, not after: an unbounded drawing renders over
  // its neighbours, and by then it is in somebody's document.
  const safe = normaliseDrawing(drawing);
  const element: SceneElement = {
    id: elementId("drawing"),
    type: "drawing",
    frame: placeholder.frame,
    viewBox: safe.viewBox,
    paths: safe.paths,
    stageLabels: safe.stageLabels,
    ink: "ink",
    strokeWidth: 2,
    paceSeconds: 1.6,
    prompt: prompt.slice(0, 1000),
    alt: safe.alt || placeholder.alt,
    hidden: false,
    locked: false,
    opacity: 1,
    hotspot: null,
    animation: placeholder.animation,
  };

  const elements = [...content.elements];
  elements[index] = element;
  return { ...content, elements };
}

/**
 * Fills a scene's empty media placeholder with a sourced photograph.
 *
 * Patches in place rather than replacing the element, so everything the
 * composition decided — frame, scrim, entrance, and on a cover the exit that
 * lifts the veil — survives the picture arriving. Same one-placeholder rule
 * as the drawing swap: an author's own image is never touched.
 */
export function replaceMediaWithPhoto(
  content: SceneContent,
  photo: { url: string; assetId: string; alt: string },
): SceneContent | null {
  const index = content.elements.findIndex(
    (element) => element.type === "image" && !element.url && !element.assetId,
  );
  if (index === -1) return null;

  const placeholder = content.elements[index] as Extract<SceneElement, { type: "image" }>;
  const elements = [...content.elements];
  elements[index] = {
    ...placeholder,
    url: photo.url,
    assetId: photo.assetId,
    alt: photo.alt || placeholder.alt,
  };
  return { ...content, elements };
}

/**
 * How many staged drawings a deck of this length deserves: one per ten
 * minutes, at least one, and bounded the way every other array here is —
 * each drawing is a full model call someone is paying for.
 *
 * Unless drawings are the only pictures available. A deployment with no stock
 * or image key has exactly one source of imagery, and at one per ten minutes a
 * twenty-scene deck came back with two drawings and eighteen empty slots — the
 * author's report was "no good images, just a couple okay drawing animations",
 * which is precisely what this cap produces when nothing else can fill in
 * behind it. So the rate doubles and the ceiling rises when there is no
 * alternative, and stays where it was when photographs are doing the rest.
 */
export function drawingCap(totalSeconds: number, soleSource = false): number {
  const perSeconds = soleSource ? 300 : 600;
  const ceiling = soleSource ? 10 : 6;
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 1;
  return Math.min(ceiling, Math.max(1, Math.ceil(totalSeconds / perSeconds)));
}

/**
 * Which generated scenes deserve a drawing.
 *
 * Side-by-side layouts with an untouched placeholder and a real prompt, at
 * most `cap` of them: a full-bleed backdrop — media-full or a cover's veil —
 * wants a photograph rather than line art under text, a slot that already has
 * media belongs to its author, and every drawing is a model call someone is
 * paying for.
 */
export function drawableScenes<T extends { content: SceneContent; imagePrompt: string }>(
  scenes: T[],
  cap = 3,
): T[] {
  return scenes
    .filter(
      (scene) =>
        scene.imagePrompt.trim().length > 0 &&
        scene.content.layout !== "media-full" &&
        scene.content.layout !== "cover" &&
        scene.content.elements.some(
          (element) => element.type === "image" && !element.url && !element.assetId,
        ),
    )
    .slice(0, cap);
}

/**
 * The picture a scene needs, whether or not the model remembered to ask.
 *
 * `layoutFor` chooses the layout before a word is written, so a scene can be a
 * `split-right` — half of it a picture — while the model wrote no image prompt
 * for it. The composition then emitted no image element at all, and
 * `drawableScenes` can only draw into a slot that exists: a twenty-minute talk
 * with a four-drawing budget came back with one drawing, and its side-by-side
 * scenes were text on one half and nothing on the other.
 *
 * So the *layout* decides whether there is a slot, and the model's prompt is
 * only the preferred description of what goes in it. The fallback is built from
 * the line the scene is actually making, which is what a person would
 * illustrate.
 *
 * Here rather than in `ai/service.ts` because that module is `server-only` and
 * this is pure layout arithmetic that a test should be able to import.
 */
export function imagePromptFor(scene: {
  imagePrompt: string;
  layout: SceneLayout;
  heading?: string;
  title?: string;
  body?: string;
}): string {
  if (scene.imagePrompt.trim()) return scene.imagePrompt;
  if (!layoutSlots(scene.layout).media) return "";

  const subject = [scene.heading, scene.title, scene.body]
    .map((part) => part?.trim() ?? "")
    .find((part) => part.length > 0);
  return subject ? `A staged line drawing illustrating: ${subject}` : "";
}
