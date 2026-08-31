# Progress

## Current State

- Product: Captivate
- Lifecycle stage: Beta / production-readiness
- Control-graph node: HOSTED_RUNTIME_VERIFICATION (live app in owner-driven test loop)
- Current milestone: Presentation-content quality — make generated decks visually and verbally worth presenting
- Branch: `claude/premium-ui-presentation-akzjzs` (PR #28, draft, CI pending)
- `main`: `2b33509` — PRs #22–#27 merged and deployed via Vercel auto-deploy
- Production: live and in use; the owner tests deployed builds and reports defects
- Database target: canonical Captivate Supabase project; no schema change this session

## Latest Session

### Objective

The owner's content-quality brief: a title slide with captivating full-screen
imagery that dismisses on the first click, world-class generated writing,
clickable elements where they make sense, roughly one drawing per ten minutes,
and more static imagery.

### Completed (PR #28)

- **Cover scenes**: new `cover` layout plus a narrow `ElementAnimation.exit`
  mechanism (dismissed by the scene's first advance, riding the build-step
  machinery). A cover degrades to a title slide when no image arrives
  (`settleCover`); the exit is authorable from the inspector.
- **Content prompt rewrite**: the scenes system prompt now enforces a quality
  bar — headings as claims, a cover title that sells the talk, concrete
  language, varied scene texture, script-quality speaker notes. Output ceiling
  16k tokens / 180s timeout.
- **AI asides**: generation may propose depth-on-demand asides; `weaveAsides`
  turns them into `flowRole: "detail"` scenes hotspot-wired to their parents,
  ids assigned server-side in the same insert.
- **Duration-scaled drawings**: `drawingCap(totalSeconds)` — one per ten
  minutes, min 1, max 6 — replaces the fixed cap of three.
- **Photo dress pass**: empty media slots fill with Pexels stock (and, for the
  cover only, one budget-gated generated image) through the existing sourcing
  boundary, when provider keys are configured.

### Verification

- `npm run verify` green: 801 unit/component tests across 58 files, build clean.
- New coverage: `tests/unit/cover-scene.test.tsx`, `tests/unit/weave-asides.test.ts`,
  extended `place-drawing`, `present`, `narrative-map` suites.

### Earlier in this stabilization cycle (already on `main`)

- PR #22 drawn pictures; #23 sign-in read retry; #24 Claude 5 sampling-param
  removal; #25 rail inset, auto-drawings, Element Capture recording; #26
  corrective-retry wire shape; #27 imagery→drawable-layout routing. All merged
  with the live `ai_generations` ledger confirming successful map+scenes runs.

## Blockers

- None for merging PR #28 once CI is green.

## Required User Actions (standing, not new)

- Add `PEXELS_API_KEY` (free) and/or `OPENAI_API_KEY` (paid, capped by
  `CAPTIVATE_IMAGE_BUDGET_USD` / `CAPTIVATE_IMAGE_DAILY_MAX`) in Vercel to
  light up cover photographs and the photo dress pass. Without keys, decks
  get staged drawings and covers degrade to title slides.
- Vercel project access for the agent integration still returns 403; logs are
  read through the owner when needed.

## Recommended Next Steps

1. Merge PR #28 on green CI (agent-owned) and let Vercel deploy.
2. Owner: generate a fresh deck on the live app and judge the cover, the
   writing, the aside dives, and the drawing count against the brief.
3. Owner: add the image-provider keys above to see the full cover experience.
