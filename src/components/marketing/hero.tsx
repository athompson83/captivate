"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { webglAvailable } from "@/lib/present/atmosphere";
import { MiniatureWorld } from "./miniature-world";

/**
 * Chooses the hero, and loads the expensive one late.
 *
 * three plus a renderer is a lot of bytes for a picture nobody reads, so it is
 * fetched after the first paint and only on a browser that can actually draw
 * it.
 *
 * Whether WebGL exists is an environment fact, so it is read through
 * `useSyncExternalStore` rather than probed in an effect and written to state.
 * Both give the same two-pass result — CSS hero in the HTML, WebGL after
 * hydration — but a `setState` in an effect is a cascading render, and the
 * compiler is right to reject it. The probe is memoised because it costs a
 * canvas and a context, and `getSnapshot` is called on every render.
 */
const HeroCanvas = dynamic(() => import("./hero-canvas").then((m) => m.HeroCanvas), {
  ssr: false,
});

let probed: boolean | null = null;

/** Never changes: a browser does not gain WebGL while the page is open. */
function subscribe(): () => void {
  return () => {};
}

function clientSnapshot(): boolean {
  probed ??= webglAvailable();
  return probed;
}

/** The server has no canvas, so the HTML is always the CSS hero. */
function serverSnapshot(): boolean {
  return false;
}

export function Hero() {
  const webgl = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);

  if (!webgl) return <MiniatureWorld />;

  return (
    <div
      aria-hidden
      className="hero-sky relative aspect-[16/10.5] w-full overflow-hidden select-none"
    >
      <HeroCanvas />
    </div>
  );
}
