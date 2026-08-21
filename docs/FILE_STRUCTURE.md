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
│  │  ├─ api/
│  │  │  ├─ ai/                    outline, generate, scene, rewrite, notes,
│  │  │  │                         visuals, status
│  │  │  ├─ assets/                Listing, and signed-URL resolution
│  │  │  └─ search/                Cross-entity search for the palette
│  │  ├─ auth/                     OAuth-style callback, POST-only sign-out
│  │  ├─ layout.tsx                Fonts, theme bootstrap, providers
│  │  ├─ page.tsx                  Landing
│  │  └─ globals.css               Design tokens
│  │
│  ├─ components/
│  │  ├─ ui/                       Primitives: button, input, dialog, toast,
│  │  │                            popover, tooltip, segmented, empty state
│  │  ├─ stage/                    The renderer — stage.tsx, element-view.tsx
│  │  ├─ editor/                   Canvas, navigator, inspector, docks, toolbars
│  │  ├─ present/                  Stage root, presenter bar, console,
│  │  │                            annotation layer, scene jumper
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
│  │  │  ├─ motion.ts              Entrance and transition presets
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
│  │  └─ utils/                    cn, formatting
│  │
│  └─ proxy.ts                     Session refresh and route gating
│
├─ supabase/
│  ├─ migrations/                  0001 core, 0002 storage
│  └─ tests/                       RLS isolation suite + runner
│
├─ tests/
│  ├─ unit/                        12 files, 238 tests
│  ├─ e2e/                         smoke.spec.ts, journey.spec.ts
│  └─ setup.ts                     jsdom shims
│
└─ docs/                           This documentation
```

---

## Where to start reading

1. `src/lib/schema/presentation.ts` — the content model. Everything else is
   downstream of it.
2. `src/components/stage/stage.tsx` — how a scene becomes pixels.
3. `src/lib/editor/store.ts` — how edits are tracked and saved.
4. `src/lib/present/session.ts` — how two windows stay in step.

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
