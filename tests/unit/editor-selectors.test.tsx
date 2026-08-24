import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useEffect, useRef } from "react";
import {
  addElementToScene,
  useCurrentScene,
  useEditor,
  useSelectedElements,
} from "@/lib/editor/store";
import { createElement } from "@/lib/editor/element-factory";
import { composeScene } from "@/lib/editor/layouts";
import { JOURNEY_DEFAULTS, type PresentationDocument } from "@/lib/schema/presentation";

/**
 * Regression tests for the React bindings.
 *
 * A selector that builds a new array on every store read looks harmless in a
 * plain store test but makes `useSyncExternalStore` re-render forever, which is
 * how the editor previously crashed with "Maximum update depth exceeded" the
 * instant anything was selected. These tests exercise the hooks through React
 * so that class of bug cannot come back unnoticed.
 */

const PRESENTATION_ID = "00000000-0000-4000-8000-00000000cccc";

function makeDocument(): PresentationDocument {
  return {
    presentation: {
      id: PRESENTATION_ID,
      ownerId: "00000000-0000-4000-8000-00000000dddd",
      folderId: null,
      title: "Selectors",
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
        id: "scene-0",
        presentationId: PRESENTATION_ID,
        sectionId: null,
        placement: null,
        momentId: null,
        position: 0,
        title: "One",
        content: composeScene("bullets", { heading: "Heading", bullets: ["a", "b"] }),
        speakerNotes: "",
        durationSeconds: null,
        flowRole: "main" as const,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
  };
}

/**
 * Render counting happens in an effect rather than in the render body: mutating
 * an outer variable during render is exactly the kind of side effect that makes
 * these bugs hard to see in the first place.
 */
const renderCount = { value: 0 };

function Probe() {
  const selected = useSelectedElements();
  const scene = useCurrentScene();
  const counter = useRef(renderCount);

  useEffect(() => {
    counter.current.value += 1;
  });

  return (
    <div>
      <span data-testid="count">{selected.length}</span>
      <span data-testid="scene">{scene?.title ?? "none"}</span>
    </div>
  );
}

beforeEach(() => {
  renderCount.value = 0;
  act(() => {
    useEditor.getState().init(makeDocument());
  });
});

describe("useSelectedElements", () => {
  it("renders with nothing selected", () => {
    render(<Probe />);
    expect(screen.getByTestId("count")).toHaveTextContent("0");
    expect(screen.getByTestId("scene")).toHaveTextContent("One");
  });

  it("does not re-render endlessly once an element is selected", () => {
    render(<Probe />);
    const before = renderCount.value;

    const element = createElement("heading");
    act(() => {
      addElementToScene("scene-0", element);
    });

    expect(screen.getByTestId("count")).toHaveTextContent("1");
    // One selection change should cost a handful of renders, not hundreds.
    expect(renderCount.value - before).toBeLessThan(10);
  });

  it("stays stable when an unrelated part of the store changes", () => {
    const element = createElement("heading");
    act(() => {
      addElementToScene("scene-0", element);
    });

    render(<Probe />);
    const before = renderCount.value;

    // A save acknowledgement touches the document but not the selection.
    act(() => {
      useEditor.getState().setSaveState("saved");
    });

    expect(renderCount.value - before).toBeLessThan(6);
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });

  it("tracks selection changes correctly", () => {
    const first = createElement("heading");
    const second = createElement("text");
    act(() => {
      addElementToScene("scene-0", first);
      addElementToScene("scene-0", second);
    });

    render(<Probe />);
    expect(screen.getByTestId("count")).toHaveTextContent("1");

    act(() => {
      useEditor.getState().select({ elementIds: [first.id, second.id] });
    });
    expect(screen.getByTestId("count")).toHaveTextContent("2");

    act(() => {
      useEditor.getState().select({ elementIds: [] });
    });
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("drops elements from the selection when they are deleted", () => {
    const element = createElement("heading");
    act(() => {
      addElementToScene("scene-0", element);
    });

    render(<Probe />);
    expect(screen.getByTestId("count")).toHaveTextContent("1");

    act(() => {
      useEditor.getState().mutate(
        (draft) => {
          const scene = draft.scenes[0];
          scene.content = {
            ...scene.content,
            elements: scene.content.elements.filter((e) => e.id !== element.id),
          };
        },
        { label: "Delete", dirty: ["scene-0"] },
      );
    });

    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });
});
