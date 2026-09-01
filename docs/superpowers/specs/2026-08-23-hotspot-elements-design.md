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
  the _next_ global advance (click-anywhere / arrow key) — it's a build-up,
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
14th `SceneElement` variant, since _any_ existing whole element (a chart, a
callout, an image, a heading) should be able to become a hotspot without
changing what it visually is:

```ts
hotspot: z
  .object({
    targetSceneId: z.string().min(1).max(64),
    label: z.string().max(120).default(""), // for the affordance / a11y name
  })
  .nullable()
  .default(null),
```

**MVP scope is whole-element only.** `hotspot` lives on `elementBase`, which
every `SceneElement` variant spreads — so a hotspot always targets one entire
element (a whole `TextElement`, a whole `ImageElement`, etc.), never a phrase
inside a `TextRun`. `TextRun` (`presentation.ts:187-196`) already has its own
`href: NavigableUrl.optional()` for inline links, which is a different,
existing mechanism (an external URL, not a same-deck dive) — this spec does
not extend or touch it. Inline-phrase hotspots (a `TextRun`-level
`hotspot`/dive field) are explicitly out of scope; if wanted later, that is a
new spec, because it needs its own schema shape and its own hit-testing story
(a run lives inside a `RichText` array inside one `TextElement` — clicking
"the fourth word" requires the renderer to hit-test sub-element spans, which
`stage.tsx` has no machinery for today).

`targetSceneId` references any scene in the presentation by id — deliberately
**not** coupled to spatial nesting/arrangement. A hotspot's detail scene can
live anywhere in the deck (most naturally authored as a scene placed near its
parent, but the schema doesn't require it). Validate at the schema boundary
per AGENTS.md:

- `targetSceneId` must resolve to an existing scene id at save-time. A
  dangling reference (the target scene was deleted after the hotspot was
  authored) is repaired the same way `parseSceneContent` already salvages
  corrupt content elsewhere: on load, any element whose `hotspot.targetSceneId`
  no longer resolves has its `hotspot` reset to `null` rather than the whole
  scene failing to parse. This is also the deletion story: deleting a scene
  does not need to hunt down and edit every element that might target it —
  the next load of any scene with a stale reference self-heals.
- **Self-target rejection.** `hotspot.targetSceneId` must not equal the id of
  the scene the element itself lives on — a scene diving into itself has no
  meaningful camera move and no meaningful return. Reject this at the same
  save-time boundary (surfaced as a validation error in the inspector, not a
  silent auto-correction, since — unlike a dangling reference from a delete
  elsewhere — this is a mistake in the authoring action just taken).
- **No depth/cycle restriction beyond self-targeting.** A chain of hotspots
  (scene A's hotspot → scene B, scene B's hotspot → scene C, ...) is ordinary,
  legitimate authoring — arbitrarily deep, since the design in section C
  below is a stack, not a fixed-depth structure. A cycle longer than one hop
  (A → B → A) is likewise not rejected: it is unusual authoring, not an
  invalid one — clicking A's hotspot to B, then B's hotspot back to A, simply
  pushes twice and the presenter can still retrace both hops with "back." The
  only structurally meaningless case is the immediate self-loop above.
- **Bounded stack depth**, not for correctness but the same defensive reason
  other arrays in this schema are capped (`SceneElement` array at
  `presentation.ts:440` is `.max(60)`): `divePath` (section C) is capped at a
  generous depth (e.g. 20) purely to bound worst-case state size; a real talk
  is never going to dive 20 levels deep, so this should never be visibly
  reached.

### B. Present-mode: hit-testing without breaking click-to-advance

`present-root.tsx:230`'s `advanceOnClick` currently treats the whole stage as
one click target with no `e.target` inspection — any element with a hotspot
must intercept its own click (`stopPropagation`) before it bubbles to that
handler, and must expose a real interactive target (`role="button"`,
`tabIndex`, keyboard-activatable via Enter/Space, not click-only) rather than
relying on click alone, per `docs/DESIGN.md`'s accessibility rules and the
28px minimum interactive size. Rendering stays in `stage.tsx` (still
`surface="bare"`, no new box/border drawn around a hotspot element — the
affordance is a small persistent glyph near the element, not a rectangle
around it, to hold the "no rectangles" rule).

**Accessible name is never empty.** `hotspot.label` defaults to `""`
(section A) so authoring never blocks on writing a label first — but an
empty `aria-label` on a real interactive control is a genuine accessibility
defect, not a cosmetic one. The rendered control's accessible name is `label`
when non-empty, otherwise a deterministic fallback derived from the target
scene's `title` (e.g. `` `Expand: ${targetScene.title}` ``) — always
resolvable, since `targetSceneId` is validated to reference a real scene
(section A). This fallback is computed at render time from the already-loaded
scene list, not stored, so a later rename of the target scene's title keeps
the fallback current automatically.

`stage.tsx` needs a present-mode-only prop (a callback, e.g. `onHotspot`)
threaded down to whichever element renderer owns each `SceneElement` variant,
firing only when `hotspot` is set and the stage is in present mode (editor
canvas clicks continue to mean "select this element," never "dive" — the
inspector remains where `hotspot` is authored, per the `elementBase` change
above, likely a new field group in `inspector.tsx`).

### C. Scene flow role: which scenes are "the sequence"

Add `flowRole: z.enum(["main", "detail"]).default("main")` to `Scene`
(`presentation.ts:542-559`). Every existing scene defaults to `"main"` on
load — this is purely additive, no migration of existing data needed beyond
the schema default. A scene becomes `"detail"` only when authored as a
hotspot's target (section E's authoring affordance sets it; a scene can also
be manually flagged detail without a hotspot pointing at it yet, e.g. while
drafting, though it is then unreachable until one does).

**Detail scenes are excluded from the ordinary sequence, deliberately with
the smallest possible change to how position is tracked.** `sceneIndex`
today (`session.ts:36`) is an index into the _full_ `scenes` array — that
meaning does not change, so the wire format (`PresentMessage`'s
`sceneIndex`/`goto` command index, `protocol.ts:80,124`) and `World`'s
`activeIndex` prop (an index into the full array it renders) both keep
working unmodified. What changes is how `next`/`prev` step through it:

- `next()` (`session.ts:218-227` today) advances from `sceneIndex` to the
  next index `i` where `scenes[i].flowRole !== "detail"`, skipping any detail
  scenes in between, rather than always `sceneIndex + 1`. If no such index
  exists before the array ends, `next()` no-ops exactly as it does today at
  the last scene.
- `prev()`'s ordering is, in this exact sequence:
  1. **Reverse a build step first** — unchanged from today
     (`session.ts:246`): if `current.step > 0`, decrement `step` and return;
     builds within a scene always unwind before anything else moves.
  2. **Then, if `divePath` (below) is non-empty, pop it** and fly back to the
     popped `{ sceneIndex, step }` — this is the "return from a detail
     branch" case, and it takes priority over decrementing `sceneIndex`
     linearly, since the presenter's previous position was a deliberate dive,
     not a step in the main sequence.
  3. **Only once both of those don't apply**, retreat from `sceneIndex` to
     the previous index `i` where `scenes[i].flowRole !== "detail"` (the
     `next()` skip logic, run backward), matching today's behavior at
     `sceneIndex === 0` (no-op) when no such index exists.
- `goTo(index)` is unchanged — an arbitrary jump (used by the scene-jumper
  and clicking a scene in overview) does not skip. The scene-jumper
  (`scene-jumper.tsx`) itself should list only `flowRole !== "detail"`
  scenes, though, since jumping directly into a detail scene out of context
  (skipping whatever hotspot leads to it) defeats the "entered deliberately"
  model — this is a picker-filtering change in that component, not a
  `goTo` change.
- A new `dive(targetSceneId)` action resolves the id to an index (which may
  be a detail _or_ a main scene — nothing technically requires a hotspot's
  target to be flagged `"detail"`, though authoring in section E always
  creates one that is), pushes the current `{ sceneIndex, step }` onto a new
  `divePath: { sceneIndex: number; step: number }[]` array on `SessionState`,
  and flies to the target — same camera/flight path as any other `goto`, no
  special-cased travel style.
- The Escape key and the console's existing Back control both call the same
  updated `prev`, so all three "go back" surfaces stay consistent by
  construction rather than needing three separate implementations.
- `PresentMessage` (`src/lib/present/protocol.ts:72`) needs `divePath` added
  to whatever message already carries `sceneIndex`/`overview`, so the console
  and stage windows agree on dive state the same way they already agree on
  scene position — this is additive to an existing discriminated union, not
  a new channel.

**Movements and progress must not count detail scenes either.** `movementsOf`
(`movement-rail.tsx:37-62`) walks the full `scenes` array by index to build
movement spans (`start`/`end` are indices into that same array, which
`MovementRail` then compares against `sceneIndex` — so this cannot switch to
a pre-filtered array without breaking that index correspondence). Instead,
`movementsOf` skips a `flowRole === "detail"` scene during its `forEach` (an
early `return` before the contiguity check) so it neither starts a new
movement nor extends the current one — a detail scene sitting between two
main scenes of the same section does not fragment that movement, and one
sitting between two different sections does not get attributed to either.
`totalScenes` (`session.ts:39,99,210`, threaded through to
`movement-rail.tsx:88,95` for the progress bar) must likewise become a count
of `flowRole !== "detail"` scenes, and the rail's progress fraction
`(sceneIndex + 1) / totalScenes` needs its numerator to be "how many main
scenes have been reached," not the raw index — both wrong the moment a
detail scene exists between position 0 and the current `sceneIndex`.

- Progress UI (`presenter-bar.tsx`'s scene counter, `movement-rail.tsx`) reads
  `divePath.length > 0` to show a distinct "in detail" state instead of the
  X/Y count entirely while diving, consistent with "detail scenes are a
  branch, not inserted into the linear count" (the decision already made
  with the user) — this is simpler than computing a main-sequence position
  for a scene that was never part of the main sequence to begin with.

### D. Protocol version, ahead of the phone-remote workstream depending on it

`PresentMessage`'s `state` variant (`protocol.ts:78-108`) gains
`protocolVersion: z.number().int().default(1)`, exported alongside a
`PROTOCOL_VERSION = 1` constant from `protocol.ts`. This workstream is the
first to need it — `divePath` is new, additive, load-bearing state, and the
existing comment at `protocol.ts:99-104` already establishes the pattern
this follows (defaulted fields so an old build's stage window and a new
build's console don't stop talking mid-talk). Bumping `PROTOCOL_VERSION`
becomes the signal for "this build's session-state shape changed" going
forward, which the phone remote control spec (workstream 4) explicitly
builds on for its own envelope version — introducing the concept here, where
the first real state-shape change in this protocol's history is actually
happening, rather than inventing it there with no precedent.

### E. Authoring affordance

In the editor's scene canvas (`canvas.tsx`/`inspector.tsx`), selecting an
element that supports a hotspot (any element — text-bearing and media
elements alike, whole-element only per section A) gets a new inspector
control: "Expands to detail scene" with a scene picker. Per `docs/UX.md`'s
"insertion is where you are looking" philosophy, offer a one-click "Create
detail scene here" that creates an empty scene (setting its `flowRole` to
`"detail"`), wires the hotspot to it, and drops the editor into that new
scene — mirroring the existing gap-hover `+` affordance's spirit rather than
forcing the author to pre-create a scene and hunt for it in a picker. The
scene picker for attaching an _existing_ scene as a target should still list
every scene regardless of `flowRole` (a main scene can legitimately be a
dive target too, per section C) — the `flowRole` filtering in section C
applies to the _sequence_ (next/prev/scene-jumper), not to what a hotspot may
point at.

## Non-goals

- No audience-facing/self-paced clicking — presenter-only, per the
  structural "no async viewer" finding above.
- No new element type, no popup/modal/accordion UI.
- No inline/phrase-level hotspots — whole-element only, per section A. A
  hotspot on part of a `TextRun` is a different, unbuilt schema shape and a
  different hit-testing problem; not this spec.
- No changes to the `nested`/"Dive" arrangement preset itself — hotspots are
  a separate, more general mechanism that happens to reuse the same camera
  dive _feel_, not a replacement for it. Both can coexist: an author could
  still use `nested` for a whole-scene dive sequence and hotspots for
  point-specific ones.
- No limit on how many hotspots a scene may have in this spec — if the audit
  during implementation finds it needs one (e.g. for the movement rail or
  health-score checks to stay legible), add it then rather than guessing now.
- No cycle/depth rejection beyond the single self-target case (section A) —
  a stack-based return path tolerates arbitrary legitimate chains.

## Testing

- Schema: a scene content round-trip test asserting `hotspot` on an element
  and `flowRole` on a scene both survive save/reload (per AGENTS.md's "add
  the test that reloads and asserts it survived" rule); a self-target
  `hotspot` is rejected at the save boundary; a scene deletion that orphans
  another element's `hotspot.targetSceneId` results in that `hotspot`
  resolving to `null` on the next load, not a parse failure.
- Session store: unit tests for `next`/`prev`/`dive` —
  - `next()`/`prev()` skip over `flowRole: "detail"` scenes in the main
    array, in both directions, including at the array boundaries (no-op
    where today's `next`/`prev` already no-op).
  - `prev()`'s exact precedence: a mid-build `step > 0` reverses the step
    before anything else; a non-empty `divePath` with `step === 0` pops and
    returns to the popped position; only with both exhausted does it fall
    through to the linear scene-to-scene case.
  - `dive()` pushes the current `{ sceneIndex, step }` and flies to the
    target; nested dives (dive from within a dive) push and pop in strict
    LIFO order across at least three levels.
  - `divePath` round-trips through `PresentMessage` between two simulated
    windows, and a `state` message missing `protocolVersion`/`divePath`
    (simulating an older build) does not break the receiving side — it
    defaults, per the existing pattern for `overview`/`establishing`.
  - `movementsOf` excludes `flowRole: "detail"` scenes from every movement's
    span, and does not fragment a movement when a detail scene sits between
    two main scenes of the same section.
  - `totalScenes` and the rail's progress fraction reflect only main scenes,
    verified with a fixture that includes at least one detail scene before,
    between, and after main scenes.
- Present-mode component test (Playwright `lifecycle` project, which mounts a
  component in a real browser with no server/account needed per AGENTS.md) or
  a `tests/unit/` interaction test:
  - Clicking a hotspot element does not also trigger `advanceOnClick`'s scene
    change (whole-stage click propagation is stopped).
  - A hotspot element is keyboard-activatable (focus it, press Enter or
    Space, confirm the same dive happens as a click would trigger).
  - An element with `hotspot.label === ""` still exposes a non-empty
    accessible name (the deterministic fallback from section B).
- Visual verification via the `run` skill: author a hotspot in the editor,
  present, click it, confirm the camera dives, confirm back retraces it and
  the movement rail/counter don't shift; confirm a nested dive (detail scene
  with its own hotspot to a further detail scene) retraces both hops in
  order.
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
- The `flowRole` skip-logic in `next`/`prev`/`movementsOf` (section C) keeps
  `sceneIndex` as an index into the _full_ scenes array specifically to avoid
  a second index space — but that means every future reader of `sceneIndex`
  has to remember it is not "the Nth main scene," it's "a position in the
  full array that happens to skip detail scenes when moving through it
  sequentially." A future change that reads `sceneIndex` as if it were a
  main-sequence position (rather than going through `next`/`prev`/
  `movementsOf`'s skip-aware logic) would silently miscount. Worth a code
  comment at the `sceneIndex` field itself, not just in this spec.
