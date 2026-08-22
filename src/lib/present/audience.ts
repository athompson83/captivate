import type { Scene } from "@/lib/schema/presentation";

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
      content: scene.content,
      placement: scene.placement,
      momentId: scene.momentId,
      // The one presenter-only field on a scene. Emptied, not omitted: the
      // audience surface shares its schema with the editor, and a missing
      // required field would be a parse failure rather than a privacy win.
      speakerNotes: "",
      durationSeconds: scene.durationSeconds,
      createdAt: scene.createdAt,
      updatedAt: scene.updatedAt,
    }),
  );
}
