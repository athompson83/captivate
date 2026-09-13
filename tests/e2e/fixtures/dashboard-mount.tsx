import "@/app/globals.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@/components/app-shell";
import { PresentationsLibrary } from "@/components/dashboard/presentations-library";
import type { PresentationSummary } from "@/lib/data/presentations";
import { JOURNEY_DEFAULTS, parseSceneContent, type SceneContent } from "@/lib/schema/presentation";
import { exampleDeck } from "@/lib/marketing/example-deck";

/**
 * The dashboard, on its own.
 *
 * `/presentations` is behind sign-in and a Supabase project, so the shell
 * and the library — the first thing a signed-in person sees — had only ever
 * been rendered in jsdom. This mounts `AppShell` around
 * `PresentationsLibrary` with a handful of decks and their first scenes, the
 * way the page does after its queries; every action is the stubbed kind
 * that resolves to nothing.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function summary(n: number, title: string, sceneCount: number): PresentationSummary {
  return {
    id: uuid(100 + n),
    ownerId: uuid(4),
    folderId: null,
    title,
    description: "",
    themeId: ["midnight", "paper", "clinical", "ember"][n % 4],
    themeOverrides: null,
    aspectRatio: "16:9",
    journey: JOURNEY_DEFAULTS,
    targetSeconds: 0,
    tags: n % 2 === 0 ? ["teaching"] : [],
    isFavorite: n === 1,
    thumbnailUrl: null,
    schemaVersion: 1,
    shareToken: null,
    generationStatus: "ready",
    generationStartedAt: null,
    createdAt: "2026-09-01T09:00:00Z",
    updatedAt: `2026-09-1${n}T09:00:00Z`,
    lastOpenedAt: null,
    sceneCount,
    folderName: null,
    generation: "ready",
  };
}

declare global {
  interface Window {
    dashboardFixture: { mount: (options?: { empty?: boolean }) => number };
  }
}

window.dashboardFixture = {
  mount({ empty = false } = {}) {
    window.navigationShim.pathname = "/presentations";
    const deck = exampleDeck();
    const presentations = empty
      ? []
      : [
          summary(0, "Hold the room", deck.scenes.length),
          summary(1, "Sepsis in the first hour: a walk through the guideline", 14),
          summary(2, "Untitled presentation", 1),
          summary(3, "Airway decisions at the roadside", 9),
        ];
    const previews: Record<string, SceneContent> = {};
    presentations.forEach((p, i) => {
      const scene = deck.scenes[i % deck.scenes.length];
      previews[p.id] = parseSceneContent(scene.content).content;
    });

    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;overflow:auto";
    document.body.appendChild(host);
    createRoot(host).render(
      <StrictMode>
        <AppShell
          user={{ email: "presenter@example.com", displayName: "Sam Presenter", avatarUrl: null }}
        >
          <PresentationsLibrary
            presentations={presentations}
            trashed={[]}
            folders={[{ id: uuid(900), name: "Paramedicine", color: "#b8773a", count: 2 }]}
            tags={[{ tag: "teaching", count: 2 }]}
            previews={previews}
            filters={{ q: "", folder: "", tag: "", sort: "recent", view: "all" }}
          />
        </AppShell>
      </StrictMode>,
    );
    return presentations.length;
  },
};
