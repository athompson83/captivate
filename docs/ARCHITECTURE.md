# Architecture

## The one idea

Captivate has a single organising principle: **the audience surface and the
presenter surface are different routes.**

`/present/[id]` renders the stage. `/present/[id]/console` renders the presenter
console. The stage route does not import speaker notes, lecture notes, timers or
the scene navigator — not "hides them", _does not load them_. Private material
therefore cannot reach a projector through a state bug, a race, or a malformed
message, because there is no code path that would render it there.

Everything else follows from wanting that to be true while still feeling like
one application.

---

## The world, not a reel

The single most consequential decision in this codebase: a presentation is not
an ordered list of slides that get swapped in and out. It is one unbounded
canvas with every scene placed on it, and presenting is a camera moving between
those placements.

That is one model, not two. A conventional left-to-right deck is the `reel`
arrangement — scenes in a row at one zoom — running through exactly the same
renderer and the same camera. There is no "deck mode" and no second code path
to keep in step, and a slideshow is a special case of a journey rather than a
different kind of thing.

Three consequences worth knowing before changing anything here:

- **Nesting is free.** A scene placed at 2% scale inside another scene's bounds
  _is_ a detail of it, and the camera dives in. No portal concept, no sub-slide
  type — just free placement plus a camera.
- **Scene transitions are gone.** Travel (`fly`, `dissolve`, `cut`) is a
  property of the presentation, not of each scene. The camera move is the
  transition.
- **A scene has no edge.** On the canvas a scene renders bare — no background,
  no border, no box. A colour it sets becomes atmosphere in the air around it;
  only an image is still drawn, feathered. This is the decision that separates
  "a new medium" from "slides on a wall", and it is worth defending: every
  rectangle that crept back onto the page — a scene background, an empty image
  placeholder, a scrim over no photograph — made it read as a deck again.
- **Placement is nullable.** A scene with no placement is positioned by the
  presentation's arrangement at read time, so nothing had to be migrated and a
  deck nobody has touched spatially still presents.

See [PRESENTATION_ENGINE.md](PRESENTATION_ENGINE.md) for the camera path and the
arrangements.

## Layers

```
┌─ app/ ───────────────────────────────────────────────────────────────┐
│  (auth)     sign-in, sign-up, recovery                               │
│  (app)      dashboard shell: home, presentations, notes, assets,     │
│             templates, recordings, settings                          │
│  edit/[id]  the editor — its own chrome, outside the shell           │
│  present/   the stage, and the console beneath it                    │
│  api/       AI routes, asset resolution, search                      │
└──────────────────────────────────────────────────────────────────────┘
           │
┌─ lib/ ───────────────────────────────────────────────────────────────┐
│  schema/    the typed content model — the contract everything shares │
│  editor/    document store, autosave, geometry, layouts              │
│  present/   session store, cross-window protocol, motion, auto-fit   │
│  record/    MediaRecorder state machine and compositing              │
│  ai/        schemas, provider boundary, service, fallback            │
│  data/      server actions and read-side queries                     │
│  supabase/  browser, server and admin clients                        │
└──────────────────────────────────────────────────────────────────────┘
           │
┌─ Supabase ───────────────────────────────────────────────────────────┐
│  Postgres with RLS on every table · Auth · private Storage buckets   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## The content model

`src/lib/schema/presentation.ts` defines the whole thing, in Zod. Three
decisions matter:

**Geometry is normalised.** Every frame is `0..100` on both axes, independent of
pixels and aspect ratio. A scene therefore renders identically on a 13" laptop
and a 4K projector, and a pointer position broadcast from the console lands in
the right place on the audience display.

**Elements are a discriminated union.** Fourteen types today. Adding one is
purely additive; an unknown type is _rejected_ at the boundary rather than
silently rendered as something else.

**Text is typed runs, never HTML.** `RichText` is an array of `{ text, bold?,
href?, … }`. There is no `dangerouslySetInnerHTML` anywhere on the stage, so
there is no sanitisation surface to get wrong. Stored content containing
`<script>` renders as the literal characters, which a test asserts.

### Why scenes are JSONB

`scenes.content` is a JSONB column, not a `scene_elements` table.

An editor autosaves whole scenes atomically. Dragging one element across a scene
with twelve elements is one row update, not twelve. Reading a deck is one query
per table, not a join that fans out to hundreds of rows. And the schema is still
enforced — by Zod, at every write boundary, with a `version` field on the payload
for forward migration.

The trade-off is that the database cannot query _inside_ a scene. Nothing in the
product needs to, and search covers titles, descriptions and notes, which are
columns.

---

## State

Three stores, each with a different job.

**Editor document** (`lib/editor/store.ts`, Zustand). Holds the presentation,
sections and scenes. Every mutation goes through `mutate`, which produces the
next document, records history, and marks exactly which scenes became dirty.
Nothing edits a scene in place.

**Presentation session** (`lib/present/session.ts`, a Zustand store created
outside React). The BroadcastChannel and the running clock are long-lived side
effects that must not be rebuilt on re-render — losing a message mid-presentation
is not an acceptable failure mode. React subscribes; it never owns this state.

**Recorder** (`lib/record/recorder.ts`, a plain class). Media streams and a
`MediaRecorder` are not React state, and pretending otherwise produces bugs.

---

## Saving

Autosave is per scene and revision-guarded.

Each scene carries a local revision counter, incremented on every edit. A save
captures the revision it is persisting. When the response lands, the store
clears the dirty flag **only if** the revision still matches. A slow response can
therefore never mark a scene clean that the user has since changed again, and
never stamps a stale `updatedAt`.

Around that:

- typing coalesces into one history entry per burst, so undo maps to what a
  person thinks of as "a change";
- flushes are debounced at 900ms with a 5s ceiling, and forced on tab hide,
  page unload and explicit save;
- consecutive failures back off exponentially, so one broken request does not
  become a sustained request loop;
- `beforeunload` warns while anything is genuinely unsaved.

The notes surfaces use the same guarantees through `useDebouncedSave`, which
merges pending writes per record — an earlier single-slot version dropped a
title edit when a body edit followed within the same window.

---

## Cross-window presenting

`BroadcastChannel`, scoped to `captivate-present-<id>`. Same-origin only: no
server, no network, and no way for another site to join.

Messages are validated with Zod **on receipt**, not just on send. A stale tab
running an older build must not be able to drive a live presentation with a
half-understood message.

The stage is authoritative for position and broadcasts it. The console sends
commands. With no stage connected the console drives itself, so a presenter can
rehearse from the console alone; it yields the moment a stage announces itself,
so the two can never drift.

---

## Rendering

One `Stage` component serves every context: the editor canvas, present mode, the
navigator thumbnails, the console's control pad, and dashboard card previews.
There is no second renderer to keep in step.

It draws at a fixed internal size (1600px wide) and scales with a CSS transform
written straight to a custom property by a `ResizeObserver`. Fit-to-container
therefore costs one style write, not a re-render of every element on the stage.

Text auto-fit is _estimated, not measured_ — a pure function of content and box.
That is what makes a 96px thumbnail, the editor canvas and a projector agree
exactly, with no measure-then-reflow cycle mid-drag.

---

## AI

The model never returns presentation state. It returns _content_, in a Zod
schema with tight limits, which is then poured into the layout engine.

That places composition quality under the application's control rather than the
model's, and the schema limits (120-character headings, at most six bullets)
structurally prevent the dense scenes generated decks are notorious for — the
model cannot produce a wall of text because the schema will not hold one.

`generateStructured` is the only door to a model. It forces a tool call,
validates, retries once with the validation error, and reports usage. Swapping
providers means reimplementing one function.

---

## Security

Row-level security is the authorisation boundary, not application code. Every
table is owner-scoped; child rows delegate to one `SECURITY DEFINER` helper so
the ownership rule is written down exactly once. Ownership is never accepted
from a client.

Storage buckets are private. Scene content stores a permanent
`/api/assets/:id/content` reference that resolves to a fresh signed URL per
request, after RLS has confirmed the asset belongs to the caller.

See [SECURITY.md](SECURITY.md) for the full picture, including accepted risks.
