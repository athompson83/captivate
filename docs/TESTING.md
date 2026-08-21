# Testing

```bash
npm test                                   # unit — Vitest
npm run test:e2e                           # end-to-end — Playwright
npm run test:rls                           # database isolation — psql
npm run verify                             # typecheck, lint, unit, build
```

---

## What is covered

**238 unit tests** across twelve files, plus **26 end-to-end tests**, plus a
database isolation suite.

The tests concentrate on the things that would hurt: losing work, leaking data,
and rendering something broken in front of a room.

### Unit

| File                  | Covers                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `presentation-schema` | Defaults, unknown element rejection, corrupt-content recovery, URL scheme safety                     |
| `geometry`            | Snapping, resize anchoring, aspect lock, clamping, align and distribute, marquee                     |
| `layouts`             | All 14 layouts stay on stage and inside the safe area; relayout preserves text                       |
| `editor-store`        | Dirty tracking, the autosave revision guard, undo/redo with coalescing, element and scene operations |
| `editor-selectors`    | The React bindings — specifically that a selector cannot re-render forever                           |
| `debounced-save`      | Debounce, per-record merging, in-flight queueing, flush on unmount and tab hide                      |
| `ai-schemas`          | Output caps, layout restrictions, fallback quality, title derivation                                 |
| `present`             | Cross-window message validation, build step counting, motion presets, session command routing        |
| `stage-render`        | Real rendering: text as text, alt text, chart descriptions, sandboxing, builds, auto-fit             |
| `fit-text`            | Auto-fit maths, including that a thumbnail and the stage agree                                       |
| `theme-and-recorder`  | Theme integrity, template validity, recorder capability detection                                    |
| `format`              | Duration, bytes, relative time, including nonsense input                                             |

### End-to-end

**Smoke** (10 tests, no account needed) — public pages render, security headers
are present, keyboard focus is visible, there are no console errors, nothing
overflows at 390px, both colour schemes work, and reduced motion is respected.

**Journeys** (16 tests, needs an account) — sign in, create from a template, add
an element, autosave, survive a reload, undo and redo, write speaker notes and
verify they do not appear on the audience surface, present with no editor
chrome, navigate by keyboard, use the laser/highlight/ink tools and clear them,
blank the screen, open the presenter console, verify cross-window sync, open the
recording dialog, write a lecture note and reload it, filter the library, and
use the command palette.

Journeys are **skipped, not failed**, when credentials are absent, so the suite
never produces misleading red on a machine without an account.

```bash
CAPTIVATE_E2E_EMAIL=you@example.com \
CAPTIVATE_E2E_PASSWORD=... \
CAPTIVATE_E2E_URL=https://your-host \
npx playwright test --project=authenticated
```

### Database

`supabase/tests/run.sh` applies the migrations to a throwaway Postgres, creates
two users, and asserts that neither can read, write, update or delete the
other's data, and that neither can forge `owner_id`. It exits non-zero on any
leak.

The same probes were run against the live project through PostgREST with two
real JWTs — the actual production path, not a simulation of it.

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
