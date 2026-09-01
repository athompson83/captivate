"use client";

import type { DrawingElement } from "@/lib/schema/presentation";

/**
 * A picture that sketches itself, one stage per advance.
 *
 * The animation is stroke-dasharray/-dashoffset driven entirely by CSS: a
 * path's length is measured once, in a ref callback (commit phase, before
 * paint — never during render, which the compiler rules forbid), and written
 * to a custom property. Advancing a stage is one class flip per path; the
 * browser interpolates from there. Nothing goes through React mid-animation,
 * for the same reason the camera doesn't.
 *
 * An unmeasured path renders *finished*: `--dp-len` defaults to 0, and a zero
 * dash array is a solid stroke. If JavaScript never runs, or measurement
 * fails, the audience sees the picture rather than a blank — a drawing that
 * doesn't animate is a picture; one that doesn't appear is a broken scene.
 *
 * Paths within a stage sketch sequentially, splitting the element's
 * `paceSeconds` between them; earlier stages hold their finished state.
 * `prefers-reduced-motion` keeps the pacing (the stages are the argument
 * being built) and drops only the sweep — see globals.css.
 */

const INK: Record<DrawingElement["ink"], string> = {
  ink: "var(--stage-ink)",
  accent: "var(--stage-accent)",
  muted: "var(--stage-ink-muted)",
};

export function measureDrawnPath(el: SVGPathElement | null): void {
  if (!el || el.style.getPropertyValue("--dp-len")) return;
  try {
    el.style.setProperty("--dp-len", String(el.getTotalLength()));
  } catch {
    // No layout engine (jsdom, a detached node): the fallback of 0 renders
    // the stroke complete, which is the honest degraded state.
  }
}

export function DrawnPicture({
  element,
  step,
}: {
  element: DrawingElement;
  /** Current advance step; paths with `stage <= step` are drawn. Pass Infinity for the finished picture. */
  step: number;
}) {
  // How many paths share each stage, and each path's index within its stage,
  // so a stage's paths split its pace between them in order. Pure arithmetic
  // over props — fine in render.
  const perStage = new Map<number, number>();
  const slots = element.paths.map((path) => {
    const index = perStage.get(path.stage) ?? 0;
    perStage.set(path.stage, index + 1);
    return index;
  });

  return (
    <svg
      role="img"
      aria-label={element.alt || "Drawing"}
      // Padded by a stroke width so ink sitting exactly on the boundary is not
      // shaved in half by the clip below, and clipped rather than left to
      // overflow. `overflow: visible` was letting a model that drew outside the
      // box it declared paint across whatever else the scene had — the report
      // was two drawing fragments floating over a bar chart. `normaliseDrawing`
      // grows the stored box to hold the ink, so for anything drawn from the
      // origin outwards this clip never reaches real strokes; ink at negative
      // coordinates is the one case it does, and a picture cropped inside its
      // own frame is still better than one painted over its neighbours.
      viewBox={`${-element.strokeWidth} ${-element.strokeWidth} ${
        element.viewBox.width + element.strokeWidth * 2
      } ${element.viewBox.height + element.strokeWidth * 2}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "100%", overflow: "hidden" }}
    >
      {element.paths.map((path, i) => {
        const siblings = perStage.get(path.stage) ?? 1;
        const duration = element.paceSeconds / siblings;
        return (
          <path
            key={i}
            ref={measureDrawnPath}
            d={path.d}
            className={path.stage <= step ? "dp-path dp-drawn" : "dp-path"}
            stroke={INK[element.ink]}
            strokeWidth={element.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={
              {
                "--dp-dur": `${duration}s`,
                "--dp-del": `${slots[i] * duration}s`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </svg>
  );
}
