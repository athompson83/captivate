# Progress

## Current State

- Product: Captivate
- Lifecycle stage: Beta / production-readiness
- Control-graph node: HOSTED_RUNTIME_VERIFICATION (live app in owner-driven test loop)
- Current milestone: Ship the front door, the deck export, and generation grounded in the author's own material
- Branch: `claude/premium-ui-presentation-akzjzs` → PR #33, open
- `main`: PRs #22–#32 merged and deployed via Vercel auto-deploy
- Brand: Captivate is the product; Axtevi is the company it sits under
  (`captivate.axtevi.com`). No domain is hardcoded — redirects build from
  `NEXT_PUBLIC_SITE_URL`.
- Production: live and in use at `https://www.axtevi.com`; the owner tests
  deployed builds and reports defects
- Database: canonical Supabase project `qnbwyymwhvqprjtyfdmb`. Migrations
  `0017_billing.sql`, `0018_allowance_accounting.sql` and
  `0019_plan_grants.sql` are **applied to production**.

## Latest Session

### Shipped to `main` — PR #32, "Make a generation fail as an error the author can read"

Three separate faults behind one owner report, each confirmed against the live
`ai_generations` ledger rather than guessed at.

1. **The bare 504.** `/api/ai/map` ran with a 60-second platform ceiling while
   its model call was built with a 180-second timeout and two SDK retries, so
   the client's own timeout could never fire — Vercel killed the function
   first. Every generation now states a per-attempt budget sized to the route
   that runs it; the map route runs at the 300-second ceiling; the SDK retries
   once, not twice. A source-level test asserts each budget fits twice inside
   its own route's `maxDuration`.
2. **"The model's answer didn't match the required shape."** The map was
   generated with a 4000-token ceiling while successful maps recorded 4820 and
   5543 output tokens — two-attempt totals, so the first attempt had been
   truncated every time. Nothing inspected `stop_reason`. A truncated answer
   now says it was cut off and stops, and the ceiling is 10000.
3. **"You've used 10 AI generations."** The create route's pre-filter counted
   `map` rows against the _deck_ budget, so every draft argument on `/new`
   spent one of the ten presentations Free is sold — while settings, counting
   `scenes`, still read three of ten. `BUDGET_KINDS` now makes a group own the
   kinds that draw on it, and routes name only their group.

Alongside: `captivate_count_generations` is the single definition of what
counts. A reservation abandoned by a killed function stops holding its place
after fifteen minutes, and a call that never reached the model is not spend. A
near-miss or a truncated answer still counts, which is why failures now carry
their usage.

### In review — PR #33, five commits

- **The landing page runs the thesis.** A WebGL camera flying over one canvas
  of placed scenes, with the flight arithmetic in a tested module, a CSS
  fallback kept whole, a wide-shot for reduced motion, and a marketing palette
  the app's own tested tokens are untouched by. The container caps at a share
  of the viewport rather than a fixed number, so a widescreen is used.
- **Granted plans.** `plan_grants` — who, which plan, why, until when — checked
  before the subscription, with the same select-own-and-nothing-else posture as
  the billing tables. `unlimited` is the plan a grant may carry.
- **Deck export.** A `.pptx` both PowerPoint and Keynote open, built in the
  browser. Hotspots become slide links, charts stay editable data, drawings
  rasterise, notes travel — and anything that cannot survive is counted and
  shown _before_ the download.
- **Twelve themes and twelve templates**, with the curation bar written as
  tests: measured WCAG contrast on every theme, OKLab distinguishability
  between them, and no template repeating another's movement sequence.
- **Generation from a file the author already has.** A `.pptx`, `.docx`,
  Markdown or text file read in the browser and used to ground both the map and
  the scenes. Nothing is uploaded and nothing is stored.

### Verification

- `npm run verify` green: 953 unit/component tests across 70 files, typecheck,
  lint and build clean.
- `npm run test:rls` green against a real Postgres, including four assertions
  on what a reservation may cost an author and four on plan grants.
- 30 Playwright tests green in the server-free `lifecycle` project, including
  two new specs that need a real browser: one builds a `.pptx` and reads its
  parts back, one writes a ten-slide deck and reads the author's words out of
  it in the author's order.
- The landing page was rendered against a production build at 390, 2560 and
  3440 CSS pixels with no console errors.

## Blockers

- None.

## Standing owner actions

1. Set the Stripe account's public business name to **Axtevi** — it appears on
   card statements, receipts and the Billing Portal.
2. Confirm `STRIPE_WEBHOOK_SECRET` matches the mode of `STRIPE_SECRET_KEY`.
   Test and live endpoints have different secrets, and a mismatch fails every
   delivery while everything else looks correct.
3. Delete the two disposable `webhook-probe@example.com` Stripe customers left
   by the end-to-end proof (tagged `delete_me`).

`PEXELS_API_KEY` and `OPENAI_API_KEY` are configured, so cover photographs and
the photo dress pass are live.

## Recommended Next Steps

1. Merge PR #33 on green CI and let Vercel deploy.
2. Confirm on the deployed build that a generation grounded in an attached deck
   produces the author's argument rather than a talk about the topic.
3. `docs/ROADMAP.md` holds what has been asked for and not built: audience
   feedback (polls, trivia, Q&A), integrations with confidence monitors and
   Descript, keeping a reference file as stored evidence, and PDF reading.
