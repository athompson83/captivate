<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working in this repository

Captivate is an AI-native presentation, lecture and recording tool. `docs/ARCHITECTURE.md`
explains how the pieces fit together; `docs/FILE_STRUCTURE.md` says where things live.
This file is the short version of what you need to know before changing code.

## Session control

The Product Owner has preauthorized autonomous delivery until Captivate is explicitly
declared shipped and live. At the start of every material session, read and reconcile:

1. `AGENTS.md`
2. `APP_PROJECT_CONTROL_STANDARD.md`
3. `PROJECT_CHECKLIST.md`
4. `PROGRESS.md`

The control standard governs authority, fix-as-found behavior, GitHub/Vercel/Supabase
use, browser and Playwright testing, Production delivery, infrastructure reuse,
stale-code and branch cleanup, issue closeout, and the required session report. This
file remains the repository-specific technical layer. If status prose conflicts with
GitHub, deployment, database, or test evidence, refresh the prose and follow primary
evidence.

Before ending a material session, update `PROJECT_CHECKLIST.md` and `PROGRESS.md` once
near closeout, update the existing detailed status or release document when the product
state changed, and finish all safe recovery edges rather than assigning routine
engineering work to the Product Owner.

## Commands

```bash
npm run dev          # Next dev server
npm run verify       # typecheck → lint → unit tests → build. Run this before every commit.
npm run test         # vitest run (unit + component)
npm run test:watch   # vitest, watching
npm run test:e2e     # Playwright (needs a dev server and Supabase env vars)
npm run test:rls     # RLS policy tests against a local Postgres — see docs/DATABASE.md
npm run format       # prettier --write .
```

`npm run verify` is the gate. Nothing is "done" until it exits 0.

## The rules that actually bite

**A `"use server"` file may export only async functions.** Exporting a constant — even
a number — from one makes _every_ action in that file fail at runtime with a 500, and
the build says nothing. Shared constants go in a plain module;
`src/lib/data/upload-limits.ts` exists for exactly this reason. The server-action files
are `src/lib/{auth/actions,data/actions,data/assets,data/billing,data/notes,
data/recordings,data/remote-sessions,data/sourced-assets}.ts` — check the list is still
complete before adding another.

**Modules that touch secrets import `server-only`.** That turns an accidental client
import into a build error rather than a leaked key. Applies to the Supabase server and
admin clients, and to everything under `src/lib/ai/` that talks to a model.

**Validate at every boundary.** Zod on server-action input, API-route bodies, model
responses, cross-window `BroadcastChannel` messages, and content loaded from the
database. `parseSceneContent` salvages what it can from a corrupt scene rather than
throwing away a user's work. Model output is validated exactly like user input — see
`src/lib/ai/provider.ts`.

**URLs get schema-level protection, not a render-time check.** `NavigableUrl` and
`MediaSource` in `src/lib/schema/presentation.ts` restrict protocols; a bare `z.url()`
happily accepts `javascript:` and a test caught that reaching an anchor's `href`.

**Errors are values.** Server actions return `{ ok: true, data } | { ok: false, error }`.
Callers surface `error` in a toast. Don't throw across the boundary.

**A local edit that marks nothing dirty is not saved.** Every mutation goes
through `mutate` with the right `dirty*` option — and so does undo, which has to
mark what it reverted. This has bitten twice: section renames were silently lost
for a release, and the narrative map has ten times the editable surface. If you
add an editable field, add the test that reloads and asserts it survived.

**The narrative map is written whole, never partially.**
`captivate_replace_moments` deletes any moment the payload omits, because that
is how a deletion is persisted — so a partial write means "the author deleted
everything else". Sending only the moment that changed destroyed the rest of a
user's argument while every visible thing about the edit looked correct.

**Zod 4.** Object defaults are `.prefault({})`, not `.default({})`.

**Supabase row types are `type` aliases, not `interface`s.** Interfaces lack implicit
index signatures, and `GenericTable` then infers `Update` as `never`. Patches are typed
`Partial<PresentationRow>` and friends, never `Record<string, unknown>`.

## Analysis says what it measured

`src/lib/analysis/` scores a presentation, and the rule is that the score is
_only_ the weighted mean of its checks — no secret formula. Every check states
what it found in concrete terms ("2 of 2 have no alt text") and what to do about
it. A finding with no fix is a complaint, and there is a test asserting every
non-passing check carries one.

Two things worth knowing before extending it:

- durations are **estimated** from content where a scene has no rehearsal
  target, because almost nobody sets one and reporting a forty-minute lecture as
  two minutes is worse than saying nothing. Anywhere an estimate is shown, it
  says so;
- contrast uses WCAG relative luminance, not OKLab lightness. OKLab is right for
  _blending_ and wrong for a threshold — a number that looks like a contrast
  ratio and is not one is worse than no number.

## Sections are movements, and they persist

A section's `label` is the one-word name for what that stretch of the argument
does, and it is shown to the audience. Editing a section goes through
`updateSectionLocal`, which marks `dirtySections` — without that flag autosave
never looks at sections and the server action that writes them is dead code.
That is exactly what had happened: renaming a section updated the store, looked
like it had worked, and was gone on reload.

If you add another kind of editable state to the document, check that autosave
has a reason to notice it.

## The world has no rectangles

A scene on the world canvas is a _region_, not a card. It renders with
`surface="bare"`: no background, no border, no box, no clipping. The rule for
anything a scene might paint is **a colour is atmosphere, an image is content** —
a solid or gradient scene background is blended into the air around the region
rather than drawn, and only an image is still rendered, feathered at the rim.

This keeps regressing, so it is worth naming the shapes that have crept back so
far: a scene background, an empty image placeholder with a filled surface, and a
scrim drawn over a photograph that is not there. Each one made the page read as
slides again. If you are adding something that paints a filled rect the size of a
scene, it is almost certainly wrong on the canvas.

`Stage` still paints backgrounds in `card` mode — thumbnails, dashboard previews,
the editor canvas — where a scene really is a discrete object being looked at.

## The camera

Presenting is a camera moving over one canvas, and a flight is sixty transform
writes a second. None of them may go through React:

- the live camera is a ref, written to `style.transform` on one promoted layer;
- culling and level-of-detail key off the flight's _endpoints_, so React renders
  once per waypoint and never mid-flight;
- the animation is **not** torn down by its own effect's cleanup. That effect
  re-runs on every render — its target is a fresh object each time — and a
  cleanup that cancelled the frame killed every flight the moment anything else
  re-rendered. The session clock ticks once a second, so something always did.

There is no per-scene transition. Travel is set once per presentation
(`fly`, `dissolve`, `cut`); the camera move is the transition.

## Presenter-material safety

The stage route (`/present/[id]`) never loads speaker notes or lecture notes. This is a
load-boundary rule, not a rendering rule — private material cannot leak onto a projector
through a state bug if it was never sent to that window. `forAudience` rebuilds each
scene field by field rather than spreading it, so a new field on `Scene` fails typecheck
until somebody has decided whether an audience may see it. Don't "just pass it down" for
convenience.

The timer and the scene jumper are a weaker case and are handled differently: single-
screen presenting needs them in the same window as the stage, so they render there and
are gated on `audienceOnly` — a rendering guard, driven by a query parameter. That is a
deliberate exception for material that is merely _presenter-facing_ rather than private.
Notes are the thing the boundary exists for, and they are still never loaded.

The phone remote (`/present/[id]/remote`) follows the strict rule, and more strictly: a
phone is the device most likely to be handed to someone. `tests/unit/remote-load-boundary.test.ts`
reads the route's source rather than rendering it, because the claim is about what the
module imports at all.

## React Compiler

The React Compiler lint rules are on and treated as errors, not suggestions. When one
fires, fix the cause:

- reading `Date.now()`, `document`, or a DOM measurement during render →
  `useSyncExternalStore`, or put the value in the store (`nowMs` in the present session
  is in state for this reason);
- writing derived layout back into state → derive it in render, or write it straight to
  a CSS custom property from a `ResizeObserver` (`Stage` does this for fit-to-container
  scale, which is also faster than re-rendering every element on resize);
- a component-typed value in a lookup table → `createElement(iconFor(name), props)`.

Don't reach for `eslint-disable`.

## Zustand selectors

A selector that builds a new array or object needs `useShallow`, or React tears itself
apart with "Maximum update depth exceeded". `useSelectedElements` is the worked example.
There is a regression test for it; it genuinely fails if you revert the fix.

## Style

- Movement, moment, scene — never "slide", except in import and compatibility
  code. A **movement** is a stretch of argument (a `sections` row), a **moment**
  is a pre-generation beat, a **scene** is the rendered output.
- Comments explain **why**, not what. If the code needs a narrator, rewrite the code.
- Match the surrounding file's density and idiom.
- Tailwind v4: design tokens in `@theme`, custom utilities via `@utility`. Colours are
  OKLCH tokens — no raw hex in components.
- Geometry on the stage is normalised 0–100, never pixels. One renderer
  (`src/components/stage/stage.tsx`) serves the editor, thumbnails, present mode and
  recording, so a scene cannot look different in the room than it did while authoring.
- Prettier decides formatting. Don't hand-align.
- Global CSS goes in `@layer base`. An unlayered rule outranks every Tailwind
  utility regardless of specificity — a bare `* { border-color }` reset once
  beat `border-transparent` everywhere, turning in-place prose fields into a
  page of boxes.

## Tests

Unit and component tests live in `tests/unit/`; end-to-end specs live in
`tests/e2e/`. When you fix a bug, add the test that fails without the fix — and check
that it does fail. Several tests in this repo exist because a "fix" turned out not to
have been applied at all.

Two Playwright projects need no server and no account — `shader` compiles the
committed GLSL and reads the pixels back, `lifecycle` bundles a component and
mounts it in a real browser. Reach for those before concluding that something is
untestable outside a running application.

## Database

Migrations are append-only files in `supabase/migrations/`, applied in name order. Every
table has RLS enabled and is owner-scoped; helper functions are `SECURITY DEFINER` with
a pinned `search_path`. Storage buckets are private and served through signed URLs.
Adding a table means adding its policies in the same migration — see `docs/DATABASE.md`.

## Don't

- Commit credentials, service-role keys or `.env.local`.
- Ship a control that looks functional but isn't. An unbuilt feature is absent, not
  disabled-with-a-tooltip.
- Let model output reach the document without passing its schema.
- Describe something in `docs/` that the code does not do. Documentation here is meant
  to be accurate about what exists, including what doesn't.
