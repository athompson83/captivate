import "@/app/globals.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Stage } from "@/components/stage/stage";
import { composeScene } from "@/lib/editor/layouts";
import { getTheme } from "@/lib/schema/theme";
import { richTextMark } from "@/lib/schema/presentation";
import { isAccentRun } from "@/lib/present/hand-mark";

/**
 * A scene whose body carries the phrase that matters, performed on a real
 * stage in a real browser: the one place the hand-drawn underline can be
 * measured against the words it sits under, since jsdom lays nothing out.
 */

declare global {
  interface Window {
    handMark: { mount(perform: boolean): void; reword(accent: string): void };
  }
}

// Long enough to wrap onto a second line in the body's column.
const PHRASE = "Reassess before you treat again or you never hear the answer";

const body = (accent: string) =>
  `Every treatment is a question you ask the patient's body. ${accent}.`;

const base = composeScene("split-left", {
  heading: "Care is a loop, not a line.",
  body: body(PHRASE),
  bodyAccent: PHRASE,
  media: { url: "", alt: "" },
});

/**
 * The same scene with the phrase edited in place: the same element ids, so
 * React updates the words rather than remounting the element — which is
 * what an author editing on the canvas does, and what a fresh composition
 * would not exercise.
 */
const content = (accent: string) => ({
  ...base,
  elements: base.elements.map((el) =>
    el.type === "text" && el.content.some(isAccentRun)
      ? { ...el, content: richTextMark(body(accent), accent) }
      : el,
  ),
});

let root: ReturnType<typeof createRoot> | null = null;
let performing = false;

const render = (accent: string) =>
  root?.render(
    <StrictMode>
      <Stage
        content={content(accent)}
        theme={getTheme("midnight")}
        aspect="16:9"
        play={performing}
        arrived
        className="h-full w-full"
      />
    </StrictMode>,
  );

window.handMark = {
  mount(perform) {
    performing = perform;
    const host = document.createElement("div");
    host.style.width = "1600px";
    host.style.height = "900px";
    document.body.appendChild(host);
    root = createRoot(host);
    render(PHRASE);
  },
  /** The author edits the phrase in place: the same mount, new words. */
  reword(accent) {
    render(accent);
  },
};
