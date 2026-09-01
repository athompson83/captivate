# AI visual sourcing — design

Workstream 3 of 4 (see `2026-08-23-premium-chrome-design.md` for the full
list). Scopes "AI should make the presentations more visually captivating."

## Problem

Today, nothing in Captivate actually sources or generates an image. The AI
authoring pipeline (`src/lib/ai/service.ts`) only ever produces a _prompt_:
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
integrations, both with real cost/licensing implications. The provider and
budget decisions originally left open in this spec's first draft are now
resolved:

1. **Both stock search and AI generation**, presenter picks per scene rather
   than the app forcing one path.
2. **Stock search: Pexels, not Unsplash.** Verified directly against both
   providers' current terms (fetched during this amendment, not recalled
   from memory) rather than assumed: Unsplash's API guidelines state "All API
   uses must use the hotlinked image URLs returned by the API under the
   `photo.urls` properties" and do not authorize permanent local storage —
   which directly conflicts with section C below (every image in Captivate,
   this one included, is persisted into the app's own private storage, never
   left as a permanent hotlink to an external CDN, per AGENTS.md's database
   rules). Pexels' license ("All photos and videos on Pexels are free to
   use," modification permitted, the only redistribution restriction is
   against _reselling on competing stock-photo platforms_) has no equivalent
   hotlink-only requirement, and is compatible with storing a chosen photo in
   Captivate's own storage the same way an uploaded one is. Attribution is
   still required by Pexels and is still tracked per section D — this
   decision is about storage rights, not about whether credit is owed.
3. **Generation: the OpenAI Image API, `gpt-image-2`, as the sole
   implemented provider for MVP.** No multi-provider abstraction is _used_ in
   MVP, though section B's interface is still narrow-and-swappable in shape
   (see below) so a future provider change is a new implementation of one
   interface, not a rewrite. No model selection is exposed to the presenter
   — the model is an implementation detail, not a setting.
4. **One medium-quality 16:9 image per explicit request.** No high-quality
   tier, no automatic multi-image batches, in MVP — both are levers that
   scale cost per click without scaling the value of one click, and neither
   was asked for.
5. **Budget: $100/month global application budget, an alert at 80% spent, and
   a 25-generation-per-user daily cap.** These bound the cost risk flagged as
   unresolved in this spec's first draft. Enforcement mechanics are section E,
   below — new in this amendment, since a budget number alone is not a
   design, only a target.

## Design

### A. Where this lives: extending the existing "empty placeholder" flow

An image element with no `url` is already a recognized state (created by AI
scene generation, or by an author dragging in an empty image slot). Per
AGENTS.md's explicit warning against exactly this shape ("an empty image
placeholder with a filled surface" is named as one of the regressions to
watch for), the _stage_ must keep rendering an empty placeholder as empty —
this feature lives entirely in the **editor's** picker UI, not in how the
stage paints a missing image.

Today, clicking an empty image placeholder presumably opens an upload/asset
picker (verify exact component during implementation — likely near
`inspector.tsx`/the assets flow). Extend that picker with two new tabs
alongside the existing "Upload":

- **Search** — a text field (pre-filled from `imagePrompt` when the element
  came from AI generation, editable) queries Pexels, renders a results
  grid. Selecting one previews it, then an explicit "Use this image" commits
  it — matching "AI offers, never applies": nothing is inserted until the
  author picks it.
- **Generate** — a text field (same pre-fill) sends the prompt to the
  generation provider, shows the result as a preview the author must
  explicitly accept, with a regenerate option. Never auto-applied, same
  reasoning as Search.

### B. Server-side: a narrow, single-implementation provider interface

New file, `server-only` per AGENTS.md (it holds provider API keys):
`src/lib/ai/visuals-sourcing.ts` (name to avoid confusion with the existing
`suggestVisuals` text-suggestion function in `service.ts`).

**The interface is narrow on purpose, not abstract for its own sake.** MVP
implements exactly one stock provider and one generation provider — nothing
in this spec asks for a provider-selection UI, and none should be built. The
interface exists so a _future_ provider swap (a pricing change, a
deprecation) is a new implementation of one shape, not a rewrite of the
picker/asset-persistence code in sections A and C that calls it:

```ts
interface StockSearchResult {
  thumbnailUrl: string;
  fullUrl: string;
  providerAssetId: string;
  originalPageUrl: string;
  creatorName: string;
  creatorPageUrl: string;
  licenseRef: string; // e.g. "Pexels License" — see section D
}

interface StockProvider {
  search(
    query: string,
  ): Promise<{ ok: true; data: StockSearchResult[] } | { ok: false; error: string }>;
}

interface GeneratedImageResult {
  previewUrl: string;
  model: string;
  prompt: string;
  widthPx: number;
  heightPx: number;
  quality: "medium";
  generationMs: number;
}

interface GenerationProvider {
  generate(
    prompt: string,
  ): Promise<{ ok: true; data: GeneratedImageResult } | { ok: false; error: string }>;
}
```

Two concrete, exported server actions call these, each returning `{ ok:
true; data } | { ok: false; error }` per the "errors are values" rule:

- `searchStockPhotos(query: string)` — backed by a `PexelsStockProvider`
  implementing `StockProvider`, calling Pexels' search endpoint. Returns
  `{ ok: false, error: "Image search isn't configured" }` when
  `PEXELS_API_KEY` is absent, mirroring how AI text generation degrades
  today when `ANTHROPIC_API_KEY` is absent.
- `generateImage(prompt: string)` — backed by an `OpenAiImageProvider`
  implementing `GenerationProvider`, calling the OpenAI Image API with
  `model: "gpt-image-2"`, one image, `quality: "medium"`, 16:9 dimensions
  (verify OpenAI's exact size-parameter values for a 16:9 aspect at
  implementation time rather than guessing a pixel size here — provider
  parameter names/enums are exactly the kind of detail that drifts). Returns
  the same "not configured" shape when `OPENAI_API_KEY` is absent. This
  action is also where the budget check (section E) gates the call — before
  spending anything, not after.

Both go through `src/lib/ai/rate-limit.ts` (already exists for text
generation) for basic call-rate bounding; section E's budget/daily-cap
enforcement is a separate, stronger gate specific to `generateImage` (search
has no per-call cost, so it does not need the budget gate — only the
existing rate limiter, to keep it from being hammered).

### C. Persisting a chosen image: reuse the asset pipeline, allowlisted ingestion only

Per AGENTS.md's database rules ("Storage buckets are private and served
through signed URLs"), a chosen stock/generated image must not be left as a
permanent hotlink to an external CDN — external URLs go stale, and every
other image in the app is already served from Captivate's own private
storage via `registerAsset` (`src/lib/data/assets.ts:43`). When the author
commits a Search or Generate result, the server (never the browser) fetches
and re-hosts the image — and this fetch is a real security boundary, not an
implementation detail:

1. **The fetch target is restricted to a small, provider-issued allowlist of
   hosts** — the specific CDN hostnames Pexels' API responses and OpenAI's
   Image API responses actually return image URLs from (enumerate the exact
   hostnames at implementation time by inspecting real API responses, not by
   guessing a pattern). This is deliberately **not** a general "fetch any
   URL the server is told to" utility — `searchStockPhotos`/`generateImage`
   are the only two callers that ever produce a URL to ingest, both server-
   controlled, so the ingestion function itself should refuse any URL whose
   host isn't on the allowlist even if a caller somehow passed one.
2. **Bounded fetch**: a request timeout and a maximum byte size (reject
   before fully downloading an oversized response, not after), consistent
   with the existing `MAX_UPLOAD_BYTES` ceiling already enforced for direct
   uploads (`src/lib/data/upload-limits.ts`) — reuse that same constant
   rather than inventing a second limit.
3. **Verify, don't trust, the content**: check the response's MIME type
   against `ALLOWED_MIME` (same file), and verify the _decoded_ image format
   matches (a file claiming `image/jpeg` that isn't a real JPEG is rejected,
   not passed through) — the same posture AGENTS.md's validate-at-every-
   boundary rule already takes with user input and model output.
4. **Normalize dimensions and strip metadata** (EXIF and similar) before
   storage — a provider's original file may carry embedded location/device
   data that has no reason to pass through Captivate's storage.
5. Upload the verified, stripped bytes to the user's own storage prefix
   (`${user.id}/...`), same convention `registerAsset` already enforces.
6. Call `registerAsset` with structured provenance (section D) rather than a
   single free-text attribution field.

### D. Provenance: structured fields, not one attribution string

The original draft of this spec proposed a single `attribution: text`
column. That's enough to _display_ a credit line but not enough to answer
"where did this specific asset actually come from" later — for a cost audit,
a licensing question, or debugging a bad generation. Extend the `assets`
table (new append-only migration per AGENTS.md's database rule, RLS
unchanged — owner-scoped like every other table, since this is new columns
on an existing table, not a new one) with:

- `source: "upload" | "stock" | "generated"` (default `"upload"`, so
  existing rows need no backfill).
- For `source: "stock"`: `provider_asset_id`, `original_page_url`,
  `creator_name`, `creator_page_url`, `license_ref` (e.g. `"Pexels
License"`), `verified_at` (timestamp — when this asset's licensing was
  last confirmed against the provider's terms, so a future terms change has
  something to check existing assets against rather than only new ones).
- For `source: "generated"`: `provider` (e.g. `"openai"`), `model` (e.g.
  `"gpt-image-2"`), `prompt` (the exact text sent), `width_px`, `height_px`,
  `quality`, `generation_ms`, and whatever usage/cost figure the provider's
  response includes (store it even if the exact unit needs confirming at
  implementation time — an approximate cost record beats none for the
  budget reconciliation in section E).
- `null` for every stock/generated-specific column when `source: "upload"`.

**Attribution display stays out of the stage.** Pexels' license requires
crediting the photographer; the stage itself must **not** grow a credit
overlay — that's exactly the kind of thing `docs/DESIGN.md`'s "world has no
rectangles" / "decorative" rules exist to prevent, and it would look wrong on
every scene that isn't a stock photo. Surface it in the **editor** only —
the assets library (`asset-library.tsx`) shows a credit line built from
`creator_name`/`original_page_url` for any asset with `source: "stock"`, and
the image element's inspector shows the same. (Re-verify this reading of
Pexels' terms against their current license page at implementation time —
terms can change, and this amendment's verification is a snapshot, not a
standing guarantee.)

### E. Budget: atomic reservation, not a check-then-spend race

A $100/month global budget, an 80%-spent admin alert, and a 25-generation
per-user daily cap (decisions above) are numbers, not a mechanism —
`generateImage` is called from ordinary request handlers, and nothing stops
two concurrent requests both reading "we're at $99 of $100, this $2 call is
fine" and both proceeding, landing at $103. The gate has to be a single
atomic operation, not a read-then-write:

- New table, `ai_image_usage` (or extend an existing usage/quota table if
  the codebase already has one for text generation — check
  `src/lib/ai/rate-limit.ts` and any table it reads from first, since
  reusing that mechanism's shape is preferable to a structurally-identical
  second one): tracks a running total spent this calendar month (global) and
  per-user generations today, both updated by the same reservation step.
- **Reserve before calling the provider, reconcile after.** Immediately
  before calling OpenAI: atomically check (global monthly spend + this
  request's _estimated_ cost ≤ $100) AND (this user's generations today <
  25), and if both hold, atomically increment both counters by the
  estimate — a single database operation (e.g. a Postgres function with
  appropriate row locking, or an atomic `UPDATE ... WHERE` guard clause that
  fails the update if either bound would be exceeded) so two concurrent
  requests can't both pass the check before either commits. If the atomic
  reserve fails, the call to OpenAI never happens (see the graceful-
  degradation behavior below). After the provider responds, reconcile the
  reservation to the _actual_ reported cost — refund the difference if the
  estimate was high, or (since the reservation already happened) accept a
  small overshoot if it was low, rather than under-reserving to begin with.
- **Failure is graceful, not global.** When the monthly budget or a user's
  daily cap is exhausted, `generateImage` returns `{ ok: false, error: "..."
}` with language that's honest about _why_ (budget exhausted vs. your
  daily limit reached — these are different situations for a presenter to
  understand), and — critically — this failure must not affect
  `searchStockPhotos`, direct upload, or browsing existing assets at all.
  Section A's picker keeps its Search and Upload tabs fully functional; only
  the Generate tab shows the exhausted state. This is what "fail gracefully
  while leaving other capabilities available" means concretely: a budget
  problem in one provider's spend tracking must not read as "images are
  broken."
- The 80% admin alert is a notification (email, log-based alert, or
  whatever the codebase's existing alerting convention is — check for one
  before inventing a new channel), not a blocker — it exists so a human
  can decide whether to raise the cap before the hard stop at 100%, not to
  gate any user-facing behavior itself.

### F. Clinical and factual-visual guardrails

Captivate's own templates and audit findings (the "Recognising Shock"
example presentation seen during the original project review) show this
tool is used for clinical/medical and other technical instruction — content
where a _wrong-looking-right_ image is worse than no image. An AI-generated
ECG trace, drug label, dosage figure, procedure-sequence diagram, or
quantitative chart is exactly the kind of image that can look authoritative
while being fabricated, since the model has no grounding in the actual
data/waveform/label it's asked to render.

- The Generate flow's prompt-input UI (section A) must carry a visible,
  persistent notice — not a one-time dismissible tooltip — that generated
  images are illustrative, not a source of clinical, quantitative, or
  factual truth, and must not be presented as authoritative evidence
  (a real ECG strip, a real chart of real data, a real drug label).
- Consider (implementation-time decision, not mandated here) a lightweight
  prompt-side check that flags likely-clinical/quantitative requests (e.g.
  prompts mentioning ECG, dosage, lab values, chart/graph of specific
  numbers) with a stronger inline warning before generation proceeds, rather
  than after — the earlier the warning, the more likely it changes the
  author's choice rather than just documenting that they were told.
- This is a guardrail on _use_, not a technical block on generation itself —
  Captivate does not have a way to verify a prompt's clinical intent with
  certainty, and false-positive blocking would just push authors to route
  around it. The honest mechanism is a clear, hard-to-miss warning, matching
  `docs/UX.md`'s "Honest about limits" posture used everywhere else in this
  app, not a doomed attempt at automatic prevention.

### G. Whole-deck AI scene generation does not spend money automatically

`service.ts`'s existing scene-generation flow (the `imagePrompt`
placeholder, described in Problem above) runs across an entire deck's worth
of moments in one pass today. This workstream must not turn that into an
automatic image-generation bill: an `imagePrompt` on a freshly generated
scene stays exactly what it is today — a prompt and an empty placeholder,
nothing more. Search and Generate (section A) are both **presenter-
initiated, per-scene, one click at a time** — whole-deck generation creating
placeholders and prompts is unchanged and unbudgeted (there's nothing to
budget, since no provider call happens); actually filling those placeholders
with real images is always a separate, explicit, per-scene action that goes
through section E's budget gate.

### H. Metrics and a provider review checkpoint

Record, per generation attempt: accepted / rejected (regenerated or
abandoned) by the author, latency, whether OpenAI's response included a
moderation flag or the request otherwise failed/fell back to an error state,
and the reconciled cost (section E). This is the same category of
"actionable logging" AGENTS.md and this amendment's other sections already
require for provider failures and budget rejections — store it queryable
(the `ai_image_usage`-adjacent table from section E is a natural home,
or a dedicated events table if the volume/shape doesn't fit there) rather
than only as unstructured logs.

**After 250 real generation attempts** (production usage, not test/dev
calls), a provider review is required before continuing unbounded — check
the acceptance rate (are presenters keeping what's generated, or mostly
discarding it — a low keep rate means the feature isn't working as intended
regardless of budget), the actual average cost against the $100/month
assumption, and whether `gpt-image-2` remains OpenAI's current recommended
model (provider model names and pricing change). This checkpoint is a
process step for whoever owns this feature post-launch, not something the
software enforces automatically — record it here so it isn't forgotten
between this spec and that point being reached.

### I. Tie-in with existing health checks

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
- No multi-provider abstraction _exposed_ anywhere (no provider picker, no
  model selection) — section B's interface is narrow and single-implementation
  for MVP, not a plugin system.
- No high-quality tier, no multi-image batches — one medium 16:9 image per
  request, per the decisions above.
- No general-purpose server-side URL fetcher — section C's ingestion is
  allowlisted to the two providers' own response hosts, nothing else.
- No automatic whole-deck image generation — section G.

## Testing

- Server actions: unit tests for `searchStockPhotos`/`generateImage` "not
  configured" fallback (no key → clear error, not a 500 — per AGENTS.md's
  server-action rules), and for the asset-persist step writing correct
  structured provenance values (section D) for each `source`.
- **Budget enforcement (section E), the highest-value tests in this spec**:
  - Two concurrent `generateImage` calls near the monthly cap — at most one
    succeeds if both together would exceed $100; no scenario where both
    succeed and the total overshoots.
  - A user's 26th generation attempt in a day is rejected while their 25th
    succeeds (boundary test, not just "some number over the cap fails").
  - Budget/daily-cap exhaustion returns a clear, specific error and does not
    throw a 500; `searchStockPhotos` and direct upload remain unaffected by
    exhausted generation budget in the same test run.
  - The 80%-spent alert fires exactly once per crossing (not once per
    request after crossing), verified against whatever alerting mechanism
    implementation-time chooses.
- **Ingestion security (section C)**:
  - A fetch target outside the allowlist is rejected before any network
    call is attempted.
  - An oversized response is rejected without buffering the full body.
  - A response whose declared MIME type doesn't match its decoded format is
    rejected.
- Schema/migration: RLS test (`npm run test:rls`) for the new `assets`
  columns, following the existing owner-scoped pattern.
- Component test for the picker's Search/Generate tabs: a result is never
  applied to the element until explicit confirmation; the clinical/factual
  guardrail notice (section F) is present and not a one-time-dismissible
  element (re-appears on a fresh Generate session, not just suppressed after
  first shown).
- `npm run verify` gate per AGENTS.md.

## Risks

- **Cost — now bounded, but the reservation mechanism (section E) is the
  single highest-risk piece of code in this workstream.** A budget cap
  that can be raced past by concurrent requests is not a cap; this needs the
  atomic reserve-then-reconcile design tested exactly as prescribed above,
  not spot-checked.
- **Licensing drift.** Attribution/storage-rights requirements are a live
  legal surface — this amendment verified Pexels' and Unsplash's _current_
  terms directly (see the Decisions section), but "current" means "as of
  this amendment," not permanently; `verified_at` (section D) exists
  specifically so a future terms change has something to check existing
  assets against.
- **External dependency at request time.** Both integrations add a
  network call + failure mode inside an authoring flow that otherwise has no
  such dependency; both need the same "clear not-configured / clearly failed"
  honesty `docs/UX.md` already requires elsewhere, not a silent hang or a
  generic error.
- **Clinical misuse (section F)** is a risk this spec can only mitigate with
  a warning, not eliminate with a technical control — worth stating plainly
  rather than implying the guardrail is stronger than it is.

---

## What shipped, and where it differs from the above

Added when the feature landed, so this document stays accurate about the code.

- **No new usage table.** Section E suggested `ai_image_usage` "or extend an
  existing usage/quota table if the codebase already has one" — it does.
  `ai_generations` gained `cost_usd` and `duration_ms`, and image generations
  are rows in it with `kind = 'image'`. That reuses the reservation machinery
  built for text generation rather than standing up a structurally identical
  second one, which is what the section asked for.
- **The lock is global, not per user.** The text reservation locks per user,
  because its limit is per user. The budget is shared, so two different people
  spending its last dollar simultaneously is precisely the race a per-user lock
  would not catch.
- **A failed provider call is still charged at the estimate.** Not stated in
  section E, and it matters: charging zero for a failure makes an outage look
  like free capacity, and retries would burn the month's budget without
  producing a single image.
- **No EXIF stripping, and no `sharp`.** Section C step 4 asked for metadata
  stripping and dimension normalisation. What shipped verifies the format from
  the file's magic bytes and enforces the byte ceiling while reading, but does
  not re-encode. Adding an image-processing dependency to strip metadata from
  two providers' own output is a trade worth making deliberately rather than
  in passing — Pexels and OpenAI both serve processed output, so the realistic
  exposure is small, but this is a gap and is recorded as one here rather than
  quietly dropped.
- **The clinical guardrail includes the prompt-side check** section F left as
  an implementation-time decision. A prompt naming an ECG, a dosage, a lab
  value or a chart of specific numbers draws a stronger warning before the
  generation, where it can still change the author's mind.
- **Attribution is a column set, and it is not on the stage.** As designed.
  Credit appears in the asset library and the inspector; the stage grows no
  credit overlay.
- **Not verified against either live provider.** This deployment has neither
  `PEXELS_API_KEY` nor `OPENAI_API_KEY`, so both paths are tested against
  mocked responses and both degrade to an absent tab when unconfigured. The
  request shapes — Pexels' search parameters, OpenAI's image model name and
  size enum — are written from the documented contracts and should be
  confirmed against a real response before the feature is announced.
