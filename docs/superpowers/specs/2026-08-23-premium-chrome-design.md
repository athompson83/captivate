# Premium chrome & journey polish — design

Workstream 1 of 4 agreed with the user (the others — clickable/expandable scene
elements, AI visual captivation, and phone remote control — are separate specs).

## Problem

The user asked to "make the UI feel more premium" and "make the presentation
experience even more captivating... check out Prezi.com and make sure we have
something even better."

A hands-on audit (running the app against the live `Captivate` Supabase
project, walking through sign-up → dashboard → templates → editor
(narrative/scene/journey views) → present mode → console) found that **the
stage is already excellent and already beats Prezi on the specific thing
Prezi is known for**: the camera (`src/lib/present/camera.ts`) implements the
Van Wijk & Nuij optimal zoom-and-pan path, which already pulls back, travels,
and pushes in on any long jump — the "zoom out of current, zoom into next"
behavior the user asked for is not a gap, it is the existing `fly` travel
mode. The pulled-back overview (`O` key) already renders a glowing dotted
route over a procedurally-generated amber atmosphere, which reads as more
considered than Prezi's flat path line.

The actual gap is that **the chrome around the stage undersells it**. The
dashboard, templates gallery, and editor shell are flat, thin-bordered,
default-SaaS-white, while the stage they lead into is dark, editorial
(Fraunces serif), and warm-gold accented. That mismatch — not the stage
itself — is what reads as "not premium."

## Goals

- Bring dashboard / templates / library / settings / recordings chrome up to
  the level of craft already present on the stage, using the _existing_
  design language (`docs/DESIGN.md`) rather than inventing a new one.
- Fix two concrete, evidence-based defects between the documented design
  intent and the shipped code (below).
- Add small, additive polish to journey/present-mode moments that are already
  strong, without touching the camera math, culling, or LOD logic in
  `world.tsx` / `camera.ts` — those are correct and out of scope.

## Non-goals

- No new visual language (colors, type, motion tokens stay as documented).
- No changes to clickable/expandable elements, AI generation, or remote
  control — separate specs.
- No changes to the flight/camera algorithm itself, arrangement presets, or
  culling/LOD. The engine is sound; this workstream is chrome and finish.

## Findings

1. **Light theme isn't actually warm.** `docs/DESIGN.md`: "Light mode is warm
   paper rather than clinical white." Actual token
   (`src/app/globals.css:37`): `--surface-base: oklch(0.985 0.003 90)` —
   chroma 0.003 is imperceptible; it renders as plain white (confirmed via
   screenshot of the live dashboard). `--surface-sunken` (L38, chroma 0.005)
   and `--surface-raised`/`--surface-overlay` (pure white, chroma 0) have the
   same problem.
2. **Theme resolves to OS preference on first visit, not dark.**
   `docs/DESIGN.md` frames the product as "dark by default... it sits next to
   a dark projection." `src/components/ui/theme-provider.tsx`'s
   `readPreference()` returns `"system"` both when the user has never
   expressed a preference _and_ when they've explicitly chosen "System" in
   Settings (`settings-panel.tsx` has a working Light/Dark/System toggle via
   `useTheme`/`setPref`) — both cases then defer to
   `matchMedia("(prefers-color-scheme: dark)")`. The user confirmed the fix:
   first-run (nothing in `localStorage`) should resolve dark unconditionally;
   an explicit "System" choice should keep following the OS. This means
   distinguishing "never set" from "explicitly set to system" — currently
   collapsed into one value.
3. **Correction from an implementation-planning pass**: reading
   `presentation-card.tsx` and `template-gallery.tsx` directly (rather than
   only the dashboard screenshots from the original audit) shows both
   already implement hover/elevation choreography
   (`hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]`, a considered
   `transition-[border-color,box-shadow,transform] duration-[var(--duration-base)]`)
   — the original finding that cards have "no hover/elevation choreography"
   overstated the gap. The real, verified gap: neither transition respects
   `prefers-reduced-motion` (`ReducedMotionProvider`,
   `src/components/ui/reduced-motion.tsx`, only reaches `motion/react`
   library animations — plain Tailwind `transition-*` hover effects like
   these are outside its coverage), which is exactly what acceptance
   criterion 3 above requires. The template thumbnails (dark, Fraunces-set,
   color-graded) are already excellent and the footer typography already has
   a considered hierarchy (semibold title, muted description, accent CTA
   with an icon) — treat "make cards feel premium" as largely already done,
   and scope this workstream's card-level work to the reduced-motion gap
   plus a genuine visual-review pass (not an assumed rebuild).
4. **Journey/present-mode has room for small additive polish**: the
   "establish a section" beat (pull back, hold ~1s, dive —
   `docs/UX.md` "Moving through a presentation") and the pulled-back overview
   are both good and are the right places to add a bit more visual weight
   (e.g. path/glow depth, section-frame emphasis) rather than inventing new
   mechanics.

## Design

### A. Light theme: real warmth

Raise chroma on the light-mode surface tokens (`globals.css` lines ~36-40)
enough to read as warm paper against a white reference, while keeping
`oklch` lightness values and the perceptual-evenness property intact. Verify
against real content (dashboard, editor chrome, dialogs) rather than the
token in isolation — OKLCH chroma that looks warm in a swatch can look muddy
under text. `--accent` and text tokens are unaffected; this is a surface-only
change. Dark theme tokens are untouched.

### B. Theme default policy: dark first

Change `theme-provider.tsx` (and the matching inline bootstrap script in
`src/app/layout.tsx:62`, which must stay in sync since it sets `data-theme`
before hydration to avoid a flash) so that:

- No stored preference → resolves dark, regardless of OS `prefers-color-scheme`.
- Stored preference `"light"` or `"dark"` → behaves as today (explicit wins).
- Stored preference `"system"` (i.e. the user opened Settings and explicitly
  picked "System") → continues to follow OS `prefers-color-scheme`, as today.

This requires `readPreference()`'s return type/contract to distinguish
"absent" from "system" — today both collapse to the string `"system"`. The
implementation plan should pick a concrete representation (e.g. `null`/absent
vs. the literal `"system"`) and update both the provider and the inline
bootstrap script identically, since a mismatch between them reintroduces the
hydration flash the current script exists to prevent.

### C. Dashboard / library / settings / recordings chrome

Apply the stage's level of craft to the app shell, within the existing
design system (`docs/DESIGN.md`'s tokens — no new colors, no new fonts):

- **Cards** (`presentation-card.tsx`, `template-gallery.tsx`,
  `recordings-library.tsx`, `asset-library.tsx`): `presentation-card.tsx` and
  `template-gallery.tsx` already have deliberate hover/elevation transitions
  (see finding 3's correction) — make them `prefers-reduced-motion`-aware
  (Tailwind's `motion-reduce:` variant, or an equivalent guard) rather than
  adding new choreography. Audit `recordings-library.tsx` and
  `asset-library.tsx` against the same bar those two files already meet and
  bring them up to it if they fall short — verify before assuming a gap.
- **Empty states** — `docs/UX.md` already mandates these do work ("three
  concrete next steps"); check each against that bar and tighten any that
  default to a generic icon + text (the audit saw `presentations-library.tsx`
  empty state, which already does most of this — verify the others match).
- **Iconography** — confirm consistent sizing/weight across the sidebar,
  cards, and top bars; `docs/DESIGN.md` sets a 28px minimum for interactive
  controls — audit for violations.
- Explicitly do **not** add gradients, extra shadows-on-shadows, or a second
  accent color — `docs/DESIGN.md`'s "What was deliberately avoided" section
  still applies to this pass.

### D. Templates gallery

`template-gallery.tsx` is already in good shape (finding 3's correction) —
this section is now the reduced-motion fix from C applied here first, since
it's the most-seen "premium or not" surface for a new user, plus a genuine
visual-review pass rather than an assumed typography rebuild: check the
rendered page for anything that still looks off once reduced-motion is
handled, fix only what's actually found.

### E. Journey / present-mode additive polish

Two small, additive changes — no camera/culling/LOD changes:

- **Establish-section beat**: add a touch more visual weight to the
  hold-frame (e.g. the section's movement label gets brief emphasis) so the
  "one beat where showing the shape of the thing is worth more than showing
  its content" (`docs/UX.md`) reads even more deliberately as a beat, not a
  pause.
- **Overview path**: minor depth/legibility pass on the dotted route and
  scene glow rendered in the pulled-back view (already implemented in
  `world.tsx`/`ambient.ts`/`atmosphere.tsx`) — confirm it holds up with more
  scenes/sections than the 7-scene lecture template used in the audit, and
  tune if it degrades (e.g. path/glow overlap at higher scene density).

## Acceptance criteria

"Beats Prezi" and "feels premium" are the motivation, not something a test
can check. This section replaces those subjective claims with what
implementation actually has to satisfy, split by kind — deterministic items
are pass/fail and belong in automated tests; subjective items are a manual
visual-review checklist a human confirms once the deterministic items are
green. Don't conflate the two: a subjective checkpoint failing is a design
judgment call, a deterministic one failing is a bug.

### Deterministic (must pass, automatable)

1. **First-visit dark, no flash.** A session with nothing in `localStorage`
   renders `data-theme="dark"` on the very first paint — not dark-after-a-
   flash-of-light, and not dependent on OS `prefers-color-scheme`. Verify by
   asserting the inline bootstrap script's output (`layout.tsx:62`) and the
   hydrated `theme-provider.tsx` state agree with no intermediate paint, per
   the existing pattern that script exists to prevent (see Risks, below).
   Explicit `"light"`/`"dark"` preference and explicit `"system"` preference
   (i.e. the user opened Settings and chose it, per finding 2) behave exactly
   as today — this criterion is only about the no-preference case.
2. **Contrast holds across every light-mode surface the chroma change
   touches**, not just the dashboard background it was checked against
   during design. WCAG relative-luminance contrast (per AGENTS.md's own
   analysis rule: "contrast uses WCAG relative luminance, not OKLab
   lightness") of body text against `--surface-base`/`--surface-sunken`/
   `--surface-raised`/`--surface-overlay`, and of every existing text-token
   pairing already defined in `globals.css`, must meet the ratio the app
   already targets elsewhere (check `docs/DESIGN.md`/existing tests for the
   current bar rather than inventing a new one) — both before and after the
   chroma increase in item A. A warmer paper that muddies text contrast is a
   regression, not polish.
3. **`prefers-reduced-motion` covers every new transition.** The card
   hover/elevation choreography (C, D) and the establish-section/overview
   polish (E) are all motion — `docs/UX.md` already states the rule
   (`prefers-reduced-motion` turns every flight into a cut); this workstream
   must extend that same coverage to its own new transitions, not just leave
   the existing camera-flight behavior untouched. A reduced-motion session
   sees the end state of every new hover/emphasis effect immediately, no
   animated path.
4. **No regression to camera math, culling/LOD selection, or arrangement
   placement.** `camera.ts` (flight interpolation, `frameScene`/`frameRect`/
   `flight`) and `arrange.ts` (placement math) are unmodified by this
   workstream. `world.tsx` is touched only for the rendering-level polish
   section E asks for (the path/glow visual weight, the establish-section
   hold-frame emphasis) — its culling/LOD _selection_ logic (the `rendered`
   memo's endpoint-based detail decisions, described in AGENTS.md) is
   unmodified. A diff to `camera.ts`/`arrange.ts`, or to `world.tsx`'s
   culling/LOD selection, is out of scope for this PR by definition; a diff
   to `world.tsx`'s rendering of the path/glow/hold-frame is section E and
   in scope.

### Subjective (visual-review checklist, human judgment)

- Template gallery cards read as one crafted object (thumbnail + footer),
  not an image with an unrelated panel underneath.
- Dashboard/library/settings/recordings empty states and card treatments
  feel continuous with the stage's level of craft, without introducing new
  colors, gradients, or a second accent (`docs/DESIGN.md`'s "deliberately
  avoided" list still applies).
- The establish-section hold-frame reads as a deliberate beat, not a pause.
- The overview route/glow stays legible at higher scene density than the
  7-scene template used during the audit — this is qualitative because
  "legible" doesn't reduce to a single metric; a person checks it at a few
  scene counts (e.g. 7, ~15, ~25) and confirms it doesn't degrade.

## Testing

- Unit/component tests (`tests/unit/`) for the theme-provider default-policy
  change: no stored preference resolves dark; explicit `"light"`/`"dark"`
  unaffected; explicit `"system"` still follows `matchMedia`. Per AGENTS.md's
  testing rule, write the test that fails without the fix and confirm it
  does. This is also the test for acceptance criterion 1 (first-visit dark,
  no flash) — assert the bootstrap script and the hydrated store agree
  rather than only asserting the final DOM state.
- A contrast-ratio check (automated, per acceptance criterion 2) covering
  every light-mode surface/text-token pairing touched by the chroma change.
- A `prefers-reduced-motion` test (per criterion 3) for each new transition
  added in C/D/E, asserting the animated path is skipped.
- Visual verification via the `run` skill (Playwright against the live dev
  server, as used for this audit) for: dashboard light-mode warmth, dark-mode
  default on a fresh (no-localStorage) session, template gallery hover
  states, and the establish-section flourish in present mode — this is where
  the subjective checklist above gets walked, not where the deterministic
  criteria get decided.
- `npm run verify` before considering any part of this done, per AGENTS.md.

## Risks

- OKLCH chroma changes on `--surface-base` propagate everywhere (it's the
  `body` background per `globals.css:178`) — needs visual verification across
  every light-mode surface, not just the dashboard, to avoid muddying text
  contrast.
- The theme-provider change touches `useSyncExternalStore` snapshot logic and
  the pre-hydration inline script together; getting them out of sync
  reintroduces the flash-of-wrong-theme the current code was written to
  avoid. Treat both edits as one unit.
