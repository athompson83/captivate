# File structure

```
captivate/
├─ src/
│  ├─ app/                         Routes
│  │  ├─ (auth)/                   Sign in, sign up, recovery — split layout
│  │  ├─ (app)/                    Dashboard shell: nav rail + content
│  │  │  ├─ home/                  Recent decks, creation paths, recordings
│  │  │  ├─ presentations/         Library: search, folders, tags, trash
│  │  │  ├─ notes/                 Full-page lecture-notes workspace
│  │  │  ├─ assets/                Media library
│  │  │  ├─ templates/             Gallery with real composed previews
│  │  │  ├─ recordings/            Playback, chapters, download
│  │  │  ├─ settings/              Profile, theme, shortcuts
│  │  │  └─ new/                   Creation flow (template and AI paths)
│  │  ├─ edit/[id]/                Editor — its own chrome, outside the shell
│  │  ├─ present/[id]/             The stage (audience view)
│  │  │  └─ console/               The presenter console
│  │  ├─ v/[token]/                Public share-link viewer — no account
│  │  ├─ handout/[id]/             Print/PDF export, owner only
│  │  ├─ api/
│  │  │  ├─ ai/                    map, create-from-map, scenes-from-map,
│  │  │  │                         moment, evidence, scene, rewrite, notes,
│  │  │  │                         visuals, status
│  │  │  ├─ assets/                Listing, and signed-URL resolution
│  │  │  └─ search/                Cross-entity search for the palette
│  │  ├─ auth/                     OAuth-style callback, POST-only sign-out
│  │  ├─ layout.tsx                Fonts, theme bootstrap, providers
│  │  ├─ page.tsx                  Landing
│  │  ├─ icon.png                  Favicon, apple-icon.png, opengraph-image.jpg
│  │  │                            — Next's file conventions, so the tags are
│  │  │                            generated rather than hand-written
│  │  └─ globals.css               Design tokens
│  │
│  ├─ components/
│  │  ├─ ui/                       Primitives: button, input, dialog, toast,
│  │  │                            popover, tooltip, segmented, empty state
│  │  ├─ narrative/                The map: movement bands, moment cards,
│  │  │                            scene generation from an accepted map
│  │  ├─ editor/journey-map.tsx    Direct manipulation of the world canvas
│  │  ├─ editor/journey-panel.tsx  Arrangement and camera settings
│  │  ├─ stage/                    The renderers — stage.tsx (one scene),
│  │  │                            world.tsx (the canvas and the camera),
│  │  │                            atmosphere.tsx (the air, in WebGL)
│  │  ├─ editor/                   Canvas, navigator, inspector, docks, toolbars
│  │  ├─ present/                  Stage root, presenter bar, console,
│  │  │                            annotation layer, scene jumper,
│  │  │                            movement rail (the argument's shape,
│  │  │                            shown to the room), shared viewer
│  │  ├─ handout/                  The paper version of a deck
│  │  ├─ record/                   Recording controller and setup dialog
│  │  ├─ dashboard/                Cards, library, galleries, settings
│  │  ├─ notes/                    Notes workspace
│  │  ├─ auth/                     Auth forms
│  │  ├─ app-shell.tsx             Nav rail, user menu, command palette host
│  │  └─ command-palette.tsx       ⌘K
│  │
│  ├─ lib/
│  │  ├─ schema/
│  │  │  ├─ presentation.ts        THE content model. Start here
│  │  │  ├─ narrative.ts           THE argument model: movements, moments,
│  │  │  │                         roles, visual intent, evidence references
│  │  │  └─ theme.ts               Six themes as token sets
│  │  ├─ editor/
│  │  │  ├─ store.ts               Document store, history, dirty tracking
│  │  │  ├─ autosave.ts            Debounce, revision guard, backoff
│  │  │  ├─ geometry.ts            Snapping, resize, align, marquee
│  │  │  ├─ layouts.ts             14 compositions, compose and extract
│  │  │  ├─ element-factory.ts     Defaults for every element type
│  │  │  └─ shortcuts.ts           Keyboard map
│  │  ├─ present/
│  │  │  ├─ session.ts             Session store + React binding
│  │  │  ├─ protocol.ts            Cross-window messages, Zod-validated
│  │  │  ├─ motion.ts              Entrance and emphasis presets
│  │  │  ├─ camera.ts              Optimal zoom-and-pan flight (Van Wijk & Nuij)
│  │  │  ├─ arrange.ts             Spatial arrangements of scenes on the world
│  │  │  ├─ path.ts                The smoothed route drawn between waypoints
│  │  │  ├─ ambient.ts             Atmosphere: the colour of the air per position
│  │  │  ├─ atmosphere.ts          The same, per pixel: uniforms for the shader
│  │  │  └─ audience.ts            What the projector window is allowed to load
│  │  ├─ narrative/
│  │  │  ├─ map.ts                 Assemble, derive, reorder, diff the map
│  │  │  └─ generate.ts            Proposal → map; map → per-moment briefs
│  │  ├─ data/evidence.ts          What a claim may be grounded in, RLS-scoped
│  │  ├─ analysis/pacing.ts        How long a presentation actually takes
│  │  ├─ analysis/health.ts        Checks a presenter would change the deck over
│  │  │  ├─ fit-text.ts            Deterministic auto-fit
│  │  │  ├─ stage.ts               Stage geometry helpers
│  │  │  └─ fullscreen.ts          Fullscreen and wake lock
│  │  ├─ record/recorder.ts        MediaRecorder state machine, compositing
│  │  ├─ ai/
│  │  │  ├─ schemas.ts             Output schemas — the wall
│  │  │  ├─ provider.ts            The only door to a model
│  │  │  ├─ service.ts             Application-level operations
│  │  │  ├─ fallback.ts            Deterministic generator
│  │  │  ├─ rate-limit.ts          Database-backed limiter
│  │  │  ├─ route-helpers.ts       Auth + limit + validate guard
│  │  │  └─ client.ts              Browser callers
│  │  ├─ data/
│  │  │  ├─ actions.ts             Presentation, scene, section, folder writes
│  │  │  ├─ presentations.ts       Read side (server-only)
│  │  │  ├─ notes.ts               Lecture notes
│  │  │  ├─ assets.ts              Asset registration
│  │  │  ├─ recordings.ts          Recording metadata
│  │  │  ├─ upload.ts              Browser → storage upload
│  │  │  ├─ upload-limits.ts       Shared constants (not a server module)
│  │  │  └─ use-debounced-save.ts  Durable debounced save for notes
│  │  ├─ supabase/                 client, server, admin, config, types
│  │  ├─ templates/registry.ts     Six curated templates
│  │  └─ utils/                    cn, formatting, OKLab/WCAG colour, embed
│  │                               sandboxing
│  │
│  └─ proxy.ts                     Session refresh and route gating
│
├─ public/
│  ├─ brand/                       The kit's artwork: the app icon, the symbol
│  │                               on its own, and the endorsed lockup
│  ├─ mediapipe/                   Segmentation runtime for background removal
│  └─ models/                      Its weights
│
├─ supabase/
│  ├─ migrations/                  0001 core … 0028, applied in name order
│  └─ tests/                       RLS isolation suite + runner
│
├─ tests/
│  ├─ unit/                        88 files
│  ├─ e2e/                         16 specs across four Playwright projects:
│  │                               smoke and authenticated need a server,
│  │                               shader and lifecycle need neither
│  └─ setup.ts                     jsdom shims
│
└─ docs/                           This documentation
```

---

## Where to start reading

1. `src/lib/schema/presentation.ts` — the content model. Everything else is
   downstream of it.
2. `src/lib/schema/narrative.ts` — the argument model. What a presentation is
   _for_, decided before any of it is rendered.
3. `src/components/stage/stage.tsx` — how a scene becomes pixels.
4. `src/components/stage/world.tsx` — how scenes become a place, and how the
   camera moves between them.
5. `src/lib/editor/store.ts` — how edits are tracked and saved.
6. `src/lib/present/session.ts` — how two windows stay in step.
7. `src/lib/billing/plans.ts` — what each plan allows. Pure and isomorphic, so
   the pricing page, the entitlement gate and the tests all read one source.

---

## Conventions

**Server boundaries are explicit.** `"use server"` files export only async
functions — a constant in one makes every action in it fail at runtime. Shared
constants live in a plain module (`upload-limits.ts` exists for exactly this
reason). Modules holding secrets are marked `server-only`, which turns a client
import into a build error.

**Validation at every boundary.** Zod on every server action, API route, model
response and cross-window message. Content is validated before it is stored and
again when it is read.

**Errors are values.** Server actions return `{ ok: true, data } | { ok: false,
error }` rather than throwing, so the editor can surface a save failure without
unmounting the user's work.

**Comments explain why.** The what is in the code. Comments cover the reasoning
that would otherwise be lost — why scenes are JSONB, why auto-fit is estimated
rather than measured, why the console yields to the stage.
