# Clickable elements that dive into detail — design

Workstream 2 of 4 (see `2026-08-23-premium-chrome-design.md` for the full
list). This spec covers letting the presenter click a specific element on a
scene to expand on it — the user's "clickable elements to expand on specific
points" request.

## Problem

Right now a scene has no way to reveal more depth on one specific point
without either cramming it into the original scene or making the audience
sit through a whole extra scene in the main sequence. There's also no
concept of an in-scene interactive target at all: `SceneElement`
(`src/lib/schema/presentation.ts:346`) has no click/link/expand field on any
of its 13 variants.

Two existing mechanisms come close but don't solve it:

- `ElementAnimation.onAdvance` (`presentation.ts:168`) reveals an element on
  the *next* global advance (click-anywhere / arrow key) — it's a build-up,
  not a targeted click on a specific thing.
- The `nested`/"Dive" arrangement (`src/lib/present/arrange.ts:198`) already
  zooms into a scene placed inside another, but only as a whole-scene step in
  the linear sequence, decided by arrangement layout — not by clicking a
  specific element from any arrangement.

Captivate is presenter-driven and structurally has no self-paced/async
audience view (`docs/UX.md` "Presenter privacy is structural" — there is no
public read-only viewer). So "clickable" means the **presenter** clicks,
live, on the stage or the console — same person who already drives
`next`/`prev`, not an audience member with a mouse.

## Decisions made with the user

1. **Mechanism**: clicking a marked element flies the camera to an associated
   detail scene — no popups/modals/accordions. This reuses the camera engine
   exactly as-is and stays inside "the world has no rectangles."
2. **Return path**: "back" (click-left-third, the console's Back control, or
   Escape) retraces the dive — pops back to the exact scene + build-step the
   presenter was at, then resumes the normal sequence. Detail scenes are a
   branch, not inserted into the linear scene count, so the "3 / 7"-style
   progress indicator and the movement rail don't shift mid-talk.

## Design

### A. Content model: a hotspot is a property of an element, not a new element type

Add an optional field to `elementBase` (`presentation.ts:176`) rather than a
14th `SceneElement` variant, since *any* existing element (a chart, a callout,
an image, a phrase inside a text run) should be able to become a hotspot
without changing what it visually is:

```ts
hotspot: z
  .object({
    targetSceneId: z.string().min(1).max(64),
    label: z.string().max(120).default(""), // for the affordance / a11y name
  })
  .nullable()
  .default(null),
```

`targetSceneId` references any scene in the presentation by id — deliberately
**not** coupled to spatial nesting/arrangement. A hotspot's detail scene can
live anywhere in the deck (most naturally authored as a scene placed near its
parent, but the schema doesn't require it). Validate at the schema boundary
per AGENTS.md: `targetSceneId` must resolve to an existing scene id at
save-time (surfaced as a validation error in the inspector), same pattern
`parseSceneContent` already uses to salvage/repair bad content.

### B. Present-mode: hit-testing without breaking click-to-advance

`present-root.tsx:230`'s `advanceOnClick` currently treats the whole stage as
one click target with no `e.target` inspection — any element with a hotspot
must intercept its own click (`stopPropagation`) before it bubbles to that
handler, and must expose a real interactive target (`role="button"`,
`tabIndex`, keyboard-activatable) rather than relying on click alone, per
`docs/DESIGN.md`'s accessibility rules and the 28px minimum interactive size.
Rendering stays in `stage.tsx` (still `surface="bare"`, no new box/border
drawn around a hotspot element — the affordance is a small persistent glyph
near the element, not a rectangle around it, to hold the "no rectangles"
rule).

`stage.tsx` needs a present-mode-only prop (a callback, e.g. `onHotspot`)
threaded down to whichever element renderer owns each `SceneElement` variant,
firing only when `hotspot` is set and the stage is in present mode (editor
canvas clicks continue to mean "select this element," never "dive" — the
inspector remains where `hotspot` is authored, per the `elementBase` change
above, likely a new field group in `inspector.tsx`).

### C. Navigation stack: dive and return

`session.ts`'s `SessionState.sceneIndex` (line 36) is a single linear
number; `next`/`prev`/`goto` (lines 203–258) all act on it directly with no
concept of a branch. Add a `divePath: { sceneIndex: number; step: number }[]`
to `SessionState`:

- A new `dive(targetSceneId)` action resolves the id to an index, pushes the
  current `{ sceneIndex, step }` onto `divePath`, and flies to the target —
  same camera/flight path as any other `goto`, no special-cased travel style.
- `prev()` checks `divePath` first: if non-empty, pop it and fly back to the
  popped position instead of decrementing `sceneIndex` linearly. Only once
  `divePath` is empty does `prev` fall through to its current behavior.
- The Escape key and the console's existing Back control both call the same
  updated `prev`, so all three "go back" surfaces stay consistent by
  construction rather than needing three separate implementations.
- `PresentMessage` (`src/lib/present/protocol.ts:72`) needs `divePath` added
  to whatever message already carries `sceneIndex`/`overview`, so the console
  and stage windows agree on dive state the same way they already agree on
  scene position — this is additive to an existing discriminated union, not
  a new channel.
- Progress UI (`presenter-bar.tsx`'s scene counter, `movement-rail.tsx`) reads
  `divePath.length > 0` to show a distinct "in detail" state instead of
  advancing the X/Y count, consistent with the "branch, not linear" decision.

### D. Authoring affordance

In the editor's scene canvas (`canvas.tsx`/`inspector.tsx`), selecting an
element that supports a hotspot (essentially all of them — text-bearing and
media elements alike) gets a new inspector control: "Expands to detail scene"
with a scene picker. Per `docs/UX.md`'s "insertion is where you are looking"
philosophy, offer a one-click "Create detail scene here" that creates an
empty scene, wires the hotspot to it, and drops the editor into that new
scene — mirroring the existing gap-hover `+` affordance's spirit rather than
forcing the author to pre-create a scene and hunt for it in a picker.

## Non-goals

- No audience-facing/self-paced clicking — presenter-only, per the
  structural "no async viewer" finding above.
- No new element type, no popup/modal/accordion UI.
- No changes to the `nested`/"Dive" arrangement preset itself — hotspots are
  a separate, more general mechanism that happens to reuse the same camera
  dive *feel*, not a replacement for it. Both can coexist: an author could
  still use `nested` for a whole-scene dive sequence and hotspots for
  point-specific ones.
- No limit on how many hotspots a scene may have in this spec — if the audit
  during implementation finds it needs one (e.g. for the movement rail or
  health-score checks to stay legible), add it then rather than guessing now.

## Testing

- Schema: a scene content round-trip test asserting `hotspot` on an element
  survives save/reload (per AGENTS.md's "add the test that reloads and
  asserts it survived" rule) and that an invalid/dangling `targetSceneId` is
  caught at the boundary.
- Session store: unit tests for `dive`/`prev` — dive pushes and flies, prev
  pops before decrementing, multiple nested dives pop in the correct order,
  and `divePath` round-trips through `PresentMessage` between two simulated
  windows.
- Present-mode component test (Playwright `lifecycle` project, which mounts a
  component in a real browser with no server/account needed per AGENTS.md) or
  a `tests/unit/` interaction test: clicking a hotspot element does not also
  trigger `advanceOnClick`'s scene change.
- Visual verification via the `run` skill: author a hotspot in the editor,
  present, click it, confirm the camera dives, confirm back retraces it and
  the movement rail/counter don't shift.
- `npm run verify` gate per AGENTS.md.

## Risks

- Hit-testing a specific element inside a stage that's also handling
  whole-stage advance clicks is the main correctness risk — needs explicit
  test coverage (above), not just visual spot-checking, since a regression
  here silently breaks the basic clicker-driven advance gesture every
  presenter relies on.
- `divePath` is new present-mode session state that must be kept in sync
  across the stage/console `BroadcastChannel` split exactly like existing
  fields — get this wrong and the two windows disagree about where the
  presentation is, which `docs/UX.md`'s "the console works alone... yields to
  the stage" design explicitly guards against elsewhere.
