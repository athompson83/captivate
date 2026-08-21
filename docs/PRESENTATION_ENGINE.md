# Presentation engine

One component, `Stage`, renders every context: the editor canvas, present mode,
navigator thumbnails, the console's control pad, the scene jumper, and dashboard
card previews. There is no second renderer to keep in step, which is why a
thumbnail is never a stale approximation of the slide.

---

## Coordinates

The stage is 100 × 100 **normalised units**, letterboxed into the display aspect
ratio. Every frame is `{ x, y, w, h, rotation }` in those units.

This buys three things:

- a scene renders identically on a 13" laptop and a 4K projector;
- a pointer position broadcast from the console lands in exactly the right place
  on the audience display, at any size;
- annotations drawn on a 400px control pad appear correctly over a 3840px stage.

Internally the stage draws at a fixed 1600px width and scales with a CSS
transform. Type sizes derive from a "stage rem" of `width / 100`, so a 5.4rem
heading is 86px at 1600px and scales proportionally — nothing reflows between
sizes.

---

## Scaling

Fit-to-container is measured by a `ResizeObserver` and written straight to a
`--stage-scale` custom property on the container. Resizing a window costs one
style write, not a re-render of every element on the stage.

The stage element is centred by `left: 50%; top: 50%` plus
`translate(-50%, -50%) scale(var(--stage-scale))`, deliberately rather than by
grid alignment: an item larger than its grid area is not centred consistently
across engines once it overflows, and the stage is always larger than its
container before scaling.

---

## Layouts

Fourteen named compositions in `lib/editor/layouts.ts`. A layout owns *geometry*;
the caller supplies *content*.

```
title · section · statement · bullets · split-left · split-right · media-full
quote · two-column · three-up · chart · code · closing · custom
```

This is the main defence against badly composed scenes. Neither a person
dragging boxes nor a language model has to invent coordinates — the composition
was designed once, properly, and content is poured into it.

Manual nudging flips a scene to `custom`, and the layout stops re-applying.
Switching layouts re-flows content and keeps the text: `extractContent` pulls
structured content back out, `composeScene` pours it into the new geometry. A
test round-trips a heading through every layout and asserts it survives.

Text slots stay inside a 6-unit safe margin, because a projector crops edges.
Media may bleed to the edge. Full-bleed images always get a scrim, because a
heading over an unscrimmed photo is unreadable.

---

## Text auto-fit

A heading longer than its author expected used to overflow its box and collide
with the element below — the most common way a deck looks broken on a projector.

`lib/present/fit-text.ts` shrinks text to fit. Two properties matter:

**It is estimated, not measured.** The size is a pure function of the character
count, the box and the font metrics. That is what makes a 96px thumbnail, the
editor canvas and a 4K projector agree exactly, and it means there is no
measure-then-re-render cycle to stutter mid-drag or mid-transition.

**It is solved, not approximated.** At size `s`, a line holds `w / (s · ratio)`
characters, so text occupies `n · s · ratio / w` lines — plus up to one more,
because the last line is rarely full. Requiring

```
(n · s · ratio / w + 1) · s · lineHeight ≤ h
```

is a quadratic in `s`. Solving it exactly is what keeps the estimate inside the
box instead of overshooting by a line, which a naive area formula does.

It only ever shrinks, never grows, and stops at 45% of the authored size. Past
that point the honest answer is that there is too much text, and hiding that
helps nobody.

---

## Motion

Nine entrance presets — fade, rise, settle, slide-left, slide-right, scale,
reveal, blur, none — and six scene transitions. Deliberately a small,
opinionated set: no spins, no bounces, no typewriters. These read as intentional
staging rather than clip art.

Every preset is a plain from/to pair, so playback state stays serialisable and a
recording reproduces the motion the audience saw.

`prefers-reduced-motion` collapses transitions to effectively instant and
suppresses entrance animation entirely.

### Builds

`buildStepCount` computes how many discrete advances a scene contains: one for
the scene itself, plus one per element marked `onAdvance`, plus one per extra
item in a staggered list.

Advancing walks those steps before moving to the next scene. Going *back* to a
scene shows it fully built rather than rewound, because a presenter returning to
a slide wants to see it, not replay it.

---

## Themes

Six token sets. A theme defines seven colours, three font roles and a type
scale; elements reference tokens (`{ kind: "token", token: "accent" }`) rather
than literal colours, so re-theming a deck never rewrites element content.

Literal hex is allowed where a user genuinely wants a specific colour.

---

## Elements

Fourteen types, all rendered from typed data:

**Text** — heading, text, quote, list, callout, code
**Media** — image, video, audio, embed
**Objects** — shape, divider, icon, chart

Text renders from `RichText`, an array of `{ text, bold?, italic?, href?, … }`
runs. Never HTML. There is no `dangerouslySetInnerHTML` on the stage, so there
is nothing to sanitise and nothing to get wrong.

Charts are a dependency-free renderer for bar, column, line and donut. Each
carries a required text description, because a chart is otherwise opaque to
assistive technology.

Icons come from a curated registry keyed by name, so stored content can never
resolve to an arbitrary import.

---

## Annotation

Session overlays in normalised coordinates, rendered as SVG above the scene and
below the presenter chrome. Nothing here touches the scene document, so a laser
sweep or a highlight during a lecture cannot modify the saved presentation.

- **Laser** — a soft glow with a bright core, which reads on a projector where a
  small hard dot disappears. Follows the pointer whether or not a button is
  held, so it behaves like a physical pointer.
- **Highlight** — drag a rectangle. Rendered under ink so a scribble on top
  stays readable. Ignores accidental taps.
- **Ink** — freehand, smoothed with quadratic curves through midpoints so it
  does not look like a polyline. Five colours, three weights.
- **Eraser** — removes whole strokes and highlights within tolerance.

Cleared per scene (`C`) or entirely.
