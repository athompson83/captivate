import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LiveDemoStage } from "@/components/marketing/live-demo-stage";

/**
 * Mounts the landing page's live demo on its own, the way the lifecycle
 * project mounts everything: bundled from source, opened from the file
 * system, no server. What only a browser can show is that the real world
 * mounts inside a scrolled page without a console error, and that a key
 * pressed with the stage focused moves it while the same key elsewhere on
 * the page does not.
 */
declare global {
  interface Window {
    liveDemoFixture: { mount: () => void };
  }
}

window.liveDemoFixture = {
  mount: () => {
    const host = document.createElement("div");
    // Real page context: something above it to scroll past, and a body that
    // can receive the keys the stage must not answer.
    host.style.paddingTop = "40vh";
    host.style.width = "960px";
    document.body.appendChild(host);
    createRoot(host).render(
      <StrictMode>
        <LiveDemoStage />
      </StrictMode>,
    );
  },
};
