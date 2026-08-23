/**
 * The real `ElementFrame`, editing, in a real browser.
 *
 * The defect this exists for cannot be seen anywhere else. `onInput` commits
 * to the store on every keystroke; the store update changes the element, and
 * the element is what the editable text is derived from. While React owned
 * that text node it diffed against its own previous virtual text rather than
 * the DOM the author had just typed into, replaced the node, and collapsed the
 * caret to the start — so the second character landed in front of the first.
 *
 * jsdom cannot show it: it implements neither `innerText` (which `commitText`
 * reads) nor a caret. It needs a browser, a real keyboard, and the real store.
 *
 * Bundled at test time by `tests/e2e/inline-editing.spec.ts`, and imported by
 * nothing under `src/`.
 */

import { createRoot } from "react-dom/client";
import { ElementFrame } from "@/components/editor/element-frame";
import { createElement } from "@/lib/editor/element-factory";
import { useEditor } from "@/lib/editor/store";
import { composeScene } from "@/lib/editor/layouts";
import { JOURNEY_DEFAULTS } from "@/lib/schema/presentation";
import type { PresentationDocument, SceneElement } from "@/lib/schema/presentation";

const PRESENTATION = "00000000-0000-4000-8000-000000000001";
const SCENE = "00000000-0000-4000-8000-000000000002";

const element: SceneElement = {
  ...createElement("text"),
  id: "00000000-0000-4000-8000-000000000003",
};

function document_(): PresentationDocument {
  const content = composeScene("statement", { heading: "Heading" });
  return {
    presentation: {
      id: PRESENTATION,
      ownerId: "00000000-0000-4000-8000-000000000004",
      folderId: null,
      title: "Fixture",
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
    sections: [],
    moments: [],
    scenes: [
      {
        id: SCENE,
        presentationId: PRESENTATION,
        sectionId: null,
        placement: null,
        momentId: null,
        position: 0,
        title: "Scene",
        content: { ...content, elements: [element] },
        speakerNotes: "",
        durationSeconds: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
  };
}

/**
 * Reads the element back out of the store on every change, which is the whole
 * point: the component must receive the element the store now holds, because
 * that re-render is what used to destroy the caret.
 */
function Harness() {
  const live = useEditor(
    (s) => s.document.scenes[0].content.elements[0] as SceneElement | undefined,
  );
  if (!live) return null;

  return (
    <div style={{ position: "relative", width: 420, height: 180 }}>
      <ElementFrame
        element={live}
        selected
        editing
        scale={1}
        sceneId={SCENE}
        onPointerDown={() => {}}
        onResizeStart={() => {}}
        onStartEditing={() => {}}
        onStopEditing={() => {}}
      />
    </div>
  );
}

/** The text the store holds, which is what would actually be saved. */
function storedText(): string {
  const el = useEditor.getState().document.scenes[0]?.content.elements[0];
  if (!el) return "";
  if (el.type === "code") return el.code;
  if (el.type === "heading" || el.type === "text" || el.type === "quote") {
    return el.content.map((r) => r.text).join("");
  }
  return "";
}

const api = {
  mount(seed = "") {
    const doc = document_();
    // Always set explicitly: the factory seeds placeholder copy, and a test
    // that types into it would be measuring the placeholder as well.
    const first = doc.scenes[0].content.elements[0];
    if (first.type === "text") first.content = seed ? [{ text: seed }] : [];
    useEditor.getState().init(doc);

    const host = window.document.createElement("div");
    host.id = "host";
    window.document.body.append(host);
    createRoot(host).render(<Harness />);
  },
  storedText,
  /** What the browser is actually showing in the editable node. */
  domText: () => window.document.querySelector('[role="textbox"]')?.textContent ?? "",
};

declare global {
  interface Window {
    inlineEditFixture: typeof api;
  }
}

window.inlineEditFixture = api;
