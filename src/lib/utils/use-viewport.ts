"use client";

import { useSyncExternalStore } from "react";

/**
 * Tailwind's `md`. The editor's own breakpoint, in one place, because the
 * layout below it is not a smaller version of the layout above it — panels
 * stop taking width and start covering the canvas — and two components
 * disagreeing about where that happens is a panel that overlays nothing.
 */
const NARROW = "(max-width: 767.98px)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return window.matchMedia(NARROW).matches;
}

/**
 * The server has no viewport, and this one answers "no".
 *
 * Desktop is the authoring environment (`docs/DESIGN.md`), so the wide layout
 * is the one worth rendering before the client knows better. A phone corrects
 * it on hydration, which `useSyncExternalStore` does without the flash of a
 * layout effect and without reading `window` during render — the React
 * Compiler rules in `AGENTS.md` rule out both.
 */
function serverSnapshot(): boolean {
  return false;
}

/**
 * Whether the viewport is too narrow for the editor's side panels to take
 * width from the canvas.
 *
 * This exists because the measurement is unambiguous: at 390px the navigator
 * (212px) and the inspector (272px) together asked for 484px, the scene was
 * rendered 96px wide, and the controls that did not fit were pushed outside an
 * `overflow-hidden` shell where nothing could scroll to them.
 */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
