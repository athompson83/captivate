# MVP status

**Verdict: functionally complete, verified against the live database, and
building a hosted preview on every push — one that currently requires a Vercel
login to open.**

Everything below was checked by running it, not by reading the code.

---

## The world canvas

The presentation model changed after the first review: the screenshots looked
like PowerPoint in a browser, which is the one thing the product is not supposed
to be. A presentation is now a single unbounded canvas with every scene placed
on it, and presenting moves a camera between those placements.

| Piece                            | State                                                    |
| -------------------------------- | -------------------------------------------------------- |
| World renderer and camera        | Implemented, verified in a browser                       |
| Optimal zoom-and-pan flight path | Implemented, 43 unit tests                               |
| Six spatial arrangements         | Implemented, invariant-tested                            |
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

| Requirement                | Status | Evidence                                                                                            |
| -------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| Create an account          | Works  | Signup, trigger-created profile, and sign-in verified against the live project                      |
| Create a presentation      | Works  | Template and blank paths, end-to-end test                                                           |
| Generate a presentation    | Works  | Outline → deck. With a model key it is model-written; without one it is a labelled structural draft |
| Organise content           | Works  | Folders, tags, favourites, search, sort, soft delete and restore                                    |
| Edit visually              | Works  | Drag, resize, snap, align, multi-select, inline text, undo/redo                                     |
| Lecture notes              | Works  | Separate table and full-page workspace, persistence verified after reload                           |
| Speaker notes              | Works  | Per scene, private, verified absent from the audience surface by test                               |
| Mixed media                | Works  | Image, video, audio, embed; upload, library reuse, alt text                                         |
| Present full-screen        | Works  | Separate route, no editor chrome, asserted by test                                                  |
| Presenter tools            | Works  | Laser, highlight, ink, eraser, clear — all verified in a browser                                    |
| Private notes and timing   | Works  | Console with notes, filmstrip, total and per-scene timers                                           |
| Record with mic and camera | Works  | Screen + mic + composited camera; verified by hand, dialog verified by test                         |
| Save and reopen            | Works  | Reload persistence test; survives sign-out and sign-in                                              |
| Obtain a recording         | Works  | Immediate local download, plus library playback from a signed URL                                   |

---

## Verification actually performed

**Static.** TypeScript strict: clean. ESLint including the React Compiler rules:
clean, no suppressions beyond two documented `next/image` exemptions. Production
build: succeeds.

**Unit.** 238 tests across 12 files. All pass.

**End-to-end.** 26 Playwright tests in a real Chromium. All pass against the
live Supabase project. Includes zero-console-errors, security headers, keyboard
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
exercised against a live model in this environment.

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
2. Configure SMTP so signup works for real users.
3. Add the AI key and validate generation quality against real prompts.
4. Sharing — a read-only link is the most-requested thing this does not do.
5. Speaker view on a phone, using the same BroadcastChannel protocol over a
   relay.
