/**
 * The whole editor, mounted and driven in a real browser.
 *
 * This is the surface the project has never had automated coverage of. Every
 * signed-in route needs a Supabase session, so nothing here could be tested
 * without an account — and two previous attempts to mount it in this harness
 * died in the bundler on `server-only`, reached through a `"use server"`
 * module that vite followed and Next would have replaced. `build.ts` now does
 * the replacing, so the editor bundles with its real store, real autosave, real
 * shortcuts and real canvas, and only the server round-trip is a stub.
 *
 * What that buys is the thing the repository has been bitten by twice: an edit
 * that looks right on screen, marks nothing dirty, and is gone on reload.
 * `AGENTS.md` names it — "A local edit that marks nothing dirty is not saved" —
 * and says section renames shipped broken for a release for exactly this
 * reason. A dirty flag is invisible in a screenshot and invisible in jsdom,
 * because it only exists once the store, the autosave hook and the component
 * tree are running together.
 *
 * Bundled by `tests/e2e/editor.spec.ts`, imported by nothing under `src/`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import { EditorRoot } from "@/components/editor/editor-root";
import { updateSectionLocal, useEditor } from "@/lib/editor/store";
import { composeScene } from "@/lib/editor/layouts";
import { JOURNEY_DEFAULTS, type PresentationDocument } from "@/lib/schema/presentation";

const PRESENTATION = "00000000-0000-4000-8000-000000000001";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Two scenes in one movement, which is the smallest deck that can be navigated. */
function deck(): PresentationDocument & { recoveredScenes: string[] } {
  const section = {
    id: uuid(100),
    presentationId: PRESENTATION,
    title: "Opening",
    label: "Opening",
    purpose: "",
    position: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  const scene = (n: number, title: string, heading: string) => ({
    id: uuid(200 + n),
    presentationId: PRESENTATION,
    sectionId: section.id,
    placement: null,
    momentId: null,
    position: n,
    title,
    content: composeScene("statement", { heading }),
    speakerNotes: "",
    durationSeconds: null,
    flowRole: "main" as const,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });

  return {
    presentation: {
      id: PRESENTATION,
      ownerId: uuid(4),
      folderId: null,
      title: "Fixture deck",
      description: "",
      themeId: "midnight",
      themeOverrides: null,
      aspectRatio: "16:9",
      journey: JOURNEY_DEFAULTS,
      targetSeconds: 0,
      tags: [],
      isFavorite: false,
      thumbnailUrl: null,
      schemaVersion: 1,
      shareToken: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      lastOpenedAt: null,
    },
    sections: [section],
    moments: [],
    scenes: [scene(0, "First", "The opening claim"), scene(1, "Second", "The turn")],
    recoveredScenes: [],
  };
}

declare global {
  interface Window {
    editorFixture: {
      mount: () => void;
      /** What autosave would send: the dirty flags the store is holding. */
      dirty: () => Record<string, unknown>;
      /** Rename a movement the way the sidebar does, and report the flags. */
      renameSection: (label: string) => Record<string, unknown>;
      /** The server actions the stub recorded, most recent last. */
      calls: () => { name: string; args: unknown[] }[];
      /** Drive the save indicator, so a test can see what a failure looks like. */
      setSaveState: (
        state: "idle" | "dirty" | "saving" | "saved" | "error",
        error?: string,
      ) => void;
    };
    __serverActions?: {
      log: { name: string; args: unknown[] }[];
      replies: Record<string, unknown>;
    };
  }
}

/**
 * Only the `dirty*` keys, because that is the assertion.
 *
 * Returning the whole store would let a test pass by finding the new label
 * sitting in state — which is exactly what the section-rename bug did before
 * anyone reloaded the page.
 */
function dirtyFlags(): Record<string, unknown> {
  const state = useEditor.getState() as unknown as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(state)
      .filter(([key]) => key.startsWith("dirty"))
      // The dirty sets have to cross into the test as arrays. A `Set` survives
      // `page.evaluate` as `{}`, which is truthy, empty, and would let every
      // assertion below pass against a store that marked nothing at all.
      .map(([key, value]) => [key, value instanceof Set ? [...value] : value]),
  );
}

window.editorFixture = {
  mount() {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0";
    document.body.appendChild(host);
    createRoot(host).render(
      <StrictMode>
        <EditorRoot document={deck()} />
      </StrictMode>,
    );
  },

  dirty: dirtyFlags,

  renameSection(label: string) {
    const id = useEditor.getState().document.sections[0]?.id;
    if (!id) throw new Error("the fixture deck has no section to rename");
    updateSectionLocal(id, { label });
    return dirtyFlags();
  },

  calls: () => window.__serverActions?.log ?? [],

  setSaveState(state, error) {
    useEditor.setState({ saveState: state, saveError: error ?? null });
  },
};

document.body.dataset.ready = "true";
