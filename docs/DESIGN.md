# Design

## The metaphor

A darkened stage lit by a coloured spotlight.

That is not decoration — it is the reason for every colour decision. Captivate
is used in lecture theatres and meeting rooms, often with the lights down. The
interface is dark by default because it sits next to a dark projection; the
light on that stage is the mark's own — violet leading, coral and amber at the
rim — because the brand is a gradient and a product that only ever shows one
end of it is showing the part that is not the brand.

It also settles what Captivate is _not_. It does not look like PowerPoint,
Google Slides, Keynote, Canva or Gamma, because none of those start from "you
are about to stand up in front of people".

---

## Colour

Everything is OKLCH, so lightness is perceptually even and a token can be
adjusted without hue drift.

| Role                                             | Purpose                                   |
| ------------------------------------------------ | ----------------------------------------- |
| `surface-base` / `sunken` / `raised` / `overlay` | Four elevations, no more                  |
| `text-primary` / `secondary` / `muted`           | Three text weights, no more               |
| `accent`                                         | Violet. Primary actions, selection, focus |
| `ai`                                             | Magenta. **Only** AI affordances          |
| `record`                                         | Crimson. **Only** recording               |
| `success` / `warning` / `danger`                 | Status                                    |
| `brand-*`                                        | The kit's ramp. Identity, not a role      |
| `brand-gradient`                                 | The mark's sweep. Signature marks only    |

The semantic separation is load-bearing. Magenta means "a model is involved"
and nothing else; crimson means "you are being recorded" and nothing else. A
user learns each in one exposure.

That separation is why the accent moved and the AI colour moved with it. The
accent was gold at oklch L 0.8 H 72 and `warning` was L 0.8 H 75 — three
degrees apart, so in the dark theme a warning and a primary action were the
same colour.

There are two layers now, and the distinction decides where a new colour goes:

- the `--brand-*` ramp is **identity**. Eight values — ink, navy, indigo,
  violet, magenta, coral, amber, paper — taken from the Captivate Brand &
  Style Kit v1.0 and its companion token file, converted to OKLCH, and
  identical in both themes. An identity that changed with the time of day
  would not be one.
- everything else is a **role**, derived to clear WCAG AA on the ground it
  sits on. That derivation is not cosmetic: the kit's success, warning and
  danger are fills meant to carry ink, and all three fall below 4.5:1 as text
  on paper, so the role tokens keep the kit's hue and take the lightness
  contrast needs.

`accent` is the kit's violet, #6D39F7, at the same value in both themes —
white clears AA on it at 5.87:1, which is what makes one accent possible where
the light theme previously needed a darker violet of its own. Violet leads
action; coral and amber are emphasis and never a destructive control.

`brand-gradient` is the whole sweep — indigo, violet, magenta, amber at the
kit's 120° and its stated stops. It marks the things that carry the brand
rather than an interface state: the mark's tile, a rule on the front door.
Never behind body text. Four hues under a paragraph is a background; this is a
signature. The stops interpolate in OKLab rather than sRGB, which is the whole
reason the ramp is stored in OKLCH: sRGB runs indigo to violet through a grey
middle, and this gradient is three hue turns in a row.

Both themes are one hue family. Dark surfaces are midnight — the same
lightness ladder they always had, but blue rather than a grey with an opinion,
with `surface-raised` at #061436 exactly. Light mode is the kit's cool paper
rather than the warm cream it used to be, so a screenshot taken in the light
theme is recognisably the same product.

---

## Type

- **Inter** — interface and body copy.
- **Manrope** — display. The kit's display face, and a geometric sans because
  Captivate's own logotype is one. It replaced Fraunces, an editorial serif
  that said something true about a lecture title and something wrong about a
  spatial tool.
- **Space Grotesk** — the Signal and Chalk themes.
- **JetBrains Mono** — code.

Self-hosted through `next/font`, which is why `font-src` can stay tight and
there is no third-party font request at runtime.

Interface type runs 10px–26px on a tight scale. Stage type derives from a "stage
rem" so it scales with the presentation rather than the browser.

---

## Space and shape

4px base rhythm. Six radius steps from 4px to 32px, used consistently: small
controls small, panels large, the stage largest. The kit sets two ranges —
controls 8–14px, cards 14–22px — and each step sits inside the range for the
role its name is used in. `md` is 12 rather than the kit's 14 because most of
its uses are 32px-square icon buttons, where 14px is within a pixel of a
circle.

Motion is the kit's three durations — 120ms for hover and focus, 220ms for
panels and control state, 420ms for a spatial reveal — on `--ease-brand`,
`cubic-bezier(.2, .8, .2, 1)`. A stage flight is longer than any of them
because a camera crossing the world is not interface motion.

Five elevation levels, all soft and low-contrast. Elevation separates surfaces;
it does not decorate them.

---

## Motion

| Duration | Used for                  |
| -------- | ------------------------- |
| 90ms     | Hover, immediate feedback |
| 150ms    | Micro-interactions        |
| 220ms    | Panels, dialogs           |
| 380ms    | Larger transitions        |
| 620ms    | Camera flights            |

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
- **The editor** is desktop-first, but every control it renders can be reached.
  Below `md` the navigator collapses and reopens over the canvas rather than
  beside it, closing again once a scene is chosen; the inspector becomes a
  half-height sheet under the canvas, so the scene refits into what is left
  instead of being squeezed to a thumbnail; the header splits into two rows,
  giving the view switcher its own full-width one and folding the secondary
  controls into a single menu; and the floating selection toolbar wraps rather
  than hanging off the side. It is not a phone experience and does not pretend
  to be — but nothing on the page is out of reach.
- **The stage** works at any size, which matters — the audience display is often
  an unusual aspect ratio.
