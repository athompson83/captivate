# MVP status

**Verdict: functionally complete, verified against the live database, and
building a hosted preview on every push — one that currently requires a Vercel
login to open.**

Everything below was checked by running it, not by reading the code.

---

## The narrative map

The second change after review: even on a spatial canvas, the AI path still
planned a _deck_. It proposed a list of scene titles with a layout each, and
threw that list away the moment scenes existed — so the argument was never a
thing the author could revise, only the slides were.

A presentation now has a **narrative map**: ordered movements, each holding
ordered moments that state what they are for and what the audience leaves with,
decided before anything is rendered. Scenes are generated from it and carry the
id of the moment that produced them. It is stored, it is a first-class editor
view, and regeneration reads it rather than the original prompt.

| Piece                                             | State                                              |
| ------------------------------------------------- | -------------------------------------------------- |
| Movement and moment model, 16 narrative roles     | Implemented, unit-tested                           |
| Editable map as an editor view                    | Implemented, verified in a browser                 |
| Map-first creation (`/new?mode=ai`)               | Implemented, verified in a browser                 |
| Generate scenes from an accepted map              | Implemented                                        |
| Rewrite one moment, leaving the rest alone        | Implemented                                        |
| Lock a moment against regeneration                | Implemented, unit-tested                           |
| Evidence by reference to assets and lecture notes | Implemented — invented ids are dropped and counted |
| Duration planning that warns, never blocks        | Implemented, e2e-tested                            |
| Template narrative shapes                         | Implemented for lecture, pitch and report          |
| Backward derivation for presentations with no map | Implemented, deterministic, e2e-tested             |
| Drag, keyboard reorder, move between movements    | Implemented                                        |
| Branching playback and a node-and-edge editor     | **Not built** — sequenced next, see below          |
| Lecture-note anchoring to a moment                | **Not built** — the ids it needs are stable now    |
| Per-moment delivery analytics                     | **Not built**                                      |

---

## The world canvas

The presentation model changed after the first review: the screenshots looked
like PowerPoint in a browser, which is the one thing the product is not supposed
to be. A presentation is now a single unbounded canvas with every scene placed
on it, and presenting moves a camera between those placements.

| Piece                            | State                                                    |
| -------------------------------- | -------------------------------------------------------- |
| World renderer and camera        | Implemented, verified in a browser                       |
| Optimal zoom-and-pan flight path | Implemented, 46 unit tests                               |
| Seven spatial arrangements       | Implemented, invariant-tested                            |
| Journey map (drag, resize, nest) | Implemented, verified in a browser                       |
| Overview (`O`), route drawing    | Implemented, e2e-tested                                  |
| Section establish beat           | Implemented                                              |
| Travel: fly / dissolve / cut     | Implemented                                              |
| Nesting a scene inside another   | Implemented — free placement, no separate concept        |
| Per-scene transitions            | **Removed.** Travel is a presentation-level property now |

Five defects were found by running the app rather than by reading it, and all
five are fixed with a regression test that was checked to fail without the fix:

1. **Every camera flight froze halfway.** The flight effect re-runs on each
   render; its cleanup cancelled the animation frame and the early-return path
   never restarted it. The session clock ticks once a second, so in practice no
   flight ever completed.
2. **The presenter console could not see the stage.** `close()` nulled the
   BroadcastChannel permanently, so React's mount/unmount/mount left the stage
   broadcasting into a dead pipe.
3. **The empty dashboard crashed** — a server component passed a lucide icon
   _function_ to a client component. It only appeared for accounts with no
   presentations, which is every new account.
4. **Recording state mismatched on hydration**, because support was detected
   during render and differs between server and browser.
5. **The spiral arrangement overlapped its own inner turns**, because the
   spacing was estimated from an arc-length inversion rather than solved.

Two of those (3 and 4) predate the canvas work and would have shipped.

### Then it needed to tell the author the truth

Presentation health and a pacing strip, both computed from the document already
in the store — no request, no waiting, updating as the deck does.

The rule the health score follows is that it is only ever the weighted mean of
its checks, each of which states what it found and what to do. That constraint
is what keeps it useful: "2 of 2 images have no alt text" is a fix, and an
"engagement score of 71" is not, so nothing here reports anything of the kind.

Pacing needed a duration for every scene, and almost nobody sets a rehearsal
target, so time is estimated from content — words spoken aloud, a beat per
bullet, a pause on each image and build — with an authored target overriding it.
Wherever an estimate is shown it says "estimated".

Also: a heading can now carry its emphasis. "State the single most important
idea / **in one sentence**" — the clause the claim turns on takes the theme's
accent, as a token so re-theming moves it, and as one run so wrapping and
auto-fit still see a single block of type.

### Then the argument needed a shape

Sections became **movements**: named stretches of the argument, shown to the
audience on a rail down the edge of the stage, with the current one lit and a
signpost naming the next as one ends. Templates now carry their shape as well as
their scenes, so a new presentation arrives with movements already in place.

Building it surfaced a defect that had nothing to do with the feature: **section
renames were never saved.** `renameSectionLocal` updated the store and marked
nothing dirty, so autosave never looked at sections and the server action that
writes them had never been called by anything. The input looked like it worked
and the new name was gone on reload. Sections now have their own dirty set and
their own flush.

A second, smaller one: the movement rail is drawn over the world, and the stage
theme tokens were defined only _inside_ it — so every colour in the rail
resolved to nothing and inherited whatever the page was using.

### Then the cards had to go

The first canvas version still drew each scene as a bounded rectangle with its
own background — Prezi's mistake, which is slides on a wall rather than a page.
A second pass made every scene a region of one continuous surface:

- scenes render with no background, no border and no clipping;
- a scene's own solid or gradient background became **atmosphere** — its palette
  is blended into the air around the region instead of painted as a panel;
- three more rectangles were tracked down and removed: an empty image
  placeholder's filled surface, a caption scrim drawn over a photograph that was
  not there, and the numbered marker used for distant scenes, now a named
  landmark with no box;
- the default arrangement became `flow`, a serpentine that fills a page, because
  a straight line at one zoom is a slide strip;
- gutters were retuned from 0.3 to 0.08 of a scene width, since the wide gutter
  existed to stop two bordered boxes looking crowded and there are no boxes.

Colour blending is in OKLab, because mixing a deep blue with an amber in sRGB
passes through grey, and that grey is precisely the transition the camera would
show while travelling between two regions.

---

## The MVP definition, point by point

> A real user can create an account, create or generate a presentation, organise
> content, edit a presentation visually, store source and lecture notes, add
> mixed media, present it full-screen without editor clutter, use presenter
> tools, display private notes and timing, record with microphone and camera,
> save the project, reopen it later, and obtain a usable recording or export.

| Requirement                | Status | Evidence                                                                                                    |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| Create an account          | Works  | Signup, trigger-created profile, and sign-in verified against the live project                              |
| Create a presentation      | Works  | Template and blank paths, end-to-end test                                                                   |
| Generate a presentation    | Works  | Narrative map → scenes. With a model key it is model-written; without one it is a labelled structural draft |
| Organise content           | Works  | Folders, tags, favourites, search, sort, soft delete and restore                                            |
| Edit visually              | Works  | Drag, resize, snap, align, multi-select, inline text, undo/redo                                             |
| Lecture notes              | Works  | Separate table and full-page workspace, persistence verified after reload                                   |
| Speaker notes              | Works  | Per scene, private, verified absent from the audience surface by test                                       |
| Mixed media                | Works  | Image, video, audio, embed; upload, library reuse, alt text                                                 |
| Present full-screen        | Works  | Separate route, no editor chrome, asserted by test                                                          |
| Presenter tools            | Works  | Laser, highlight, ink, eraser, clear — all verified in a browser                                            |
| Private notes and timing   | Works  | Console with notes, filmstrip, total and per-scene timers                                                   |
| Record with mic and camera | Works  | Screen + mic + composited camera; verified by hand, dialog verified by test                                 |
| Save and reopen            | Works  | Reload persistence test; survives sign-out and sign-in                                                      |
| Obtain a recording         | Works  | Immediate local download, plus library playback from a signed URL                                           |

---

## Verification actually performed

**Static.** TypeScript strict: clean. ESLint including the React Compiler rules:
clean, no suppressions beyond five documented `next/image` exemptions and one
documented `exhaustive-deps` exemption. Production
build: succeeds.

**Unit.** 502 tests across 23 files. All pass.

**End-to-end.** 50 Playwright tests in a real Chromium, across four projects —
37 against a running application (`smoke` and `authenticated`), and 13 more
(`shader` and `lifecycle`) that need no server and no account. The 37 were run
against the live Supabase project during the original verification round; the 13
are re-run on every change here, most recently green, because they need nothing
but a browser. Coverage includes zero-console-errors, security headers, keyboard
focus visibility, narrow-viewport overflow, both colour schemes and reduced
motion.

**Database.** RLS isolation verified twice: locally with a Postgres stub, and
against the live project through PostgREST with two real JWTs. A second user
sees zero rows, cannot read speaker notes by id, cannot insert into another
user's deck (42501), cannot update or delete one, and cannot forge `owner_id`
(42501).

**Advisors.** Supabase's security linter reports one remaining warning, which is
required and documented in [SECURITY.md](SECURITY.md#accepted-risks).

**By hand.** Sign-in, template creation, AI creation, editing, presenting,
annotating, the console, and the recording dialog were all exercised in a
browser and reviewed as screenshots.

---

## Bugs found and fixed during verification

Recorded because "it builds" is not the same as "it works":

1. Every server action returned 500 — a `"use server"` module also exported two
   constants, which Next rejects wholesale.
2. The editor crashed with "Maximum update depth exceeded" the instant anything
   was selected — a selector returning a fresh array each read.
3. The stage rendered nothing in the editor canvas — an inline `position` broke
   the caller's `absolute inset-0`, collapsing the container to zero height.
4. Long headings overflowed their box and collided with the element below.
5. `z.url()` accepted `javascript:` URLs, which were rendered into an anchor.
6. Switching to the quote layout silently discarded the heading.
7. A failing autosave retried every debounce tick indefinitely.
8. Editing a note's title then its body sent only the body.
9. Notes had no flush-on-unload guard.
10. `listNotes` compared a uuid column to an empty string for standalone notes.

---

## Remaining work

**Hosted deployment.** Mostly resolved. The repository is connected to a Vercel
project and every push builds a preview. The `403 forbidden` recorded here
earlier was on _creating_ the project through the API; the project exists and
deploys.

One caveat, stated plainly: the preview has Vercel's deployment protection
enabled, so opening it requires a Vercel session on the owning account. It is
not a link that can be handed to someone else. Turning that off — or adding a
bypass token — is a project setting in the Vercel dashboard, not a code change.
Steps and environment variables are in [DEPLOYMENT.md](DEPLOYMENT.md).

**Email configuration.** Supabase's built-in SMTP is rate limited to roughly
three messages an hour, which is unusable for real onboarding. Either configure
custom SMTP or turn off email confirmation — a dashboard setting, no code
change. The app handles both correctly already.

**AI key.** Without `ANTHROPIC_API_KEY`, AI generation falls back to the
deterministic draft. The full path is implemented and validated; it has not been
exercised against a live model in this environment. Everything recorded about
the map in this document was therefore verified against the fallback proposer,
which produces a real, schema-valid argument — the shape is exercised, the
model's judgement is not.

**Sequenced next, on top of the map.** These were deliberately left out of this
change rather than half-built, and each is now cheap because the model underneath
them exists:

1. **Branching playback** — a moment with more than one successor, chosen live.
   The map already orders moments explicitly rather than by array position, so
   this is an edge table and a playback rule, not a remodelling.
2. **A node-and-edge map editor**, once branching means the argument is no longer
   a list. Building it before there is anything to branch would be a graph editor
   for a straight line.
3. **Lecture-note anchoring.** Notes anchor to a moment rather than to a scene,
   so a note survives regeneration. Moment ids are stable across edit, reorder
   and regeneration precisely so this can be built without a migration.
4. **Live metric widgets** on the map — how long each movement actually ran, from
   recordings.
5. **The full two-tone editorial composition system.**

---

## Honest limitations

- **Recording capture was verified by hand, not by an automated test.**
  `getDisplayMedia` requires a real picker interaction that Playwright cannot
  drive.
- **Multi-display is two windows, not the Window Management API.** That API is
  not available in enough browsers to depend on. The user drags the stage window
  to the projector — one instruction, no experimental dependency.
- **WebM on Chromium.** There is no server-side transcoding to MP4. Converting
  the downloaded file is the practical path, and the UI says so.
- **Image cropping is fit and focal point**, not a free crop.
- **No load testing at 200 scenes.** The architecture is designed for it; it has
  not been measured there.
- **The atmosphere has been seen only under software rendering.** SwiftShader is
  a real WebGL implementation, so it can catch a reflected axis or a destroyed
  context — and it did, twice. It is not a driver, so it says nothing about a
  blocklist, a mobile `mediump` precision, Safari's separate WebGL stack, or
  what twelve frames a second costs an integrated GPU. The manual acceptance
  matrix that closes this gap is in
  [TESTING.md](TESTING.md#what-only-a-real-gpu-can-answer), and none of it has
  been run.
- **Flow analysis** has schemas and prompts but no UI surface yet. The
  transition-suggestion part of it no longer applies: per-scene transitions do
  not exist.
- **The AI does not place scenes in the world.** It generates content and the
  arrangement is applied mechanically; nothing chooses a spatial shape to match
  the argument. That is the most obvious next thing for the model to do.
- **Per-scene theme override** is stored but not exposed.

---

## What would come next

1. Re-run the smoke suite against the hosted preview rather than localhost.
2. Work the physical-GPU acceptance matrix in
   [TESTING.md](TESTING.md#what-only-a-real-gpu-can-answer). It needs hardware,
   not code, and it is the only outstanding question about the atmosphere.
3. Configure SMTP so signup works for real users.
4. Add the AI key and validate map quality against real prompts — the one part
   of the narrative map that a deterministic fallback cannot stand in for.
5. Branching playback, then the node-and-edge editor it makes necessary.
6. Lecture-note anchoring to moments.
7. Sharing — a read-only link is the most-requested thing this does not do.
8. Speaker view on a phone, using the same BroadcastChannel protocol over a
   relay.
