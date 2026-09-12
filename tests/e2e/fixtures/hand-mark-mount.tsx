import "@/app/globals.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Stage } from "@/components/stage/stage";
import { composeScene } from "@/lib/editor/layouts";
import { getTheme } from "@/lib/schema/theme";

/**
 * A scene whose body carries the phrase that matters, performed on a real
 * stage in a real browser: the one place the hand-drawn underline can be
 * measured against the words it sits under, since jsdom lays nothing out.
 */

declare global {
  interface Window {
    handMark: { mount(perform: boolean): void };
  }
}

const content = composeScene("split-left", {
  heading: "Care is a loop, not a line.",
  body: "Every treatment is a question you ask the patient's body. Reassess before you treat again or you never hear the answer.",
  // Long enough to wrap onto a second line in the body's column.
  bodyAccent: "Reassess before you treat again or you never hear the answer",
  media: { url: "", alt: "" },
});

window.handMark = {
  mount(perform) {
    const host = document.createElement("div");
    host.style.width = "1600px";
    host.style.height = "900px";
    document.body.appendChild(host);
    createRoot(host).render(
      <StrictMode>
        <Stage
          content={content}
          theme={getTheme("midnight")}
          aspect="16:9"
          play={perform}
          arrived
          className="h-full w-full"
        />
      </StrictMode>,
    );
  },
};
