import type { Scene, SceneContent } from "@/lib/schema/presentation";

/**
 * What the audience window is allowed to receive.
 *
 * The stage route's rule is a *load* boundary, not a rendering one: presenter
 * material cannot leak onto a projector through a state bug if it was never
 * sent to that window. `PresentRoot` says exactly that about itself.
 *
 * It was not true. The route handed `getPresentationDocument`'s scenes straight
 * to a `"use client"` component, and every prop a client component receives is
 * serialised into the payload the browser downloads — so the whole deck's
 * speaker notes were sitting in the projector window's source while nothing
 * rendered them. The existing test asserted the notes were not *displayed*,
 * which is the weaker claim and the one that passed throughout.
 *
 * So the strip happens here, once, with a name, rather than inline where the
 * next person to add a prop would not see it.
 */
export function forAudience(scenes: Scene[]): Scene[] {
  return scenes.map((scene) =>
    // Rebuilt rather than spread-and-overwrite so that a field added to `Scene`
    // has to be considered here: TypeScript fails this function until it is.
    ({
      id: scene.id,
      presentationId: scene.presentationId,
      sectionId: scene.sectionId,
      position: scene.position,
      title: scene.title,
      content: contentForAudience(scene.content),
      placement: scene.placement,
      momentId: scene.momentId,
      // The one presenter-only field on a scene. Emptied, not omitted: the
      // audience surface shares its schema with the editor, and a missing
      // required field would be a parse failure rather than a privacy win.
      speakerNotes: "",
      durationSeconds: scene.durationSeconds,
      // Carried, not stripped: the stage indexes the same scene array the
      // console does, so dropping this would make the two windows disagree
      // about which scenes are in the running order.
      flowRole: scene.flowRole,
      createdAt: scene.createdAt,
      updatedAt: scene.updatedAt,
    }),
  );
}

/**
 * The element-level half of the same boundary.
 *
 * A drawing carries two authoring fields the room has no use for: the stage
 * labels the author navigated by, and the prompt that generated the picture.
 * Neither is presenter-private the way notes are, but the cheap default is
 * the strict one. Emptied rather than omitted, for the same schema-sharing
 * reason as `speakerNotes` above.
 */
function contentForAudience(content: SceneContent): SceneContent {
  if (!content.elements.some((element) => element.type === "drawing")) return content;
  return {
    ...content,
    elements: content.elements.map((element) =>
      element.type === "drawing" ? { ...element, stageLabels: [], prompt: "" } : element,
    ),
  };
}
