# Showpiece generation — design

The user's brief, verbatim in spirit: generated decks read as text with one
drawing in twenty minutes. They want a cover slide ("captivating imagery with an
amazing catchy title... disappears with animation with the first click"),
world-class written content, clickable elements where they make sense, roughly
one drawing per ten minutes, and more static imagery. This spec covers all five
as one coherent upgrade to the generation pipeline.

## 1. The cover

A new layout, `cover`: the presentation opens on a full-bleed photograph with a
huge display title over it. The **first advance lifts the image away**,
revealing a conventionally composed title scene (eyebrow / heading / subheading
in theme ink) that was beneath it all along.

### Exit animations exist now

`ElementAnimation` gains `exit: z.enum(["none", "fade", "lift", "zoom"])
.default("none")`. Semantics are fixed and narrow: a non-`none` exit means the
element **leaves on the scene's first advance**. This is the mirror of
`onAdvance` and rides the same machinery:

- `buildStepCount` adds one step per exiting element (the advance that
  dismisses it), exactly as it adds one per `onAdvance` element.
- `ElementLayer` (stage.tsx) animates the element to its exit state when
  `play && step >= 1`, and disables pointer events on it. The element stays
  mounted — playback state stays serialisable, no `AnimatePresence`.
- Returning to the scene lands fully built (`step` = max), so the cover is
  already lifted — the presenter sees the title slide, not the curtain again.
  That is the honest state: nobody replays a reveal by stepping back.
- Editor and thumbnails (`play` false) always show the finished cover.

Exit states: `fade` (opacity), `lift` (up + fade), `zoom` (scale up through the
viewer + fade — the cover's default, it reads as the camera pushing through the
image).

### Composition

`composeScene("cover", …)` lays down, in order (order is z-order):

1. the beneath composition — eyebrow / heading (+accent) / subheading on the
   title layout's own slots, entrance `none` so they are simply there when the
   veil lifts;
2. the veil: a full-bleed image (`scrim` 0.45, exit `zoom`, id prefix `veil`);
3. the veil title: the same heading as one white display line over the image
   (id prefix `veil`, exit `fade`).

With no media supplied, only the beneath composition is created — a cover
without an image degrades to a title slide, not to a full-screen placeholder.
`settleCover(content)` strips the veil elements (by id prefix) from a composed
cover whose image never got filled, so a keyless deployment's generated deck
never presents a grey rectangle. An author can still build a cover by hand:
pick the layout, add an image.

The inspector's animation panel gains an Exit control so the mechanism is
authorable, not generation-only.

## 2. World-class writing

The scenes system prompt in `service.ts` is rewritten around a quality bar
rather than field-filling instructions: arresting titles (a claim or an image
in words, never a topic label), concrete nouns and real magnitudes, varied
scene texture, speaker notes as a speakable script, no throat-clearing. The
cover scene demands a title that could sell the talk on its own.

## 3. Clickable asides

`GeneratedScene` gains `aside` — an optional `{ label, title, body, bullets,
speakerNotes }`. The model is asked to propose a few (guideline: two to four
per deck) where depth-on-demand genuinely helps: the definition behind a term,
the worked example, the data behind a claim.

`materialise` composes the aside into a real detail scene. `weaveAsides` (pure,
tested, injectable id factory) turns the generated list into insert-ready rows:

- the detail scene lands immediately after its parent with
  `flowRole: "detail"` — invisible to the running order, reachable only by
  the dive;
- the parent's best element becomes the hotspot (`callout` > `chart` >
  filled media/drawing > heading), wired to the detail scene's freshly
  assigned id with the aside's label.

Scoped to the **create-from-map** route, where the server assigns every scene
id in one upsert. The regeneration path (`scenes-from-map` → client-side saves)
keeps writing main scenes only; its client schema strips the unknown field. No
dangling hotspots can be written: the wiring happens after ids exist, in the
same payload.

## 4. Drawings scale with the talk

`drawableScenes`' fixed `cap = 3` becomes `drawingCap(totalSeconds)`:
`ceil(totalSeconds / 600)`, clamped to [1, 6] — one staged drawing per ten
minutes, which is what the user asked for. `buildScenesFromMap` takes
`totalSeconds` (create-from-map passes the requested runtime; scenes-from-map
sums its briefs' `estimatedSeconds`). Covers join `media-full` in the
"never line art" exclusion.

## 5. Static imagery when a provider is configured

`GeneratedScene` also gains `photoQuery` (2–5 stock-search words beside the
richer `imagePrompt`). After scenes are written, one bounded dress pass runs
(replacing the drawings-only pass):

- **cover**: stock photo when `PEXELS_API_KEY` is set; else one generated
  image when `OPENAI_API_KEY` is set (reserve-before-spend, budget-capped,
  cover only — at most one paid image per deck); else the veil is stripped;
- **split scenes**: staged drawings up to the duration cap, then stock photos
  for any remaining empty placeholders when configured.

Photos go through the existing sourcing boundary (`searchStockPhotos` →
`saveStockPhoto`): host allowlist, byte ceiling, magic-byte check, re-hosted
into the caller's own storage with provenance. `replaceMediaWithPhoto` patches
the placeholder in place, keeping frame, scrim and (on a cover) the exit
animation. Keyless deployments keep exactly today's behaviour plus more
drawings.

## Testing

Failing-first, per repo rule: cover composition (veil order, degradation,
settle); exit steps in `buildStepCount`; stage dismissal (element gated out at
step ≥ 1 in play mode only); schema round-trips for `exit`, `cover`,
`photoQuery`, `aside`; `drawingCap` values; `weaveAsides` (row order,
`flowRole`, hotspot target resolves, no aside → unchanged); prompt invariants
(cover demands an image, split scenes demand `imagePrompt`); `npm run verify`.

---

## What shipped, and what the first release got wrong (2026-09-06)

The five sections above were built and deployed. Measuring the result against
the production database rather than against the spec found that two of them
were, in effect, dead code — and that the reason was one level above anything
this spec describes.

### The measurement

Across every deck the product had generated at that date — 343 moments, 351
stored scenes:

| intent the model chose | count |     | layout composed | count |
| ---------------------- | ----- | --- | --------------- | ----- |
| statement              | 152   |     | statement       | 143   |
| comparison             | 50    |     | two-column      | 50    |
| imagery                | 47    |     | three-up        | 40    |
| sequence               | 40    |     | bullets         | 38    |
| enumeration            | 32    |     | split-\*        | 47    |
| demonstration          | 17    |     | chart           | 3     |
| data                   | 4     |     | takeaway        | **0** |
| auto                   | **1** |     | action          | **0** |
|                        |       |     | figure          | **0** |
|                        |       |     | explainer       | **0** |
|                        |       |     | quote           | **0** |

Media fill rate, separately, was **100%**: every image slot in every deck was
filled. So "the images aren't populating" was never about unfilled slots. A
seventeen-scene deck had _one slot_.

### What that means for section 4 and section 5

Section 4 scaled the drawing budget to the talk's length — one staged drawing
per ten minutes, up to six. Section 5 filled every remaining empty placeholder
with a photograph. Both worked. Both were sized against a supply of media slots
that composition was not producing: a twenty-minute deck earned four drawings
and offered one or two scenes to draw into.

The lesson is worth keeping because it generalises. **A budget for filling
slots is not a budget for pictures.** Every part of this spec measured its own
success at its own stage, and the stage above it decided the outcome.

### The fix

Composition moved up a level, to `src/lib/narrative/compose.ts`. It is a deck
decision rather than a per-moment one: each moment offers ranked compositions
and the deck picks by what has just been on screen. And `moments.intent_authored`
now records whether the author or the model chose the visual intent, because
the same word is an instruction from one and a shrug from the other.

`docs/AI_ARCHITECTURE.md` carries the current description. This section stays
as the record of what the spec assumed and where the assumption sat.

### Still open against this spec

- **Real-provider quality validation (BETA-003).** Everything above is
  measured structurally — layout counts, fill rates, slot shapes. None of it is
  a creative judgement, and no creative acceptance has been recorded.
- **Physical-device validation (BETA-002).** Unchanged by this work.
- **Durable generation (BETA-006).** The dress pass still races a wall-clock
  budget inside one request: 55 seconds for a deck, 20 for a single scene. A
  slot whose picture loses that race keeps its placeholder. That is bounded and
  honest, and it is not the same as durable.
