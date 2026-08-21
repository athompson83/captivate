# MVP status

**Verdict: functionally complete and verified locally against the live database.
Not yet deployed to a hosted URL.**

Everything below was checked by running it, not by reading the code.

---

## The MVP definition, point by point

> A real user can create an account, create or generate a presentation, organise
> content, edit a presentation visually, store source and lecture notes, add
> mixed media, present it full-screen without editor clutter, use presenter
> tools, display private notes and timing, record with microphone and camera,
> save the project, reopen it later, and obtain a usable recording or export.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Create an account | Works | Signup, trigger-created profile, and sign-in verified against the live project |
| Create a presentation | Works | Template and blank paths, end-to-end test |
| Generate a presentation | Works | Outline → deck. With a model key it is model-written; without one it is a labelled structural draft |
| Organise content | Works | Folders, tags, favourites, search, sort, soft delete and restore |
| Edit visually | Works | Drag, resize, snap, align, multi-select, inline text, undo/redo |
| Lecture notes | Works | Separate table and full-page workspace, persistence verified after reload |
| Speaker notes | Works | Per scene, private, verified absent from the audience surface by test |
| Mixed media | Works | Image, video, audio, embed; upload, library reuse, alt text |
| Present full-screen | Works | Separate route, no editor chrome, asserted by test |
| Presenter tools | Works | Laser, highlight, ink, eraser, clear — all verified in a browser |
| Private notes and timing | Works | Console with notes, filmstrip, total and per-scene timers |
| Record with mic and camera | Works | Screen + mic + composited camera; verified by hand, dialog verified by test |
| Save and reopen | Works | Reload persistence test; survives sign-out and sign-in |
| Obtain a recording | Works | Immediate local download, plus library playback from a signed URL |

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

**Hosted deployment.** The Vercel connection available to this workspace returns
`403 forbidden` on project creation, so the repository must be imported once by
hand. Everything after that is automatic. Steps in
[DEPLOYMENT.md](DEPLOYMENT.md).

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
- **Flow analysis and transition suggestions** have schemas and prompts but no
  UI surface yet.
- **Per-scene theme override** is stored but not exposed.

---

## What would come next

1. Import the Vercel project and deploy; re-run the smoke suite against it.
2. Configure SMTP so signup works for real users.
3. Add the AI key and validate generation quality against real prompts.
4. Sharing — a read-only link is the most-requested thing this does not do.
5. Speaker view on a phone, using the same BroadcastChannel protocol over a
   relay.
