# Presentation engine

Captivate has no slide reel. A presentation is a single unbounded canvas — the
**world** — with every scene placed somewhere on it, and presenting is a camera
travelling between those places. A conventional deck is the degenerate case: the
same engine, with the scenes in a row at one zoom.

Two components:

- `Stage` renders one scene. It serves the editor canvas, navigator thumbnails,
  the console's control pad, the scene jumper and dashboard previews. There is
  no second renderer to keep in step, which is why a thumbnail is never a stale
  approximation of the scene.
- `World` composes many `Stage`s onto the canvas and moves the camera. It is
  what the audience sees.

---

## One surface

The thing that decides whether this reads as a new medium or as slides on a
wall is not the camera. It is whether a scene has an edge.

A scene on the world canvas renders **bare**: no background, no border, no box,
no clipping. Its elements are painted straight onto the world, and the surface
underneath belongs to the world rather than to any scene. `Stage` still paints a
background in `card` mode — for thumbnails, dashboard previews and the editor
canvas, where a scene genuinely _is_ a discrete object being looked at — but on
the canvas it never does.

The line for anything a scene might paint: **a colour is atmosphere, an image is
content.**

- A solid or gradient scene background is not drawn. Its palette is blended into
  the air around that region instead (below), which is what it was for.
- An image background _is_ drawn, feathered at the rim so it pools into the
  surface rather than ending at a border.
- An image element with no image is an outline, not a filled block, and its
  scrim — which exists to keep a caption legible over a photograph — is not
  drawn when there is no photograph.

Every one of those was a rectangle on the page before it was fixed.

---

## Movements

A section is not filing. It is a stretch of the argument that does one job —
open, frame, apply pressure, decide — and its `label` is the one-word name for
that job.

Movements are shown to the **audience**, on a rail down the edge of the stage,
with the current one lit and the spine filled to how far through the whole thing
the room is. It costs a sliver of the frame and buys the one thing a stack of
slides can never give an audience: knowing where they are, how far in, and how
much is left. It carries no interaction and is meant to be answerable at a
glance when someone's attention drifts, not read.

As a movement ends, its last scene names the next one — "Next movement · 02 —
FRAME" — and says the narrative continues without a break. That signpost appears
only on the final scene of a movement, which is the only place it means
anything.

Three rules the grouping follows, each with a test:

- a section with no short label falls back to its own title, so every deck that
  already has sections gains a working rail without being re-authored;
- scenes belonging to no section still form a movement, because half-organised
  is a normal state and hiding them would make the rail lie about the length;
- two separate stretches of the same section stay separate, because returning to
  an earlier movement is a real narrative move and merging them would draw one
  movement spanning the middle of the deck.

Templates carry their shape, not just their scenes: every template scene names
its movement, and creating a presentation from one creates the sections too. A
rail is worth nothing if a new presentation arrives without a shape.

---

## Atmosphere

The background is one continuous field, and its colour depends on where the
camera is. Each region contributes its theme's palette to the air around it;
the colour at any point is the blend of the nearest few, weighted by inverse
square distance. Flying from a cold region to a warm one warms the whole room on
the way, because that is what moving through a place looks like.

Three mechanisms:

- **The room** (`ambient.ts`) — a full-viewport wash, recomputed every animation
  frame and written to custom properties on one element. Never through React.
- **The field** (`ambient.ts`) — pools of each region's accent painted into the
  surface itself, in world space, so they move and scale with the camera as part
  of the page.
- **The air** (`atmosphere.ts` and `components/stage/atmosphere.tsx`) — the same
  blend, per pixel, on the GPU.

The third exists because the first two are compromises with what CSS can say.
One gradient means the whole screen is one colour, so standing between a cold
region and a warm one shows their _average_ rather than cold on the left and
warm on the right — and the world's entire claim is that different places feel
different. The shader turns every pixel back into a world position and blends
the regions around **it**, which is the claim actually rendered.

It also replaced the parallax layer, which was a grid of dots. That grid did its
job — it gave the eye something to measure motion against — and told the wrong
story: a canvas with a grid on it is a design tool, and the moment a
presentation looks like one, it is one. Depth is now two layers of drifting fbm
in world space, which is light rather than furniture.

The layer is decorative in the strict sense: `aria-hidden`, never read, never a
control, and lazily loaded so a renderer's worth of bytes stays off the critical
path. Where WebGL is unavailable — an old driver, a blocklisted GPU, too many
live contexts — the component still mounts, but it probes for a context first
and never asks three for a renderer, so nothing is drawn and the canvas stays
transparent over the CSS wash. The same happens if the driver takes the context
back mid-presentation: the canvas stands down rather than leaving an opaque
rectangle over the world. That is a real fallback, not a claimed one — the wash
is what every presentation showed before this existed.

A software-rendered context is accepted rather than refused. Refusing one costs
the feature on a VM, a remote desktop or a blocklisted driver, which describes a
lectern PC; what makes that affordable is a shader with no transcendental in its
hash, three octaves of noise rather than four, a pixel ratio capped at 1.5, and
twelve frames a second while nobody is flying.

Blending happens in **OKLab**, not sRGB. Mixing a deep blue with an amber in
sRGB drags the midpoint through grey, which is exactly the transition a camera
flying between two regions would show.

Both layers weight by inverse-square distance in scene-widths, and both bound
how much of the canvas can reach any one point — averaging every scene pulls
every position toward the same mean and makes a whole presentation one colour,
when the point is that different parts of it should feel different. The wash
does it by taking only the nearest three regions (`NEIGHBOURS` in
`ambient.ts`); the shader cannot sort per pixel, so it takes the nearest
`MAX_REGIONS` to the _camera_ and lets the falloff do the rest. On identical
input the two agree to within a percent, and a test renders the shader to keep
it that way.

---

## The world

Each scene carries a `placement`: `{ x, y, scale, rotation }` in world units,
where one unit is one stage pixel at `scale: 1`. A scene with no placement is
positioned by the presentation's arrangement at read time, so a deck nobody has
touched spatially still presents.

`scale` has a wide range on purpose. A scene placed at `0.02` inside another
scene's bounds _is_ a detail of that scene, and the camera dives into it when
the presenter advances. Nesting is not a separate feature with its own concept
and its own command — it falls out of free placement plus a camera, and it is
authored by dragging one scene inside another on the journey map.

### Arrangements

`src/lib/present/arrange.ts` turns an ordered list of scenes into positions.
Each preset is a pure function of index, section and count.

| Preset          | Shape                                                         |
| --------------- | ------------------------------------------------------------- |
| `flow`          | **Default.** A serpentine filling a page, each row reversing. |
| `reel`          | A straight line at one zoom — a conventional deck.            |
| `grid`          | Sections become rows.                                         |
| `timeline`      | A spine with scenes alternating above and below it.           |
| `spiral`        | Winds outward; the shape reads as widening scope.             |
| `nested`        | Each scene inside the last, surfacing every third.            |
| `constellation` | Sections cluster in their own regions.                        |

Applying an arrangement stamps a placement onto every scene, in one statement
and one undo step. Dragging a scene afterwards overrides its placement; the rest
keep following the preset. A scene added to a world that has already been
arranged by hand lands beside the one before it at the same scale, rather than
jumping back to where the preset would have put that index.

Every arrangement holds one invariant, which is tested: two consecutive scenes
are either clearly apart or one sits wholly inside the other. A partial overlap
is just a mess.

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

Fourteen named compositions in `lib/editor/layouts.ts`. A layout owns _geometry_;
the caller supplies _content_.

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

## The camera

Presenting moves a camera, so how it moves _is_ the product. Two things had to
be right.

**The path.** A linear tween between two framings looks wrong in a way people
feel but cannot name: zoom is multiplicative, so interpolating it linearly
rushes the start and crawls the end, and crossing a long distance at close range
is a nauseating blur. `src/lib/present/camera.ts` implements the optimal
zoom-and-pan path from Van Wijk & Nuij, _Smooth and efficient zooming and
panning_ (InfoVis 2003), which solves for the shortest smooth path in
(pan, zoom) space. Two properties fall out of it:

- the camera pulls back, travels, and pushes in, without anyone specifying an
  arc — rising above the ground is simply the cheapest way to cross it;
- path length is measured in perceptual units, so a journey across the world
  takes a little longer than a hop next door rather than fifty times as long.

Rotation is not in the paper's model and is carried along the same parameter,
taking the short way round.

**The cost.** A flight is sixty transform writes a second and none of them may
pass through React. The camera lives in a ref; the animation loop writes
`style.transform` on one promoted layer. React only re-renders when the _set of
visible scenes_ changes — once per waypoint, never mid-flight.

That constraint shapes culling too. Which scenes exist, and whether each is
drawn in full or as a numbered marker, is decided from the flight's _endpoints_
rather than the live camera, taking the greater detail of the two so nothing
pops into or out of simplification while the camera is moving.

The animation is deliberately not torn down by its own effect's cleanup. The
effect re-runs on every render — its target is a fresh object each time — and a
cleanup that cancelled the frame would kill a flight the moment anything else
re-rendered. Something always does; the session clock ticks once a second.

### Travel

Set once for the whole presentation, not per scene:

| Travel     | Behaviour                                 |
| ---------- | ----------------------------------------- |
| `fly`      | The camera travels. The default.          |
| `dissolve` | The world swaps under a short cross-fade. |
| `cut`      | Instant. A conventional slideshow.        |

There is no per-scene transition picker. In a spatial presentation the camera
move is the transition, and choosing a different wipe for scene seven is the
habit this tool exists to replace.

### Establishing a section

Crossing into a new section, the camera first pulls back far enough to show the
whole section, holds for a beat, then dives to its first scene. That pause is
the difference between "here is the next slide" and "here is where we are going
next". It lives in the session store rather than in a component, because it is a
timed transition of session state that the console needs to know about too.

### Overview

`O` pulls the camera back over the whole world and draws the route
between waypoints; clicking a scene flies to it. It is a camera position, not a
mode: the presentation is still live, the current scene is still current, and
advancing from there flies back down to it.

---

## Motion

Nine entrance presets — fade, rise, settle, slide-left, slide-right, scale,
reveal, blur, none. Deliberately a small,
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

Advancing walks those steps before moving to the next scene. Going _back_ to a
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
