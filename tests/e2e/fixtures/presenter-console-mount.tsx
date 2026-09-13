import "@/app/globals.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PresenterConsole } from "@/components/present/presenter-console";
import type { LectureNote } from "@/lib/data/notes";
import type { PresentationRecord } from "@/lib/schema/presentation";
import { exampleDeck } from "@/lib/marketing/example-deck";

/**
 * The presenter console, on its own.
 *
 * `/present/[id]/console` is the second window — notes, timers, the next
 * scene — and behind sign-in like the stage, so it had never been driven in
 * a real browser at a real size. This mounts `PresenterConsole` with the
 * worked example, given speaker notes and two lecture notes so the notes
 * pane has something to show; the channel to a stage stays unopened.
 */
function recordOf(): PresentationRecord {
  const deck = exampleDeck();
  return {
    id: deck.id,
    ownerId: "00000000-0000-4000-8000-000000000004",
    folderId: null,
    title: deck.title,
    description: deck.description,
    themeId: deck.themeId,
    themeOverrides: null,
    aspectRatio: deck.aspectRatio,
    journey: deck.journey,
    targetSeconds: 0,
    tags: [],
    isFavorite: false,
    thumbnailUrl: null,
    schemaVersion: 1,
    shareToken: null,
    generationStatus: "ready",
    generationStartedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastOpenedAt: null,
  };
}

const NOTE =
  "Open with the room's own experience: everyone here has watched a talk lose the room at minute ten. Name it, then say the shape of the talk is the fix — not the slides.";

declare global {
  interface Window {
    presenterConsoleFixture: { mount: () => number };
  }
}

window.presenterConsoleFixture = {
  mount() {
    const deck = exampleDeck();
    const scenes = deck.scenes.map((scene, i) => ({
      ...scene,
      speakerNotes: i % 2 === 0 ? NOTE : "",
    }));
    const lectureNotes: LectureNote[] = [
      {
        id: "00000000-0000-4000-8000-00000000a001",
        presentationId: deck.id,
        sectionId: deck.sections[0]?.id ?? null,
        sceneId: null,
        title: "Why attention drains",
        body: "The curve every lecturer recognises: ninety-five at the start, thirty by minute forty. The talk's job is to reset it.",
        position: 0,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0";
    document.body.appendChild(host);
    createRoot(host).render(
      <StrictMode>
        <PresenterConsole
          presentation={recordOf()}
          scenes={scenes}
          sections={deck.sections}
          lectureNotes={lectureNotes}
        />
      </StrictMode>,
    );
    return scenes.length;
  },
};
