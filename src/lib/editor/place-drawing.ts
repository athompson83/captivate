import type { DrawnPath, SceneContent, SceneElement, SceneLayout } from "@/lib/schema/presentation";
import { elementId, layoutSlots } from "./layouts";

/**
 * Re-exported rather than defined here: `settleCover` moved to `layouts.ts`,
 * beside the composition it corrects, so `relayoutScene` can apply it without
 * this module and that one importing each other.
 */
export { settleCover } from "./layouts";

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
  const element: SceneElement = {
    id: elementId("drawing"),
    type: "drawing",
    frame: placeholder.frame,
    viewBox: drawing.viewBox,
    paths: drawing.paths,
    stageLabels: drawing.stageLabels,
    ink: "ink",
    strokeWidth: 2,
    paceSeconds: 1.6,
    prompt: prompt.slice(0, 1000),
    alt: drawing.alt || placeholder.alt,
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
