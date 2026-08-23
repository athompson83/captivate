# AI visual sourcing — design

Workstream 3 of 4 (see `2026-08-23-premium-chrome-design.md` for the full
list). Scopes "AI should make the presentations more visually captivating."

## Problem

Today, nothing in Captivate actually sources or generates an image. The AI
authoring pipeline (`src/lib/ai/service.ts`) only ever produces a *prompt*:
scene generation creates an empty image placeholder (`url: "", alt:
scene.imagePrompt`, `service.ts:483`) when the model thinks a scene needs a
picture, and `suggestVisuals` (`service.ts:578`) returns text descriptions of
images that would help — never a real image. This is consistent with
`docs/UX.md`'s "AI offers, never applies," but it means "more visually
captivating" today requires a human to read the prompt, go find or make a
picture themselves, and upload it. There is no search, no generation, and no
attribution/licensing handling anywhere in the codebase (confirmed — no
stock-photo or image-generation integration exists).

## Decisions made with the user

This is the largest of the four workstreams — it requires two new external
integrations, both with real cost/licensing implications the user, not this
spec, is accountable for:

1. **Both stock search and AI generation**, presenter picks per scene rather
   than the app forcing one path.
2. **Provider defaults are proposed here, not locked in** — same pattern as
   `ANTHROPIC_API_KEY`: optional, with a clear "not configured" state when
   absent, per `docs/UX.md`'s "Honest about limits." Confirm before
   implementation:
   - **Stock search: Unsplash.** Well-documented API, generous free tier,
     real photographs (no "AI slop" look for the many decks where that
     matters). Requires attribution per Unsplash's API terms — see below.
   - **Generation: left as an explicit open decision.** Provider pricing and
     quality shift often enough that hard-coding one into a design doc risks
     being stale by implementation time; the implementation plan should
     confirm current provider/pricing with the user directly rather than
     inheriting a choice made here from memory.

## Design

### A. Where this lives: extending the existing "empty placeholder" flow

An image element with no `url` is already a recognized state (created by AI
scene generation, or by an author dragging in an empty image slot). Per
AGENTS.md's explicit warning against exactly this shape ("an empty image
placeholder with a filled surface" is named as one of the regressions to
watch for), the *stage* must keep rendering an empty placeholder as empty —
this feature lives entirely in the **editor's** picker UI, not in how the
stage paints a missing image.

Today, clicking an empty image placeholder presumably opens an upload/asset
picker (verify exact component during implementation — likely near
`inspector.tsx`/the assets flow). Extend that picker with two new tabs
alongside the existing "Upload":

- **Search** — a text field (pre-filled from `imagePrompt` when the element
  came from AI generation, editable) queries Unsplash, renders a results
  grid. Selecting one previews it, then an explicit "Use this image" commits
  it — matching "AI offers, never applies": nothing is inserted until the
  author picks it.
- **Generate** — a text field (same pre-fill) sends the prompt to the
  generation provider, shows the result as a preview the author must
  explicitly accept, with a regenerate option. Never auto-applied, same
  reasoning as Search.

### B. Server-side: new AI-adjacent service module

New file, `server-only` per AGENTS.md (it holds provider API keys):
`src/lib/ai/visuals-sourcing.ts` (name to avoid confusion with the existing
`suggestVisuals` text-suggestion function in `service.ts`). Two server
actions, both returning `{ ok: true; data } | { ok: false; error }` per the
"errors are values" rule:

- `searchStockPhotos(query: string)` — calls Unsplash's search endpoint,
  returns a small result set (thumbnail URL, full URL, photographer name,
  photographer profile URL, Unsplash photo page URL — all required for
  attribution). Returns `{ ok: false, error: "Image search isn't configured"
  }` when `UNSPLASH_ACCESS_KEY` is absent, mirroring how AI generation
  degrades today when `ANTHROPIC_API_KEY` is absent.
- `generateImage(prompt: string)` — calls the (TBD) generation provider,
  returns a preview URL. Same "not configured" fallback when its key is
  absent.

Both go through `src/lib/ai/rate-limit.ts` (already exists for text
generation) — image generation costs real money per call and both are
user-initiated but should not be callable without bound, same reasoning that
already applies to scene/notes generation.

### C. Persisting a chosen image: reuse the asset pipeline, don't hotlink

Per AGENTS.md's database rules ("Storage buckets are private and served
through signed URLs"), a chosen stock/generated image must not be left as a
permanent hotlink to an external CDN — external URLs go stale, and every
other image in the app is already served from Captivate's own private
storage via `registerAsset` (`src/lib/data/assets.ts:43`). When the author
commits a Search or Generate result:

1. Server-side, fetch the chosen image's bytes (from Unsplash's download URL
   — which per their API terms must be pinged to register the download, or
   from the generation provider's result URL).
2. Upload to the user's own storage prefix (`${user.id}/...`), same
   convention `registerAsset` already enforces.
3. Call `registerAsset` with the new metadata, extended with two new
   optional fields this workstream adds to the `assets` table (new
   append-only migration per AGENTS.md's database rule, with matching RLS —
   owner-scoped like every other table):
   - `source: "upload" | "stock" | "generated"` (default `"upload"`, so
     existing rows need no backfill)
   - `attribution: text nullable` — for stock, the required photographer
     credit string + profile/photo links; null for uploads and generated
     images (generated images need no photographer credit, but may need a
     provider disclosure depending on which provider is chosen — revisit
     once C's open provider decision is resolved).

### D. Attribution: tracked, not painted onto the stage

Unsplash's API terms require crediting the photographer wherever the photo
is used. The stage itself must **not** grow a credit overlay — that's exactly
the kind of thing `docs/DESIGN.md`'s "world has no rectangles" /
"decorative" rules exist to prevent, and it would look wrong on every scene
that isn't a stock photo. Instead: surface attribution in the **editor**
only — the assets library (`asset-library.tsx`) shows a credit line for any
asset with `source: "stock"`, and the image element's inspector shows the
same. This satisfies the license requirement without touching what the
audience sees. (Confirm this reading of Unsplash's terms against their
current API guidelines during implementation — terms can change.)

### E. Tie-in with existing health checks

`src/lib/analysis/` already has a "Media described" check (seen live in the
audit: "2 of 2 have no alt text"). Once search/generate exist, consider
whether a scene with an AI-authored `imagePrompt` that was never resolved to
a real image deserves a similar actionable finding ("this scene wanted an
image and doesn't have one yet — search or generate") — decide during
implementation by checking whether it fits the existing check's shape
(AGENTS.md: "every non-passing check carries a fix") rather than bolting on
a special case.

## Non-goals

- No automatic insertion of sourced/generated images without explicit author
  approval — this would violate "AI offers, never applies."
- No AI-driven whole-canvas background imagery — that's a separate,
  already-rejected idea (see the initial project review: the world
  deliberately has no whole-canvas background, "a colour is atmosphere, an
  image is content"). This workstream sources images for scene-level `image`
  elements, which already exist and are already content.
- No changes to `suggestVisuals`'s text-suggestion behavior — Search/Generate
  are new, additive entry points; the existing text-only suggestion flow is
  untouched.
- No video/audio sourcing — image only, per the user's original request.

## Testing

- Server actions: unit tests for `searchStockPhotos`/`generateImage` "not
  configured" fallback (no key → clear error, not a 500 — per AGENTS.md's
  server-action rules), and for the asset-persist step writing correct
  `source`/`attribution` values.
- Schema/migration: RLS test (`npm run test:rls`) for the new `assets`
  columns, following the existing owner-scoped pattern.
- Component test for the picker's Search/Generate tabs: a result is never
  applied to the element until explicit confirmation.
- `npm run verify` gate per AGENTS.md.

## Risks

- **Cost.** Generation is metered per call; needs the rate-limit tie-in (B)
  and the user's explicit provider/budget sign-off before implementation —
  this is the one item in this spec that isn't fully resolved and shouldn't
  be treated as such.
- **Licensing drift.** Attribution requirements are a live legal surface
  (Unsplash's terms, and whatever the generation provider's usage terms
  turn out to require) — verify current terms at implementation time rather
  than trusting this document's description of them.
- **External dependency at request time.** Both integrations add a
  network call + failure mode inside an authoring flow that otherwise has no
  such dependency; both need the same "clear not-configured / clearly failed"
  honesty `docs/UX.md` already requires elsewhere, not a silent hang or a
  generic error.
