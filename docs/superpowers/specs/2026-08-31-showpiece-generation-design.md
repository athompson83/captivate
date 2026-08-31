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
