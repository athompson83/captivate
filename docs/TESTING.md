# Testing

```bash
npm test                                   # unit — Vitest
npm run test:e2e                           # end-to-end — Playwright
npm run test:rls                           # database isolation — psql
npm run verify                             # typecheck, lint, unit, build
```

---

## What is covered

**485 unit tests** across twenty-three files, plus **47 Playwright tests** in
four projects, plus a database isolation suite.

The tests concentrate on the things that would hurt: losing work, leaking data,
and rendering something broken in front of a room.

### Unit

| File                    | Covers                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `presentation-schema`   | Defaults, unknown element rejection, corrupt-content recovery, URL scheme safety                     |
| `geometry`              | Snapping, resize anchoring, aspect lock, clamping, align and distribute, marquee                     |
| `layouts`               | All 14 layouts stay on stage and inside the safe area; relayout preserves text                       |
| `editor-store`          | Dirty tracking, the autosave revision guard, undo/redo with coalescing, element and scene operations |
| `editor-selectors`      | The React bindings — specifically that a selector cannot re-render forever                           |
| `debounced-save`        | Debounce, per-record merging, in-flight queueing, flush on unmount and tab hide                      |
| `ai-schemas`            | Output caps, layout restrictions, fallback quality, title and subject extraction                     |
| `narrative-map`         | Movement and moment ordering, duration totals, stable ids, backward derivation, evidence, briefs     |
| `narrative-persistence` | That every map edit reaches the server — and that the write is never partial                         |
| `present`               | Cross-window message validation, build step counting, motion presets, session command routing        |
| `stage-render`          | Real rendering: text as text, alt text, chart descriptions, sandboxing, builds, auto-fit             |
| `fit-text`              | Auto-fit maths, including that a thumbnail and the stage agree                                       |
| `theme-and-recorder`    | Theme integrity, template validity, recorder capability detection                                    |
| `format`                | Duration, bytes, relative time, including nonsense input                                             |
| `camera`                | The flight path, the arrangements and the route — see **The camera** below                           |
| `movements`             | Movement derivation, ordering and labelling from sections                                            |
| `ambient`               | Colour maths and OKLab blending — see **Atmosphere** below                                           |
| `atmosphere`            | The GPU layer's arithmetic: screen → world, packing, the DPR cap, the WebGL probe                    |
| `atmosphere-lifecycle`  | Reduced motion, the no-WebGL path, and that every loop it starts it also stops                       |
| `world-render`          | Flights stepped frame by frame, with a `cancelAnimationFrame` that really cancels                    |
| `health`                | Pacing, balance, contrast and the health checks — see **Analysis** below                             |
| `embed-sandbox`         | That an embed of this deployment is never framed with `allow-same-origin`                            |
| `present-load-boundary` | That the stage route sends the projector no speaker notes — asserted on the payload, not the DOM     |

### End-to-end

Four projects. Two of them need nothing at all: `shader` and `lifecycle` run
against no server and no account, so the cheapest and most diagnostic tests in
the suite are also the easiest to reach.

```bash
npx playwright test --project=shader      # compiles the committed GLSL
npx playwright test --project=lifecycle   # mounts the component in a browser
```

**Smoke** (10 tests, no account needed) — public pages render, security headers
are present, keyboard focus is visible, there are no console errors, nothing
overflows at 390px, both colour schemes work, and reduced motion is respected.

**Journeys** (21 tests, needs an account) — sign in, create from a template, add
an element, autosave, survive a reload, undo and redo, write speaker notes and
verify they do not appear on the audience surface, present with no editor
chrome, navigate by keyboard, use the laser/highlight/ink tools and clear them,
blank the screen, open the presenter console, verify cross-window sync, open the
recording dialog, write a lecture note and reload it, filter the library, and
use the command palette.

**The narrative map** (6 tests, in the same project) — a template arrives with a
real argument rather than an empty page; an edited moment, an added moment and a
deleted moment each survive a reload; the duration warning appears without
blocking generation and the rescale clears it; and a presentation created before
the map existed still opens one.

**The shader** (5 tests, no server) — compiles the committed GLSL, draws it with
regions of known colour at known positions, and reads the pixels back.

**The lifecycle** (5 tests, no server) — bundles
`src/components/stage/atmosphere.tsx` itself and mounts it under StrictMode in a
browser that really has WebGL, then unmounts and remounts it. See **Atmosphere**
below for what that is for.

Journeys are **skipped, not failed**, when credentials are absent, so the suite
never produces misleading red on a machine without an account.

```bash
CAPTIVATE_E2E_EMAIL=you@example.com \
CAPTIVATE_E2E_PASSWORD=... \
CAPTIVATE_E2E_URL=https://your-host \
npx playwright test --project=authenticated
```

### Database

`supabase/tests/run.sh` applies `0001_captivate_core.sql` to a throwaway
Postgres, creates two users, and asserts that neither can read, write, update or
delete the other's data, and that neither can forge `owner_id`. It exits
non-zero on any leak.

It applies **only** that first migration, and probes only `presentations`,
`sections`, `scenes` and `lecture_notes`. So `moments` — the narrative map's own
table, added in `0006` — is not covered by it, nor are `assets`, `recordings`,
`folders`, `profiles` or `ai_generations`. Those policies were verified against
live PostgREST with two real JWTs instead, which is the actual production path;
they are not in the automated suite, and that is a gap rather than a decision.

---

## Bugs these tests actually caught

Worth recording, because it is the argument for the tests existing:

1. **Stored XSS.** `z.url()` accepts `javascript:alert(1)`, and that href was
   rendered straight into an anchor on the stage. Found by a test written
   specifically to try dangerous schemes.
2. **Silent data loss on layout change.** Switching a scene to the quote layout
   discarded its heading, because heading and quote were treated as unrelated
   slots. Found by round-tripping a heading through every layout.
3. **Infinite render loop.** `useSelectedElements` built a new array on every
   store read, which `useSyncExternalStore` treats as a changed snapshot — the
   editor crashed the instant anything was selected. The regression test was
   verified to fail when the fix is reverted.
4. **Every server action returning 500.** A `"use server"` module also exported
   two constants, which Next rejects wholesale. Found by running the app.
5. **Dropped note edits.** The first version of `useDebouncedSave` kept one
   pending slot, so editing a title and then a body within one debounce window
   sent only the body.
6. **Section renames never saved.** `renameSectionLocal` marked nothing dirty,
   autosave never looked at sections, and the action that wrote them was dead
   code. The rename looked perfect until you refreshed.
7. **The map destroying itself on every edit.** `captivate_replace_moments`
   deletes any moment the payload omits, and autosave sent only the moment that
   changed — so editing one field deleted the rest of the argument. Every
   assertion about the edited moment passed while it happened. Caught by running
   the end-to-end suite in serial against one presentation and noticing the map
   had one moment left in a failure screenshot.
8. **A page of boxes instead of an argument.** An unlayered `* { border-color }`
   reset outranked every Tailwind border utility including `border-transparent`,
   so the map's in-place prose fields drew a box around every line. Caught by
   looking at a screenshot, then confirmed against the computed style.
9. **A white sheet over the world.** `forceContextLoss()` on unmount destroyed
   the context React's development remount then inherited on the same canvas.
   A pixel read taken before teardown still showed the right colour, which is
   what made it look like a shader fault for as long as it did.
10. **"Focus on 45-minute."** The fallback map wove the top keyword of the brief
    into every movement purpose, and in a one-line brief every word appears once
    — so a measurement won the alphabetical tie-break. A subject is now only
    named when the author repeated it.

---

## What is not covered

- **Recording end-to-end.** Playwright can grant camera and microphone with fake
  devices, but `getDisplayMedia` requires a real picker interaction. The tests
  verify the setup dialog, device enumeration and honest capability reporting;
  the capture itself was verified by hand.
- **Multi-display placement.** Two-window sync is tested; physically dragging a
  window to a projector is not automatable.
- **Email delivery.** Confirmation and recovery emails are a Supabase concern.
- **Visual regression.** No screenshot diffing. Rendering is asserted
  structurally instead — text present, alt text set, sandbox attributes correct,
  fitted sizes within bounds.
- **Load.** No benchmark for a 200-scene deck. The architecture is designed for
  it — per-scene saves, memoised elements, lazy media — but it is untested at
  that size.

---

## Conventions

Tests assert behaviour, not implementation. They are written to fail for a
reason a person would care about, and each carries a comment explaining what
would break in the product if it regressed.

Where a test needed a browser API jsdom lacks, the shim lives in
`tests/setup.ts` and is labelled as an environment shim rather than behaviour
under test.

---

## The camera

`tests/unit/camera.test.ts` covers the flight path, the arrangements and the
route. The properties worth stating, because they are the ones that would fail
silently rather than loudly:

- a flight starts exactly where it began and ends exactly where it was sent;
- it pulls back over a long distance and does not over a short one;
- pan progress is monotone, and zoom interpolates geometrically;
- a spin takes the short way round;
- path length grows sub-linearly with distance, so a trip across the world is
  not fifty times slower than a hop next door;
- **no arrangement ever half-overlaps two consecutive scenes** — they are either
  clearly apart or one sits wholly inside the other.

`tests/unit/world-render.test.tsx` drives `requestAnimationFrame` by hand so a
flight can be stepped frame by frame. Its `cancelAnimationFrame` really drops
the callback: an earlier version only pretended to, and a mock that cannot
cancel makes the whole file unable to see the bug it exists for.

Two regression tests there are worth keeping honest. Both fail if their fix is
reverted, and both were verified to do so:

- a flight keeps going when something unrelated re-renders the tree;
- `EmptyState` takes a rendered icon rather than a component, because a function
  cannot cross the server/client boundary.

## Atmosphere

`tests/unit/ambient.test.ts` pins the colour maths and the blending, including
the property the whole thing exists for: a blend from a dark blue to an amber
keeps real chroma at the midpoint rather than passing through grey.

Two properties are stated carefully because they are easy to assert wrongly:

- the region the camera is over **dominates** the blend, but does not win
  outright — distant regions keep a small bounded weight, and that is what stops
  the colour snapping as the camera crosses an invisible boundary. The test
  asserts closeness, not equality, and says why;
- twenty light regions far away must not lift the dark one you are standing on,
  which is what averaging every scene would do.

`tests/unit/atmosphere.test.ts` covers the GPU layer's arithmetic, which is the
part of a shader a test can reach. The one that matters asserts that screen →
world genuinely inverts the transform the world applies, by parsing the real
`worldTransform` string rather than recomputing it — a shader that puts the air
in the wrong place looks like a shader that is merely ugly, and would be
debugged as one for a long time. It was checked to fail against a flipped
rotation sign.

`tests/unit/atmosphere-lifecycle.test.tsx` covers what the component does around
that arithmetic — reduced motion, the no-WebGL path, and that every animation
loop it starts it also stops.

`tests/e2e/atmosphere.spec.ts` (the `shader` Playwright project) covers the part
no unit test can reach: it compiles the committed GLSL, draws it on a bare
canvas with regions of known colour at known positions, and reads the pixels
back. It needs no server and no account.

That spec exists because of a specific failure. For two commits the field's Y
axis was reflected — three's `PlaneGeometry` puts `uv.v = 1` at the top and
screen space puts `y = 0` there — so a region above the camera lit the bottom of
the screen. It survived a code review, an offline render, a browser screenshot
and a pixel sample of that screenshot, because a reflected gradient still looks
like a gradient. It took placing one warm region above the camera and measuring
both halves to see it. The spec now does exactly that, and was checked to fail
against the old line.

It also found a defect no test at the time could have caught: the layer
rendered as a flat white sheet over the whole world. Reading the drawing buffer back through
three's own context gave the right colour, and the same GLSL on a raw context
was correct, so the shader was never at fault — `forceContextLoss()` in the
cleanup was. It is the textbook way to stop WebGL contexts accumulating, and it
is wrong here: React mounts, unmounts and mounts again in development, reusing
the same `<canvas>`, and a canvas has one context for its lifetime. The second
mount inherited the context the first had just destroyed. `dispose()` alone is
what this component wants.

`tests/e2e/atmosphere-lifecycle.spec.ts` (the `lifecycle` project) is the test
that now catches it. Seeing that failure needs three things at once — a real
WebGL implementation, React's development double-invoke, and one canvas across
both mounts — so the spec bundles the component itself with Vite in development
mode, opens it as a local page, and drives the mounts from the test. It reads
the drawing buffer back through the canvas's own context, which is also the only
way to ask whether the context a remount inherited is still alive.

Two things keep it honest. It asserts that a single mount produced **two**
registrations and one release — React having torn the effect down and set it up
again — because a production bundle would report one, and everything after that
would pass while testing nothing. And it was checked against the defect: with
`forceContextLoss()` restored, all five fail, the first of them saying that the
remount inherited a destroyed context.

It also covers what removing that call could plausibly have broken. Twelve
unmount-and-remount cycles in a row must each end with a live context and a
drawn frame, because releasing a context when its detached canvas is collected,
rather than at once, is exactly the trade `forceContextLoss()` existed to avoid.
And a context taken away mid-presentation must leave the canvas hidden with
nothing still spinning — which is how the drift loop was found still driving a
dead context twelve times a second, forever, behind a canvas nobody could see.

What no test here covers is whether the field _looks_ right. That is a judgement
about pixels, and it belongs to a person looking at them.

## Analysis

`tests/unit/health.test.ts` covers pacing, balance, contrast and the health
checks. Two properties are load-bearing:

- **the score is the weighted mean of its checks and nothing else**, asserted by
  recomputing it in the test from the returned checks. If it ever became a
  secret formula, none of the detail lines would be worth reading;
- **every non-passing check carries a fix**, across several shapes of document.
  A finding with no fix is a complaint.

Contrast is pinned to the WCAG reference points — black on white is 21:1, a
colour against itself is 1:1 — because the whole value of reporting a ratio is
that it means what everyone else means by it.

An empty presentation is its own case: most checks pass vacuously on one ("no
scene is a wall of text" is true and meaningless with no scenes), which scored
an empty deck as Good until it was given an explicit answer.
