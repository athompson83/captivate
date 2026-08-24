import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SharedViewer } from "@/components/present/shared-viewer";
import type { SharedDeck } from "@/lib/data/shared-payload";
import { JOURNEY_DEFAULTS, type Scene, type Section } from "@/lib/schema/presentation";
import { buildTemplateScenes, getTemplate, templateMovements } from "@/lib/templates/registry";

/**
 * Mounts the share-link viewer on the worked-example deck.
 *
 * Two things are under test at once, both of which only a browser can see:
 * that a link-holder can actually walk the deck — keys, builds, the closing
 * pull-back — and that the shipped example renders without a single console
 * error. The deck is built through the same template machinery creation uses,
 * so a template edit that breaks rendering fails here, not in front of the
 * first new user.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function exampleDeck(): SharedDeck {
  const template = getTemplate("example");
  if (!template) throw new Error("worked example template missing");

  const built = buildTemplateScenes(template, "Hold the room");
  const movements = templateMovements(built);

  const sections: Section[] = movements.map((movement, i) => ({
    id: uuid(100 + i),
    presentationId: uuid(1),
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
      id: uuid(200 + i),
      presentationId: uuid(1),
      sectionId: section >= 0 ? sections[section].id : null,
      position: i,
      title: scene.title,
      content: scene.content,
      placement: null,
      momentId: null,
      speakerNotes: "",
      durationSeconds: null,
      createdAt: "",
      updatedAt: "",
    };
  });

  return {
    id: uuid(1),
    title: "Hold the room",
    description: "The worked example, shared.",
    themeId: template.themeId,
    aspectRatio: "16:9",
    journey: JOURNEY_DEFAULTS,
    scenes,
    sections,
  };
}

declare global {
  interface Window {
    sharedViewerFixture: {
      mount: () => number;
    };
  }
}

window.sharedViewerFixture = {
  /** Renders the viewer and returns the number of scenes mounted. */
  mount() {
    const deck = exampleDeck();
    const host = document.createElement("div");
    document.body.appendChild(host);
    createRoot(host).render(
      <StrictMode>
        <SharedViewer deck={deck} />
      </StrictMode>,
    );
    return deck.scenes.length;
  },
};
