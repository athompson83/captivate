import type { DrawnPath, SceneContent, SceneElement } from "@/lib/schema/presentation";
import { elementId } from "./layouts";

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
 * A cover whose image never arrived degrades to the title slide beneath it.
 *
 * The veil elements carry the `veil_` id prefix `composeCover` stamped on
 * them. When the veil image is still the empty placeholder after the dress
 * pass — no provider configured, or every source failed — the whole veil is
 * stripped rather than presenting a full-screen grey placeholder as the
 * opening of someone's talk.
 */
export function settleCover(content: SceneContent): SceneContent {
  if (content.layout !== "cover") return content;
  const unfilled = content.elements.some(
    (element) =>
      element.type === "image" &&
      element.id.startsWith("veil_") &&
      !element.url &&
      !element.assetId,
  );
  if (!unfilled) return content;
  return {
    ...content,
    elements: content.elements.filter((element) => !element.id.startsWith("veil_")),
  };
}

/**
 * How many staged drawings a deck of this length deserves: one per ten
 * minutes, at least one, and bounded the way every other array here is —
 * each drawing is a full model call someone is paying for.
 */
export function drawingCap(totalSeconds: number): number {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 1;
  return Math.min(6, Math.max(1, Math.ceil(totalSeconds / 600)));
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
