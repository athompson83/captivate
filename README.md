# Captivate

Captivate is a web application for building and delivering presentations. It is
built around the moment you stand up to speak: a real presenter console, live
annotation over your work, and recording with your microphone and camera in a
single file.

**There is no slide reel.** A presentation is one unbounded canvas with every
scene placed somewhere on it, and presenting moves a camera between those
places. Scenes sit side by side, or wind out in a spiral, or nest inside one
another so that advancing dives into a detail of what the room is already
looking at. The audience can see where an idea sits in relation to everything
around it, which a stack of pages cannot show them.

A conventional deck is still there — it is the arrangement where the scenes
happen to be in a row at one zoom, running through the same engine.

```
Place  →  Present  →  Annotate  →  Record
```

---

## What it does

**Place.** A typed scene model with fourteen element types, fourteen designed
layouts, six themes, drag-and-resize direct manipulation with snapping and
alignment, undo/redo, and per-scene autosave that will not lose your work. Then
a journey map, where you arrange those scenes in space — six arrangements to
start from, and drag anything anywhere afterwards.

**Present.** A dedicated stage route that renders the audience view and nothing
else — the presenter console is a separate route, so private material has no
code path onto a projector. Full-screen, keyboard-driven, with element builds
and a camera that flies rather than cuts. Press `O` to pull back over the whole
journey and see the route; click any scene to fly to it.

**Annotate.** Laser pointer, drag-to-highlight, freehand ink in five colours and
three weights, eraser, clear-scene and clear-all. Annotations are session
overlays; they never modify the saved presentation.

**Record.** Screen capture plus microphone, with an optional camera composited
into the video itself. The file downloads immediately and uploads to your
library; a failed upload is reported honestly rather than silently swallowed.

**Notes.** Two separate systems, because they are two different things:
per-scene _speaker notes_ (the short prompts you glance at) and _lecture notes_
(the long-form research and teaching material behind a deck, in a full-page
writing surface).

**AI.** Prompt → reviewable outline → generated deck. The model answers through
a validated schema whose limits structurally prevent wall-of-text scenes, and
content is poured into the layout engine rather than positioned by the model.
Every generated element is ordinary editable content.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # add your Supabase URL and publishable key
npm run dev
```

Apply the database migrations in `supabase/migrations/` in order — see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the exact steps and the two auth
settings that need attention.

### Commands

| Command             | What it does                                               |
| ------------------- | ---------------------------------------------------------- |
| `npm run dev`       | Development server                                         |
| `npm run build`     | Production build                                           |
| `npm run typecheck` | TypeScript, no emit                                        |
| `npm run lint`      | ESLint, including the React Compiler rules                 |
| `npm test`          | Unit tests (Vitest)                                        |
| `npm run test:e2e`  | End-to-end tests (Playwright)                              |
| `npm run test:rls`  | Row-level-security isolation test against a local Postgres |
| `npm run verify`    | Typecheck, lint, unit tests and build                      |

---

## Documentation

| Document                                              | Contents                                               |
| ----------------------------------------------------- | ------------------------------------------------------ |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)               | How the pieces fit together, and why                   |
| [FEATURES.md](docs/FEATURES.md)                       | What is implemented, partial, and deferred             |
| [DESIGN.md](docs/DESIGN.md)                           | Visual language and design tokens                      |
| [UX.md](docs/UX.md)                                   | Interaction decisions and their reasoning              |
| [DATABASE.md](docs/DATABASE.md)                       | Schema, indexes and row-level security                 |
| [PRESENTATION_ENGINE.md](docs/PRESENTATION_ENGINE.md) | The stage, layouts, motion and auto-fit                |
| [AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md)         | Structured output, validation and fallbacks            |
| [RECORDING.md](docs/RECORDING.md)                     | What the browser can and cannot do, honestly           |
| [SECURITY.md](docs/SECURITY.md)                       | Threat model, controls and accepted risks              |
| [TESTING.md](docs/TESTING.md)                         | What is tested and how to run it                       |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md)                   | Environment, migrations and hosting                    |
| [FILE_STRUCTURE.md](docs/FILE_STRUCTURE.md)           | Where things live                                      |
| [CONNECTIONS.md](docs/CONNECTIONS.md)                 | External services and how they are wired               |
| [MVP_STATUS.md](docs/MVP_STATUS.md)                   | Honest status of every MVP requirement                 |
| [AGENTS.md](AGENTS.md)                                | Conventions for anyone (or anything) editing this repo |

---

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Zod ·
Zustand · Motion · dnd-kit · Supabase (Postgres, Auth, Storage) ·
Anthropic SDK · Vitest · Playwright

Chosen for boring reasons: all actively maintained, all with real ecosystems,
and none duplicating something the browser already does well.
