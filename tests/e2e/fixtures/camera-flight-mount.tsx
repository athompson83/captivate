import "@/app/globals.css";

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { World, type Focus } from "@/components/stage/world";
import { JOURNEY_DEFAULTS, parseSceneContent, type Scene } from "@/lib/schema/presentation";
import { getTheme } from "@/lib/schema/theme";
import { stageSize } from "@/lib/present/stage";

/**
 * The camera, on its own.
 *
 * `World` writes the flight straight to `style.transform` outside React, sixty
 * times a second, so whether the camera *travelled* or simply cut is not
 * visible to any unit test — it is a property of the strings written between
 * two renders. This mounts the world alone, at a fixed viewport, so a test can
 * change the focus and watch every transform it produces.
 *
 * Deliberately not the presenter or the shared viewer: both consume an advance
 * as a build step before they move the camera at all, and a page whose height
 * settles while the deck mounts writes transforms of its own.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stage = stageSize("16:9");

const scenes: Scene[] = ["Departure", "Arrival"].map((title, i) => ({
  id: uuid(200 + i),
  presentationId: uuid(1),
  sectionId: null,
  position: i,
  title,
  content: parseSceneContent({ layout: "statement", elements: [] }).content,
  placement: null,
  flowRole: "main",
  momentId: null,
  speakerNotes: "",
  durationSeconds: null,
  createdAt: "",
  updatedAt: "",
}));

/** A plain reel: two regions, side by side, at the arrangement's own spacing. */
const placements = scenes.map((_, i) => ({
  x: i * stage.width * 1.08,
  y: 0,
  scale: 1,
  rotation: 0,
}));

function Fixture({ travel }: { travel: "fly" | "cut" | "dissolve" }) {
  const [focus, setFocus] = useState<Focus>({ kind: "scene", index: 0 });

  // In an effect, not during render: `setFocus` is stable, so publishing the
  // handle once is enough, and a write to `window` while rendering is the
  // thing the compiler's rules exist to stop.
  useEffect(() => {
    window.flyTo = (index: number) => setFocus({ kind: "scene", index });
  }, []);

  return (
    <World
      scenes={scenes}
      placements={placements}
      theme={getTheme(undefined)}
      aspect="16:9"
      focus={focus}
      activeIndex={focus.kind === "scene" ? focus.index : 0}
      step={0}
      travel={travel}
      pace={JOURNEY_DEFAULTS.pace}
      depth={JOURNEY_DEFAULTS.depth}
      className="absolute inset-0"
    />
  );
}

declare global {
  interface Window {
    cameraFixture: {
      /** World x the camera is centred on once it has arrived at scene two. */
      arrival: number;
      mount: (travel?: "fly" | "cut" | "dissolve") => void;
      /** Every distinct transform written while flying to `index`, per frame. */
      samples: (index: number, ms: number) => Promise<string[]>;
    };
    flyTo: (index: number) => void;
  }
}

window.cameraFixture = {
  arrival: placements[1].x,

  mount(travel = "fly") {
    const host = document.createElement("div");
    // A fixed viewport: the camera's transform is a function of it, and a
    // container that is still settling writes transforms that have nothing to
    // do with the flight.
    host.style.cssText = "position:fixed;inset:0;width:1280px;height:720px";
    document.body.appendChild(host);
    // No StrictMode: the double-invoked mount effect is exactly the "flight
    // interrupted by a re-render" case the world's refs exist to survive, and
    // it is covered elsewhere. What is under test here is the shape of one
    // uninterrupted flight.
    createRoot(host).render(<Fixture travel={travel} />);
  },

  async samples(index: number, ms: number) {
    const seen: string[] = [];
    const read = () => {
      const node = document.querySelector("[data-world]");
      const value = node ? (node as HTMLElement).style.transform : "";
      if (seen[seen.length - 1] !== value) seen.push(value);
    };

    read();
    window.flyTo(index);

    const deadline = performance.now() + ms;
    await new Promise<void>((resolve) => {
      const tick = () => {
        read();
        if (performance.now() >= deadline) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return seen;
  },
};
