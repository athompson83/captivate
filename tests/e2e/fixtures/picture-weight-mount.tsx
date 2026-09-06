import "@/app/globals.css";

import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { World, type Focus } from "@/components/stage/world";
import { JOURNEY_DEFAULTS, parseSceneContent, type Scene } from "@/lib/schema/presentation";
import { getTheme } from "@/lib/schema/theme";
import { stageSize } from "@/lib/present/stage";

/**
 * What a phone actually decodes while presenting a deck full of photographs.
 *
 * The owner has reported a browser dying mid-presentation five times, on a
 * phone. The WebGL field was measured first and came to 1.3 MB — too small to
 * explain a terminated content process. Pictures are the other candidate and
 * are far larger: a decoded bitmap costs width x height x 4 bytes whatever the
 * file weighed, so a 1880x1253 photograph is 9.4 MB in memory from a 200 KB
 * JPEG, and a deck is not one photograph.
 *
 * So this mounts the real world at a real phone viewport, gives every scene a
 * real photograph at the rendition the sourcing pipeline now asks for, walks
 * the whole deck, and reports the decoded bytes the renderer is holding at the
 * worst moment. It is a measurement, not an assertion about iOS: Chromium is
 * not WebKit and this container has no phone. What it can settle is whether
 * the number is small enough to rule pictures out, and it is not.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stage = stageSize("16:9");

/** Pexels `large2x`, which is what `visual-sourcing` now asks for. */
const PHOTO_W = 1880;
const PHOTO_H = 1253;

/**
 * A real JPEG at a real rendition size, made here rather than fetched.
 *
 * Noise rather than a flat fill: a flat image compresses to nothing and a
 * browser may keep it in a form that costs nothing to hold, which would
 * measure the fixture instead of the product.
 */
async function photograph(seed: number): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_W;
  canvas.height = PHOTO_H;
  const ctx = canvas.getContext("2d")!;
  const pixels = ctx.createImageData(PHOTO_W, PHOTO_H);
  let state = seed * 2654435761;
  for (let i = 0; i < pixels.data.length; i += 4) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    pixels.data[i] = state & 0xff;
    pixels.data[i + 1] = (state >> 8) & 0xff;
    pixels.data[i + 2] = (state >> 16) & 0xff;
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  // A blob rather than a data URL: `MediaSource` caps a source at 4096
  // characters, which a 1880x1253 JPEG in base64 is two orders of magnitude
  // over — the schema drops the element and the scene renders empty, which is
  // how the first cut of this measured nothing at all.
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.8),
  );
  return URL.createObjectURL(blob);
}

async function deck(count: number): Promise<{
  scenes: Scene[];
  placements: ReturnType<typeof place>;
}> {
  const scenes: Scene[] = [];
  for (let i = 0; i < count; i += 1) {
    const url = await photograph(i + 1);
    scenes.push({
      id: uuid(400 + i),
      presentationId: uuid(1),
      sectionId: null,
      position: i,
      title: `Scene ${i + 1}`,
      content: parseSceneContent({
        layout: "media-full",
        elements: [
          {
            type: "image",
            id: `img-${i}`,
            frame: { x: 0, y: 0, w: 100, h: 100 },
            url,
            alt: `Photograph ${i + 1}`,
            fit: "cover",
          },
        ],
      }).content,
      placement: null,
      flowRole: "main",
      momentId: null,
      speakerNotes: "",
      durationSeconds: null,
      createdAt: "",
      updatedAt: "",
    });
  }
  return { scenes, placements: place(count) };
}

const place = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    x: i * stage.width * 1.08,
    y: 0,
    scale: 1,
    rotation: 0,
  }));

function Fixture({ scenes, placements }: Awaited<ReturnType<typeof deck>>) {
  const [focus, setFocus] = useState<Focus>({ kind: "scene", index: 0 });
  const goto = useCallback((index: number) => setFocus({ kind: "scene", index }), []);

  useEffect(() => {
    window.goToScene = goto;
  }, [goto]);

  return (
    <World
      scenes={scenes}
      placements={placements}
      theme={getTheme(undefined)}
      aspect="16:9"
      focus={focus}
      activeIndex={focus.kind === "scene" ? focus.index : 0}
      step={0}
      play
      travel="cut"
      pace={JOURNEY_DEFAULTS.pace}
      depth={JOURNEY_DEFAULTS.depth}
      className="absolute inset-0"
    />
  );
}

/** Decoded bitmap bytes the document is holding right now, and where. */
function reading() {
  const images = [...document.querySelectorAll("img")].filter((img) => img.naturalWidth > 0);
  const bytes = images.reduce((sum, img) => sum + img.naturalWidth * img.naturalHeight * 4, 0);
  const canvases = [...document.querySelectorAll("canvas")];
  const canvasBytes = canvases.reduce((sum, c) => sum + c.width * c.height * 4, 0);
  return {
    images: images.length,
    imageBytes: bytes,
    stages: document.querySelectorAll("[data-stage]").length,
    canvases: canvases.length,
    canvasBytes,
  };
}

declare global {
  interface Window {
    pictureWeight: {
      mount: (count: number) => Promise<void>;
      /** Walks the deck, returning the worst reading seen along the way. */
      walk: (count: number) => Promise<ReturnType<typeof reading> & { at: number }>;
    };
    goToScene: (index: number) => void;
  }
}

const settle = () =>
  new Promise<void>((resolve) => {
    let frames = 0;
    const tick = () => (frames++ < 8 ? requestAnimationFrame(tick) : resolve());
    requestAnimationFrame(tick);
  });

window.pictureWeight = {
  async mount(count: number) {
    const made = await deck(count);
    const host = document.createElement("div");
    // An iPhone in portrait with the address bar showing: the viewport the
    // reports come from, not a desktop one.
    host.style.cssText = "position:fixed;inset:0;width:393px;height:852px";
    document.body.appendChild(host);
    createRoot(host).render(<Fixture {...made} />);
  },

  async walk(count: number) {
    let worst = { ...reading(), at: 0 };
    for (let i = 0; i < count; i += 1) {
      window.goToScene(i);
      await settle();
      const now = reading();
      if (now.imageBytes > worst.imageBytes) worst = { ...now, at: i };
    }
    return worst;
  },
};
