# Drawn pictures: a diagram that sketches itself, stage by stage

**Date:** 2026-08-24 · **Status:** approved (element shape and animation approach approved
explicitly; remaining sections delegated — "continue without future approval")

## What this is

An author in the editor describes a picture — "the pathway from airway obstruction to
hypoxia", "a map of the argument's three camps" — and the model draws it as line art.
During the presentation, each press of **next** sketches the next stage of the drawing,
stroke by stroke, as though the presenter were drawing it on a whiteboard while talking.
Once the last stage is drawn, the following press moves on, exactly as a staggered list
already behaves.

Decisions taken with the owner, in order:

1. **Sketched stroke by stroke** — real strokes in a drawing order, not a progressive
   reveal of a raster image. The generated picture must therefore *be* vector line art.
2. **The model writes SVG paths directly** — no image API, no image budget, no tracing
   dependency. Text call through the existing `generateStructured` boundary.
3. **Presenter-paced stages** — `next` draws the next stage; this rides the existing
   build-step machinery (`buildStepCount`, `session.step`), not new navigation.
4. **Path data lives inline in the scene content** — like every other element's data.
   No asset pipeline, no signed URLs, nothing to 404 on a shared deck.

## The element

A fifteenth element type in `src/lib/schema/presentation.ts`:

```ts
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\-+\s]+$/;

export const DrawnPath = z.object({
  d: z.string().min(1).max(20_000).regex(PATH_DATA),
  stage: z.number().int().min(0).max(19).default(0),
});

export const DrawingElement = z.object({
  ...elementBase,
  type: z.literal("drawing"),
  viewBox: z.object({ width: z.number().positive().max(4000), height: z.number().positive().max(4000) }),
  paths: z.array(DrawnPath).min(1).max(400),
  /** Authoring aid: what each stage adds. Never sent to the audience. */
  stageLabels: z.array(z.string().max(120)).max(20).default([]),
  ink: z.enum(["ink", "accent", "muted"]).default("ink"),
  strokeWidth: z.number().min(0.1).max(12).default(2),
  /** Seconds one stage takes to sketch. */
  paceSeconds: z.number().min(0.2).max(10).default(1.6),
  prompt: z.string().max(1000).default(""),
  alt: z.string().max(600).default(""),
});
```

Load-bearing choices:

- **We accept path *data*, never SVG markup.** The model returns `d` strings and a
  viewBox; React builds `<path d={…}/>` itself. There is no markup to sanitise —
  no script, no `foreignObject`, no `href`, no entities — and `PATH_DATA` is the SVG
  path grammar alone, so a `d` smuggling anything else is rejected at the boundary.
  Model output passes this schema exactly as user input would (`provider.ts` rule).
- **`ink` is a theme token, not a colour.** The model supplies geometry; Captivate
  supplies the ink. The drawing reads correctly in every theme and the model cannot
  emit off-brand colour. No raw hex (AGENTS.md).
- **The viewBox is the drawing's own space.** Element placement stays 0–100
  normalised; paths live in their own coordinates inside it.
- **`prompt` is kept** so regeneration can seed from what produced the picture,
  mirroring how AI-generated scenes seed the asset picker.

`forAudience` includes the drawing field-by-field and **drops `stageLabels` and
`prompt`** — authoring material, not presenter-private, but the room has no use for it
and the strict boundary is the cheap default. `parseSceneContent` salvage drops an
individual invalid path (and clamps `stage`) rather than losing the element, and drops
the element rather than losing the scene.

## Stages are build steps

`buildStepCount` gains one case, structurally identical to the staggered list:

```ts
if (el.type === "drawing") steps += maxStage(el.paths);   // stage 0 costs nothing
```

Everything else is inherited, deliberately: `next` walks steps before scenes
(`session.ts`), `prev` returns to a scene *fully built* (`land(…, true)` — nobody
re-watches a diagram draw because they stepped back), the console and phone remote
already carry `step` in `state` messages (no protocol bump), the shared viewer calls
the same `buildStepCount`, and the recorder captures the tab so the recording shows
the drawing at the pace the presenter actually took. A drawing whose paths are all
stage 0 contributes no steps and simply sketches itself on arrival.

## Rendering and animation

`DrawnPicture` in `stage.tsx`, sibling of `StaggeredList`. All paths render always
(so lengths can be measured); a path is *drawn* when `path.stage <= step`.

- Each path's length is measured **once, in a ref callback** (commit phase, before
  paint) and written to `--len` on the element. Never during render — the React
  Compiler rules name DOM measurement in render as a violation, and `Stage` already
  writes measurements to custom properties for exactly this reason.
- Sketching is `stroke-dasharray: var(--len)` plus a CSS **animation** on
  `stroke-dashoffset` keyed on the `drawn` class — animations fire when the class is
  present at mount, so stage-0 paths sketch on scene arrival with no mount-effect
  state write. Removing the class (stepping back mid-scene) snaps instantly: the
  un-drawn state carries no animation.
- Paths within one stage sketch **sequentially**: per-path `--dur` and `--del` are
  computed in render (pure arithmetic) so a stage's paths split `paceSeconds`
  between them in order. Advancing a stage costs one class flip per path — zero
  writes per frame, nothing through React mid-animation (the camera rule).
- **Unmeasured means finished.** `--len` defaults to 0, which renders the stroke
  complete. If JS hasn't run or measurement fails, the audience sees the picture,
  not a blank. A drawing that doesn't animate is a picture; one that doesn't appear
  is a broken scene.
- **Reduced motion keeps the pacing, drops the sweep**: stages still appear on
  advance (they are the argument being built) but complete instantly, via the
  global `prefers-reduced-motion` rules.
- `fill: none` throughout — on the world canvas a drawing is strokes on air, which
  satisfies "the world has no rectangles" by construction.

The journey route in `world.tsx` (already stroked in overview) gets the same
draw-in treatment when the overview opens — the "animated journey" half of the ask —
using the identical keyframes, and skipped under reduced motion.

## Generation

- `GeneratedDrawing` schema in `src/lib/ai/schemas.ts` — the same shape the element
  stores (viewBox, paths with stages, stageLabels, alt), so validated model output
  maps 1:1 onto a `DrawingElement`.
- `generateDrawing(prompt, presentationId)` in `service.ts` via `generateStructured`,
  with a drawing-specific system prompt: plan stages first (each stage one idea,
  labelled), 2–8 stages, paths ordered as a person would draw, target ~40–120 paths,
  no text glyphs as paths (lettering as paths is illegible at stroke weight — the
  author adds text elements over the drawing instead).
- **Reserve before spend**, `kind: "drawing"`, counted with the text-generation kinds
  in the existing hourly window (`captivate_reserve_generation`; no migration —
  `kind` is free text and the reservation pattern is the security surface).
- Route `POST /api/ai/visuals/draw`, same contract as the sibling routes: 401 signed
  out, 501 not configured, 400 bad input, 502 with the reservation's message on
  refusal or provider failure. Availability rides `isAiConfigured` (a text call),
  not the image-generation flag.

## Editor

- `createElement("drawing")` inserts a small built-in placeholder sketch (a
  three-stage example) so the element is never an empty box; `INSERTABLE` gains a
  "Drawing" entry.
- The inspector panel for a selected drawing: prompt field + **Generate** (replaces
  paths/labels/alt wholesale — a drawing regenerates as a whole, it is not
  hand-edited path by path), stage count with labels listed read-only, pace, ink,
  stroke width, alt. Mutations go through `mutate` with the dirty-scene flag like
  every element edit; nothing new for autosave to miss, and the reload test proves it.
- Generate is absent (not disabled) when AI isn't configured — an unbuilt path is
  absent, not disabled-with-a-tooltip.

## Failure modes

| failure | behaviour |
| --- | --- |
| model emits invalid path data | schema rejects; one retry with the error (existing `generateStructured` behaviour); then the route's 502 — nothing reaches the document |
| stored path corrupted by hand | salvage drops that path, keeps the drawing, flags `recovered` |
| whole element corrupt | salvage drops the element, keeps the scene |
| JS off / measurement fails | drawing renders complete |
| reservation refused | 502 with the limiter's own message; nothing spent |
| 21st stage / 401st path | clamped at the schema; steps clamp to what exists |

## Tests

Unit: path grammar rejects non-path content (`javascript:`, quotes, tags);
`buildStepCount` counts a drawing's stages exactly like a staggered list (and 0 for a
single-stage drawing); `forAudience` keeps geometry and drops `stageLabels`/`prompt`
(fails if the field is spread through); salvage keeps a drawing minus its one bad
path; `GeneratedDrawing` rejects a path with markup in it; factory inserts a valid
element. Component (jsdom): paths gated by `step`; the `drawn` class flips with no
per-frame React writes; unmeasured paths render solid. Each regression test confirmed
failing against the pre-change code where one exists to revert.

## Out of scope

Uploading hand-made SVGs (sanitisation is a real project), per-path hand editing,
raster "painted reveal" for photographs, and a drawn-route *between* scenes mid-flight
(the camera move is the transition; a route drawn under a flight fights the travel
rule).
