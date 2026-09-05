import type { SharedDeck } from "@/lib/data/shared-payload";
import { JOURNEY_DEFAULTS, type Scene, type Section } from "@/lib/schema/presentation";
import { buildTemplateScenes, getTemplate, templateMovements } from "@/lib/templates/registry";

/**
 * The worked example, as a deck a viewer can walk.
 *
 * Built through the same template machinery creation uses, so what the
 * landing page shows moving is exactly what a new account's first deck is —
 * and a template edit that breaks rendering fails the demo's tests, not the
 * first visitor's afternoon. Pure and deterministic: fixed ids, no clock, no
 * network, so a browser test and a unit test see the same deck.
 */

export const EXAMPLE_TITLE = "Hold the room";

/** A stable, valid UUID for the example's rows. */
export function exampleId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function exampleDeck(): SharedDeck {
  const template = getTemplate("example");
  if (!template) throw new Error("worked example template missing");

  const built = buildTemplateScenes(template, EXAMPLE_TITLE);
  const movements = templateMovements(built);

  const sections: Section[] = movements.map((movement, i) => ({
    id: exampleId(100 + i),
    presentationId: exampleId(1),
    title: movement.label,
    label: movement.label,
    purpose: "",
    position: i,
    createdAt: "",
    updatedAt: "",
  }));

  const sectionForScene = (index: number) =>
    movements.findIndex((m) => index >= m.start && index < m.end);

  const scenes: Scene[] = built.map((scene, i) => {
    const section = sectionForScene(i);
    return {
      id: exampleId(200 + i),
      presentationId: exampleId(1),
      sectionId: section >= 0 ? sections[section].id : null,
      position: i,
      title: scene.title,
      content: scene.content,
      placement: null,
      flowRole: "main",
      momentId: null,
      speakerNotes: "",
      durationSeconds: null,
      createdAt: "",
      updatedAt: "",
    };
  });

  return {
    id: exampleId(1),
    title: EXAMPLE_TITLE,
    description: "The worked example, shared.",
    themeId: template.themeId,
    aspectRatio: "16:9",
    journey: JOURNEY_DEFAULTS,
    scenes,
    sections,
  };
}
