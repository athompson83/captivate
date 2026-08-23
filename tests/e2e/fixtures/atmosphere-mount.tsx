/**
 * The real `Atmosphere`, mounted in a real browser, so that its lifecycle can
 * be watched rather than described.
 *
 * The defect this exists for is invisible to jsdom and to the shader spec
 * alike: `forceContextLoss()` in the cleanup destroyed the WebGL context that
 * React's development remount then inherited on the *same* `<canvas>`, because
 * a canvas has one context for its lifetime. Every unit assertion passed, a
 * pixel read taken before teardown showed the right colour, and the field came
 * back as a flat white sheet over the whole world.
 *
 * Catching that needs three things a unit test cannot have at once: a real
 * WebGL implementation, React's development double-mount, and the same canvas
 * element across both mounts. This entry supplies them by importing the
 * component itself — not a copy of it — and handing the test control of when it
 * mounts and unmounts.
 *
 * It is bundled by `tests/e2e/atmosphere-lifecycle.spec.ts` at test time and is
 * imported by nothing under `src/`, so none of it can reach a production build.
 */

import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Atmosphere, type AtmosphereHandle } from "@/components/stage/atmosphere";
import type { Palette } from "@/lib/present/ambient";
import type { Camera } from "@/lib/present/camera";
import type { ScenePlacement } from "@/lib/schema/presentation";

const STAGE = { width: 1280, height: 720 };
const VIEWPORT = { width: 480, height: 360 };

/** Two regions far enough apart that the camera can sit squarely on one. */
const PLACEMENTS: ScenePlacement[] = [
  { x: 0, y: 0, scale: 1, rotation: 0 },
  { x: 4000, y: 0, scale: 1, rotation: 0 },
];

/**
 * Ember and Signal — the warmest and coldest accents the themes ship with, in
 * OKLab. Chosen so a drawn frame is unmistakably *drawn*: a lost context leaves
 * the buffer at zero, and neither of these is anywhere near black.
 */
const WARM: Palette = {
  canvas: { L: 0.184129, a: 0.007842, b: 0.008728 },
  accent: { L: 0.684728, a: 0.119974, b: 0.099172 },
  surface: { L: 0.23132, a: 0.010871, b: 0.013225 },
};

const COLD: Palette = {
  canvas: { L: 0.18882, a: -0.003792, b: -0.009563 },
  accent: { L: 0.806842, a: -0.156577, b: 0.041313 },
  surface: { L: 0.240433, a: -0.006116, b: -0.021684 },
};

const BASE: Palette = {
  canvas: { L: 0.178328, a: 0.000135, b: -0.012808 },
  accent: { L: 0.648812, a: -0.00194, b: -0.014464 },
  surface: { L: 0.217368, a: -0.00173, b: -0.016828 },
};

/** Parked on the warm region, so a rendered centre pixel is warm. */
const CAMERA: Camera = { x: 0, y: 0, width: STAGE.width, rotation: 0 };

let root: Root | null = null;
let handle: AtmosphereHandle | null = null;
/** Every registration and de-registration, so an unbalanced pair is visible. */
let registrations = 0;
let releases = 0;

function onReady(next: AtmosphereHandle | null) {
  handle = next;
  if (next) registrations += 1;
  else releases += 1;
}

function host(): HTMLElement {
  const existing = document.getElementById("host");
  if (existing) return existing;
  const created = document.createElement("div");
  created.id = "host";
  created.style.cssText = `position:relative;width:${VIEWPORT.width}px;height:${VIEWPORT.height}px`;
  document.body.append(created);
  return created;
}

function canvas(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>("canvas[data-atmosphere]");
}

/**
 * The context three is using, not a new one.
 *
 * `getContext` returns the canvas's existing context for a type it already has,
 * which is the only way to read three's drawing buffer back from outside the
 * renderer — and the only way to ask whether the context the *remount*
 * inherited is still alive.
 */
function gl(): WebGL2RenderingContext | null {
  return canvas()?.getContext("webgl2") ?? null;
}

const api = {
  mount(options?: { still?: boolean; depth?: number }) {
    if (root) throw new Error("already mounted");
    root = createRoot(host());
    root.render(
      <StrictMode>
        <Atmosphere
          onReady={onReady}
          placements={PLACEMENTS}
          palettes={[WARM, COLD]}
          base={BASE}
          stage={STAGE}
          viewport={VIEWPORT}
          depth={options?.depth ?? 0.55}
          still={options?.still ?? false}
        />
      </StrictMode>,
    );
  },

  unmount() {
    root?.unmount();
    root = null;
  },

  /** Draw, then read the centre pixel back before the buffer is composited. */
  draw(): { drew: boolean; pixel: [number, number, number, number] | null } {
    const drew = handle ? handle.draw(CAMERA) : false;
    const context = gl();
    if (!context) return { drew, pixel: null };
    const out = new Uint8Array(4);
    context.readPixels(
      Math.floor(VIEWPORT.width / 2),
      Math.floor(VIEWPORT.height / 2),
      1,
      1,
      context.RGBA,
      context.UNSIGNED_BYTE,
      out,
    );
    return { drew, pixel: [out[0], out[1], out[2], out[3]] };
  },

  /** Everything a leak would show up in, in one shape. */
  inspect() {
    const context = gl();
    return {
      canvases: document.querySelectorAll("canvas[data-atmosphere]").length,
      hasCanvas: Boolean(canvas()),
      canvasHidden: canvas()?.style.display === "none",
      contextLost: context ? context.isContextLost() : null,
      hasHandle: Boolean(handle),
      registrations,
      releases,
    };
  },

  /** Take the context away the way a driver would. */
  loseContext() {
    gl()?.getExtension("WEBGL_lose_context")?.loseContext();
  },
};

declare global {
  interface Window {
    atmosphereFixture: typeof api;
  }
}

window.atmosphereFixture = api;
