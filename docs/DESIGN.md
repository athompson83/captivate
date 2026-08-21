# Design

## The metaphor

A darkened stage lit by a warm spotlight.

That is not decoration — it is the reason for every colour decision. Captivate
is used in lecture theatres and meeting rooms, often with the lights down. The
interface is dark by default because it sits next to a dark projection; the
accent is warm gold because that is what a stage light looks like.

It also settles what Captivate is *not*. It does not look like PowerPoint,
Google Slides, Keynote, Canva or Gamma, because none of those start from "you
are about to stand up in front of people".

---

## Colour

Everything is OKLCH, so lightness is perceptually even and a token can be
adjusted without hue drift.

| Role | Purpose |
| --- | --- |
| `surface-base` / `sunken` / `raised` / `overlay` | Four elevations, no more |
| `text-primary` / `secondary` / `muted` | Three text weights, no more |
| `accent` | Warm gold. Primary actions, selection, focus |
| `ai` | Orchid. **Only** AI affordances |
| `record` | Crimson. **Only** recording |
| `success` / `warning` / `danger` | Status |

The semantic separation is load-bearing. Orchid means "a model is involved" and
nothing else; crimson means "you are being recorded" and nothing else. A user
learns each in one exposure.

Light mode is warm paper rather than clinical white, and keeps the same
relationships with a darker accent for contrast.

---

## Type

- **Inter** — interface. Neutral, excellent at small sizes.
- **Fraunces** — presentation display. An editorial serif with real character,
  because a lecture title deserves better than a UI font at 80px.
- **Space Grotesk** — the Signal and Chalk themes.
- **JetBrains Mono** — code.

Self-hosted through `next/font`, which is why `font-src` can stay tight and
there is no third-party font request at runtime.

Interface type runs 10px–26px on a tight scale. Stage type derives from a "stage
rem" so it scales with the presentation rather than the browser.

---

## Space and shape

4px base rhythm. Six radius steps from 4px to 28px, used consistently: small
controls small, panels large, the stage largest.

Five elevation levels, all soft and low-contrast. Elevation separates surfaces;
it does not decorate them.

---

## Motion

| Duration | Used for |
| --- | --- |
| 90ms | Hover, immediate feedback |
| 150ms | Micro-interactions |
| 220ms | Panels, dialogs |
| 380ms | Larger transitions |
| 620ms | Stage transitions |

`cubic-bezier(0.22, 1, 0.36, 1)` almost everywhere — fast out, gentle in, no
overshoot.

Two rules. Motion never delays a basic action: a button responds in 90ms whether
or not anything animates. And presentation motion may be more expressive than
interface motion, because on stage it is doing narrative work.

`prefers-reduced-motion` is honoured globally in CSS and again in the stage
renderer.

---

## What was deliberately avoided

- **A permanent ribbon.** Formatting controls appear with a selection and
  disappear with it.
- **Competing sidebars.** One navigator on the left, one inspector on the right,
  and the inspector only exists when something is selected.
- **Cards inside cards.** Elevation is used once per surface.
- **Decorative gradients.** Two exist: the stage vignette, which is the
  metaphor, and a soft accent glow on the AI card, which reinforces the semantic
  colour.
- **Tiny controls.** Nothing interactive is smaller than 28px.
- **Colour as the only signal.** Save state carries an icon and text; recording
  carries a pulse, a label and a timer; focus is a two-tone ring, not a hue.

---

## Focus

A two-tone ring: a surface-coloured inner halo, then the accent. It reads on any
elevation without depending on the colour underneath, which a single-colour
outline does not.

Applied globally to `:focus-visible`, so keyboard users see it and mouse users
are not distracted by it.

---

## Accessibility

Semantic elements throughout — real buttons, real headings, real form labels.
Every icon-only control has an `aria-label`; tooltips are supplementary, never
the only name.

`aria-live` regions announce save state, recording state and scene changes.
Dialogs trap focus and restore it on close. The scene jumper, command palette
and inspector are all keyboard-navigable.

Charts require a text description. Images prompt for alt text, and the assets
page shows a running count of images that still lack it, because a deck full of
unlabelled images is inaccessible the moment it is shared.

---

## Responsive

Desktop is the authoring environment and is not compromised to claim mobile
editing.

- **Dashboard, notes, assets, recordings, settings** adapt down to phone width.
- **The editor** is desktop-first; the navigator collapses and the inspector
  overlays on narrow screens, but it is not a phone experience and does not
  pretend to be.
- **The stage** works at any size, which matters — the audience display is often
  an unusual aspect ratio.
