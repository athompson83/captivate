import "@/app/globals.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PresentRoot } from "@/components/present/present-root";
import type { PresentationRecord } from "@/lib/schema/presentation";
import { exampleDeck } from "@/lib/marketing/example-deck";

/**
 * The stage, on its own.
 *
 * `/present/[id]` is behind sign-in and a Supabase project, so the presenter's
 * own surface — the bar, the jumper, the help, the movement rail, the frames
 * the camera lands on — had never been driven in a real browser at a real
 * size. This mounts `PresentRoot` with the worked example, exactly as the
 * route does after `forAudience`: the scenes carry no notes, and the channel
 * to a phone stays unopened because nothing here asks for one.
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

declare global {
  interface Window {
    presenterFixture: {
      /** Mounts the stage; `audienceOnly` is the projector's `?audience=1`. */
      mount: (options?: { audienceOnly?: boolean; plain?: boolean }) => number;
    };
  }
}

window.presenterFixture = {
  mount({ audienceOnly = false, plain = false } = {}) {
    const deck = exampleDeck();
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0";
    document.body.appendChild(host);
    createRoot(host).render(
      <StrictMode>
        <PresentRoot
          presentation={recordOf()}
          scenes={deck.scenes}
          sections={deck.sections}
          audienceOnly={audienceOnly}
          plain={plain}
        />
      </StrictMode>,
    );
    return deck.scenes.length;
  },
};
