import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { EditorRoot } from "@/components/editor/editor-root";
import { updatePresentationMeta, useEditor } from "@/lib/editor/store";
import { JOURNEY_DEFAULTS, type PresentationDocument } from "@/lib/schema/presentation";

/**
 * Undo history belongs to the author, not to a render.
 *
 * `EditorRoot` takes its document as a prop from a server component, and `init`
 * resets `past` and `future` because opening a deck should start with a clean
 * history. Those two facts met in an effect that depended on the *object*:
 * every re-render of the route hands down a structurally identical but new
 * document, and `revalidatePath("/edit/:id")` — which several server actions
 * call — causes exactly that. So the history could vanish mid-edit, with
 * nothing on screen to explain it: the author pressed undo and the button was
 * dead.
 *
 * It is the same shape as the camera defect AGENTS.md records, where an effect
 * whose target was a fresh object each render tore down every flight. Both are
 * invisible until something re-renders for an unrelated reason.
 */

const ID = "00000000-0000-4000-8000-00000000aaaa";
const OTHER_ID = "00000000-0000-4000-8000-00000000bbbb";

function doc(id = ID): PresentationDocument & { recoveredScenes: string[] } {
  return {
    presentation: {
      id,
      title: "Original",
      themeId: "midnight",
      journey: JOURNEY_DEFAULTS,
      targetSeconds: null,
      updatedAt: "2026-01-01T00:00:00Z",
    } as never,
    scenes: [],
    sections: [],
    moments: [],
    recoveredScenes: [],
  };
}

describe("the editor's undo history", () => {
  it("survives a re-render that hands down a new document object", () => {
    const { rerender } = render(<EditorRoot document={doc()} />);
    updatePresentationMeta({ title: "Edited" }, { label: "Rename", coalesceKey: "title" });
    expect(useEditor.getState().past.length, "the edit should be undoable").toBeGreaterThan(0);

    // Same deck, new object — what a route revalidation produces.
    rerender(<EditorRoot document={doc()} />);

    expect(
      useEditor.getState().past.length,
      "a re-render is not a reason to forget what the author did",
    ).toBeGreaterThan(0);
  });

  it("still starts clean when a different deck is opened", () => {
    // The other half of the contract: keying the effect on identity rather than
    // on the object must not stop a genuinely different document initialising,
    // or the editor would show one deck while holding another.
    const { rerender } = render(<EditorRoot document={doc()} />);
    updatePresentationMeta({ title: "Edited" }, { label: "Rename", coalesceKey: "title" });
    expect(useEditor.getState().past.length).toBeGreaterThan(0);

    rerender(<EditorRoot document={doc(OTHER_ID)} />);

    expect(useEditor.getState().document.presentation.id).toBe(OTHER_ID);
    expect(useEditor.getState().past, "a new deck starts with nothing to undo").toHaveLength(0);
  });
});

describe("redo after a coalesced edit", () => {
  it("is available, because the title field coalesces every keystroke", () => {
    // The property the signed-in journey depends on, which nothing pinned: a
    // typing burst collapses into one history entry, and undoing that entry has
    // to leave something to redo.
    useEditor.getState().init(doc());
    for (const title of ["O", "Or", "Ori"]) {
      updatePresentationMeta({ title }, { label: "Rename", coalesceKey: "title" });
    }

    useEditor.getState().undo();

    expect(
      useEditor.getState().future.length,
      "redo must be offered after an undo",
    ).toBeGreaterThan(0);
  });
});
