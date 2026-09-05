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
- An image element is `soft` by composition (`ImageElement.edge`): rounded
  generously and feathered on all four sides by a mask, so a photograph beside
  a heading pools into the page rather than ending at a hard vertical line.
  The feather is two linear gradients intersected, not a radial one, because a
  radial feather turns a full-bleed photograph into an oval; corners are the
  part of a picture that should go quietly. Rows that predate the field keep
  their hard edge, and the inspector offers both.

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

### Depth

Behind the fbm sit three layers of soft motes, and they are what makes the
room three-dimensional. Each layer is the content plane seen by a camera
sitting further back — 0.6, 2.2 and 6 scene-widths (`DEPTH_LAYERS`) — so its
world-units-per-pixel is the camera's plus that distance over the viewport.
That one line is the whole projection: a pan slides a far layer slower than
the content and a zoom grows it less, which is parallax rather than a texture
scrolled at a made-up rate.

The layer is built to be seen during a transition and not on a scene. While
the camera stands still the motes are a faint scatter drifting over tens of
seconds. As the camera flies they brighten, more of the field comes out, and
each disc is stretched along the direction of travel — a streak, not a blur,
because the thing the room should read from it is _which way_. The stirring is
measured from consecutive cameras handed to `draw` (`cameraMotion`: pan in
viewport-widths per second, zoom in e-folds per second, either saturating on
its own so a pure dive still reads as travel), rises instantly, and settles by
a factor of e every 0.4 s after landing (`settleMotion`), so the air is still
moving for a beat after the content has stopped. A reduced-motion preference
pins it still; the journey's `depth` at zero removes it.

The layers are not alike, on purpose. The near one is a few large, very soft
motes on a wide lattice with most of its cells empty; the far ones are a finer
dust — big things close and small things far is what depth looks like, and a
field of same-sized discs at one density read as snowfall when it was first
rendered. Cost is one hash lookup per layer per pixel: a mote is jittered
within the middle of its cell and its radius never reaches the edge, so no
neighbour can intrude and there is no 3×3 search. Lightness moves _away_ from the room's own
— up in a dark theme, down on paper — so a mote is visible on every theme and
never clips to white. The shader test renders a flat, a resting and a flying
frame and asserts the resting dust is faint (by the frame's mean), the flight
visibly stirs it (by the share of pixels that moved — the right measure for a
sparse field), a pan moves it, and a streak lies along the heading.

### Depth inside a scene

Everything behind a scene had depth — the backdrop on its plane, the motes at
three distances — and the scene itself was flat: a picture and the words over
it moved as one sheet. Now the words sit a little nearer than the surface and
the pictures a little farther (`src/lib/present/parallax.ts`), and as the
camera departs or arrives they slide against each other by an amount
proportional to the camera's offset from the scene's centre, capped at three
percent of the stage so a far scene never scatters. On a scene the offset is
exactly zero, so nothing is ever misregistered while it is being read; the
depth shows only in the motion. The camera loop writes two custom properties
per region once a frame and each element's layer multiplies them by its depth
in CSS: sixty elements cost two style writes, and the compositor moves the
layers. Only while presenting; in the editor an element sits exactly where it
was put.

### Backdrop

An author can put one picture behind the whole show (`JourneyConfig.backdrop`,
chosen in the journey panel from the same asset picker as any image). It is
the depth layer's idea with a photograph on it: a plane `backdropDepth`
scene-widths behind the content — the author's `distance`, from just behind
the scenes to far away — so a flight slides it slower than the scenes and a
zoom grows it less, and on a scene it is perfectly still. The plane is sized
once per document to cover the viewport at the widest framing the camera can
take (`backdropPlane`), anchored on the world's centre, and moved from the
same loop as the world (`backdropTransform`, which is `worldTransform` with
the depth added to the camera's width). It is dimmed toward the theme's canvas
so the scenes' text stays legible over it. One for the show, not one per
scene: a scene's own background is a region's atmosphere, and this is the room
the regions are in.

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

The camera stays level. A tilt per region was tried, so the pulled-back page
would read as a composition rather than a grid, and taken out the same day:
the camera shares a scene's rotation on arrival, so every flight rolled the
horizon by the difference, and a rolling horizon is the one camera move that
makes an audience feel ill. Getting the page out of the grid is the content's
job — see the soft image edge above — not the camera's.

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

Eighteen named compositions in `lib/editor/layouts.ts`. A layout owns _geometry_;
the caller supplies _content_.

```
title · cover · section · statement · bullets · split-left · split-right
media-full · quote · two-column · three-up · chart · code · closing
takeaway · action · figure · explainer · custom
```

The last four are _points_ rather than pages, and they exist because a deck of
headings and bullets is a deck of slides whatever the camera does. What a room
leaves with is an icon, a number and a sentence:

- **takeaway** — one take-home point, led by an icon set as large as the
  heading beside it, with one line under it saying why it holds. A
  movement-ending claim, evidence, example or synthesis lands here
  (`layoutFor` reads `endsMovement`), so every movement hands over its point.
- **action** — a call to action: the imperative as the heading, then up to
  three steps across the width. An `application` or a `close` composes here; a
  deck ends on what to do next, not on a list of what was said.
- **figure** — one number large enough to be the scene, its label, the claim
  it proves and one sentence on what to do about it. Evidence alternates this
  with `chart`. The generator may only write a figure it was given; with none
  it writes the claim and leaves the slot empty, and so does the fallback.
- **explainer** — a plain-language sentence, three icon-led points (what it
  is, why it happens, what follows) and a picture. `context` moments compose
  here, and the media slot is one the drawing pass fills.

Their points are callouts in the `open` variant: an icon, a short rule in the
tone colour, a title and a line, painted straight onto the surface with no
panel behind them. Three filled panels in a row is the loudest "these are
slides" cue a scene can send, so `three-up` composes open now too; the `card`
variant stays for authors who want one, and the inspector toggles between
them.

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

### Performed on arrival

A scene performs when the camera lands on it, not when the flight begins. The
world tracks whether the camera is on its destination or on the way, and the
stage holds every element that mounts mid-flight at the start of its entrance —
invisible, its sketch undrawn — until landing, then releases them with their
own delays. Before this the active scene was the destination from the first
frame of the flight, so every choreographed entrance, every stagger and the
first stroke of every drawing played out in the distance while the camera was
still travelling, and the room landed on a finished scene. An element already
on screen when the flight begins is left alone: an entrance is for what the
audience has not seen, and a neighbour that vanished as the camera set off
would be a pop.

Two things happen only while an element is performed this way, and never in
the editor, a thumbnail, or a scene the camera is passing:

- **A figure counts up.** The one-number layout marks its number as a
  `figure`, and on arrival it climbs from zero to its value in about a second,
  slowing into the last few digits. Written straight to the text node from a
  frame loop, in tabular numerals, so nothing re-renders and nothing shifts.
  Ratios ("1 in 4") and small numbers are shown as they are: counting them
  says nothing. `src/lib/present/count-up.ts` decides what is counted and how
  each intermediate value is written.
- **A chart builds.** Columns grow from their baseline, bars from their left
  edge, donut arcs sweep round one after another, and a line draws itself with
  the same measured-dash mechanism as a drawing. Transform and dash animations
  only, so the compositor does the work.
- **A heading arrives a word at a time.** Each word rises into place a beat
  after the one before, so a claim is read in the order it was written — the
  typographic equivalent of a sentence being said. Inline-block spans, so
  lines still break at the spaces and the auto-fit, which measured the plain
  text, still holds. Only plain headings of up to fourteen words; a longer one,
  or any run with styling, arrives whole. A CSS stagger, no script.

### Attention

The scene the camera is on is lit; the ones beside it recede to sixty percent
while presenting, and come back as the camera sets off towards them. Opacity
only — a haze painted over a region would be a rectangle on a world that has
none — and never in the overview, where every scene is equally the subject.

### Drawings

A drawing element is a picture that sketches itself: SVG path data in its own
viewBox, one stage per advance, animated by `stroke-dasharray` entirely in CSS
(`DrawnPicture`). A path carries three things beyond its geometry — `weight`,
a multiple of the element's stroke; `ink`, an override so one stroke can take
the accent; and `fill`, a soft wash inside a closed path in its own ink, at
14% opacity, arriving once the stroke around it has closed. They exist because
a picture drawn at one weight in one colour with no mass is a wireframe, and a
wireframe is what "the drawings are weak" looks like. A generated drawing is
placed at stroke width 3 on its 800-wide box, which is a three-pixel line on
the stage; two disappeared on a projector.

The generator does not draw. Briefed as an illustrator and handed exact
construction recipes it still returned wobbly fragments at one weight — a
language model can reason about what goes where and cannot draw a curve. So
it _composes_ instead, in a small diagram language (`lib/drawing/diagram.ts`):
nodes that are shapes (circle, ellipse, box, pill, cloud) or symbols, in boxes
on an 800×500 canvas, and edges between them (arrow, line, curve, both), each
with a stage and an accent flag, shapes with a fill flag. `compileDiagram`
turns that into strokes with recipes designed once — a circle is two arcs, a
box is four quadratics, a cloud is a smooth closed curve through bumps on an
ellipse, an arrow starts and ends at the _edges_ of the things it joins with a
little air, its head sized to its shaft.

Symbols are the Lucide icon set read as path data rather than rendered as
components (`lib/drawing/symbols.ts`, about a hundred names the model can
reason about: a heart, a brain, a person, a syringe, a hospital, a clock).
Each is scaled into its box at the weight the icon was designed for — a
2-unit stroke on a 24-unit grid, so a large symbol is bold and a small one
fine — through a path transformer that keeps every command's meaning: an
opening relative move is absolute, an arc's radii scale but its flags do not,
and the flags are single digits that may run into the next value, which is
how a face first lost its mouth. A test asserts every symbol name resolves to
real primitives, so a renamed icon fails at build time rather than drawing a
blank.

The output is the same `DrawnPath[]` the stage sketches, so staging, weights,
accent, fills, the editor, the export and the audience boundary are all
untouched. Stages are capped at four and folded when a model exceeds it
(`normaliseDrawing`), and the box is widened to hold every stroke rather than
clipping one.

### Builds

`buildStepCount` computes how many discrete advances a scene contains: one for
the scene itself, plus one per element marked `onAdvance`, plus one per extra
item in a staggered list, plus one per stage a drawing adds, plus one — one
total, not one per element — when the scene carries a veil (any element with a
non-`none` `exit`). Exits are the mirror of `onAdvance`: the first advance
dismisses every exiting element together, which is how a cover's full-bleed
image and display title lift away to reveal the title slide beneath.

Advancing walks those steps before moving to the next scene. Going _back_ to a
scene shows it fully built rather than rewound, because a presenter returning to
a slide wants to see it, not replay it — for a cover that means the veil is
already lifted.

---

## Themes

Six token sets. A theme defines seven colours, three font roles and a type
scale; elements reference tokens (`{ kind: "token", token: "accent" }`) rather
than literal colours, so re-theming a deck never rewrites element content.

Literal hex is allowed where a user genuinely wants a specific colour.

---

## Elements

Fifteen types, all rendered from typed data:

**Text** — heading, text, quote, list, callout, code
**Media** — image, video, audio, embed
**Objects** — shape, divider, icon, chart, drawing

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
