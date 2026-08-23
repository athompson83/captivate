"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * Makes `prefers-reduced-motion` mean something to everything `motion` draws.
 *
 * The camera and the stage read the preference themselves. Nothing else did:
 * `motion` ignores it unless told otherwise, and the duration overrides in
 * `globals.css` cannot reach it, because it writes transforms frame by frame
 * rather than through a CSS transition. So a reader who had asked the whole
 * system to stop moving still got a pill sliding across the sidebar on every
 * navigation, a toast flying up from the bottom, and every dialog and dock
 * scaling open.
 *
 * A component of its own because the root layout is a server component and
 * `MotionConfig` is not exported from `motion`'s client entry point.
 */
export function ReducedMotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
