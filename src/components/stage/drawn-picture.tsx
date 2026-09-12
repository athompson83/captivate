"use client";

import { useId } from "react";
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
 *
 * Three things a path may carry beyond its geometry, all of which exist
 * because a picture drawn at one weight in one colour with no mass is a
 * wireframe, and a wireframe is what "the drawings are weak" looks like:
 *
 *  - `weight` scales the stroke, so an outline can be heavier than its detail
 *    and construction lighter than both;
 *  - `ink` overrides the element's colour for one stroke, so the idea a stage
 *    adds can arrive in the accent while the rest stays in ink;
 *  - `fill` lays a soft wash inside a closed path once its stroke has
 *    finished, which gives a shape body without a second colour.
 *
 * And two things every drawing gets without being asked, because a single
 * clean line with a flat tint inside it is a diagram from a manual and not a
 * picture somebody made: an **underdrawing** — every stroke drawn twice, the
 * first pass lighter and through a different hand, the way a sketch keeps
 * the searching line under the committed one — and a **wash** that behaves
 * like water rather than paint: bled a little past the outline, bent by a
 * coarser hand than the ink, and set a touch off the line, so the colour
 * never registers exactly with the stroke that contains it.
 */

const INK: Record<DrawingElement["ink"], string> = {
  ink: "var(--stage-ink)",
  accent: "var(--stage-accent)",
  muted: "var(--stage-ink-muted)",
};

export function measureDrawnPath(el: SVGGeometryElement | null): void {
  if (!el || el.style.getPropertyValue("--dp-len")) return;
  try {
    el.style.setProperty("--dp-len", String(el.getTotalLength()));
  } catch {
    // No layout engine (jsdom, a detached node): the fallback of 0 renders
    // the stroke complete, which is the honest degraded state.
  }
}

/**
 * The base size of a label, in the drawing's own units.
 *
 * Sized against the width so a label is the same fraction of the picture
 * whatever box the model drew in: on the 800-wide canvas this is 26, which is
 * a caption's height on a half-stage drawing and legible from the back.
 */
export function labelSize(viewBoxWidth: number): number {
  return viewBoxWidth * 0.0325;
}

/**
 * How far the wash sits off the line, in the drawing's units.
 *
 * Down and to the right, the way a wash laid after the ink settles: a fill
 * that registers exactly with its outline reads as a vector tint. On 800
 * wide this is 6 — visible as intent, never as a mistake.
 */
export function washOffset(viewBoxWidth: number): number {
  return viewBoxWidth * 0.0075;
}

/** How far past its outline a wash bleeds, as a stroke on the fill. */
export function washBleed(strokeWidth: number): number {
  return strokeWidth * 2.6;
}

/** The underdrawing's weight against the ink, and how much of it shows. */
export const UNDER_WEIGHT = 0.55;
export const UNDER_OPACITY = 0.42;

/**
 * How much a hand wobbles, in the drawing's units.
 *
 * Proportional to the box for the same reason: a fixed wobble is a tremor on
 * a small drawing and invisible on a large one. On 800 wide this is 2.4 —
 * about a third of a percent, which is what a pen does and a plotter does not.
 */
export function handWobble(viewBoxWidth: number): number {
  return viewBoxWidth * 0.003;
}

export function DrawnPicture({
  element,
  step,
  fontFamily,
}: {
  element: DrawingElement;
  /** Current advance step; paths with `stage <= step` are drawn. Pass Infinity for the finished picture. */
  step: number;
  /** The theme's sans face, for the labels. */
  fontFamily?: string;
}) {
  // One set of filters per picture, named uniquely so two drawings on a
  // scene do not share a definition and a thumbnail does not borrow the
  // stage's: the ink's hand, the underdrawing's hand and the wash's.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const filterId = `hand-${uid}`;
  const underId = `under-${uid}`;
  const washId = `wash-${uid}`;
  const wobble = handWobble(element.viewBox.width);
  const offset = washOffset(element.viewBox.width);
  const size = labelSize(element.viewBox.width);
  const seed = Math.round(element.viewBox.width + element.viewBox.height) % 97;

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
      {/* The hand. A displacement through low-frequency noise bends every
          stroke a little off its geometry, so a compiled circle is a circle
          somebody drew rather than one a plotter traced. Seeded from the
          picture's own size so the same drawing wobbles the same way on
          every screen. */}
      <defs>
        {/* Three hands. The ink's bends each stroke a third of a percent off
            its geometry; the underdrawing's is a different hand over the same
            geometry, so the two lines agree everywhere and coincide nowhere;
            the wash's is coarser and stronger, because water moves further
            than a pen. All seeded from the picture's own size, so the same
            drawing is drawn the same way on every screen. */}
        {(
          [
            { id: filterId, frequency: 0.012, octaves: 2, seed, scale: wobble },
            { id: underId, frequency: 0.016, octaves: 2, seed: seed + 31, scale: wobble * 1.5 },
            { id: washId, frequency: 0.02, octaves: 1, seed: seed + 67, scale: wobble * 5 },
          ] as const
        ).map((hand) => (
          <filter
            key={hand.id}
            id={hand.id}
            filterUnits="userSpaceOnUse"
            x={-element.viewBox.width * 0.05}
            y={-element.viewBox.height * 0.05}
            width={element.viewBox.width * 1.1}
            height={element.viewBox.height * 1.1}
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency={hand.frequency}
              numOctaves={hand.octaves}
              seed={hand.seed}
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale={hand.scale}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        ))}
      </defs>
      {/* The washes, under everything: water goes down before the ink. Each
          waits for its own stroke — its delay is the stroke's delay plus its
          duration — so a shape fills the moment its outline closes rather
          than before it exists. Bled past the line by a wide stroke of the
          same colour, and set off it. */}
      <g filter={`url(#${washId})`} transform={`translate(${offset} ${offset})`}>
        {element.paths.map((path, i) => {
          if (!path.fill) return null;
          const siblings = perStage.get(path.stage) ?? 1;
          const duration = element.paceSeconds / siblings;
          const drawn = path.stage <= step;
          const colour = INK[path.ink ?? element.ink];
          return (
            <path
              key={i}
              d={path.d}
              className={drawn ? "dp-fill dp-drawn" : "dp-fill"}
              fill={colour}
              stroke={colour}
              strokeWidth={washBleed(element.strokeWidth)}
              strokeLinejoin="round"
              style={
                {
                  "--dp-del": `${slots[i] * duration + duration}s`,
                } as React.CSSProperties
              }
            />
          );
        })}
      </g>
      {/* The underdrawing, then the ink, both sketched on the same clock: the
          searching line and the committed one arrive together, as they do
          when a hand goes over its own first pass. */}
      {(
        [
          {
            id: underId,
            className: "dp-path dp-under",
            weight: UNDER_WEIGHT,
            opacity: UNDER_OPACITY,
          },
          { id: filterId, className: "dp-path", weight: 1, opacity: 1 },
        ] as const
      ).map((pass) => (
        <g key={pass.id} filter={`url(#${pass.id})`} opacity={pass.opacity}>
          {element.paths.map((path, i) => {
            const siblings = perStage.get(path.stage) ?? 1;
            const duration = element.paceSeconds / siblings;
            const drawn = path.stage <= step;
            const colour = INK[path.ink ?? element.ink];
            const timing = {
              "--dp-dur": `${duration}s`,
              "--dp-del": `${slots[i] * duration}s`,
            } as React.CSSProperties;
            return (
              <path
                key={i}
                ref={measureDrawnPath}
                d={path.d}
                className={drawn ? `${pass.className} dp-drawn` : pass.className}
                stroke={colour}
                strokeWidth={element.strokeWidth * (path.weight ?? 1) * pass.weight}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={timing}
              />
            );
          })}
        </g>
      ))}
      {/* Labels sit outside the hand: a word bent by the pen's wobble reads
          as a rendering fault, not as handwriting. They arrive after their
          stage's last stroke has closed. */}
      {element.labels.map((label, i) => {
        const siblings = perStage.get(label.stage) ?? 1;
        const drawn = label.stage <= step;
        return (
          <text
            key={`label-${i}`}
            x={label.x}
            y={label.y}
            className={drawn ? "dp-label dp-drawn" : "dp-label"}
            fill={INK[label.ink ?? element.ink]}
            fontFamily={fontFamily}
            fontSize={size * label.size}
            fontWeight={500}
            textAnchor={label.anchor}
            dominantBaseline="middle"
            // A halo in the canvas colour, so a word that lands on a line is
            // still a word.
            stroke="var(--stage-canvas)"
            strokeWidth={size * 0.28}
            strokeLinejoin="round"
            paintOrder="stroke"
            style={
              {
                "--dp-del": `${siblings * (element.paceSeconds / siblings)}s`,
              } as React.CSSProperties
            }
          >
            {label.text}
          </text>
        );
      })}
    </svg>
  );
}
