# Progress

## Current State

- Product: Captivate
- Lifecycle stage: Beta / production-readiness
- Control-graph node: HOSTED_RUNTIME_VERIFICATION (live app in owner-driven test loop)
- Current milestone: Billing — Free and Captivate Pro on Stripe
- Branch: `claude/premium-ui-presentation-akzjzs` (billing work, PR pending)
- `main`: `b667017` — PRs #22–#28 merged and deployed via Vercel auto-deploy
- Brand: Captivate is the product; Axtevi is the company it will sit under
  (`captivate.axtevi.com`). No domain is hardcoded — redirects build from
  `NEXT_PUBLIC_SITE_URL`.
- Production: live and in use; the owner tests deployed builds and reports defects
- Database target: canonical Captivate Supabase project; migration `0017_billing.sql`
  is written and tested locally but **not yet applied to production**

## Latest Session

### Objective

Sell the product: a Free tier with a bounded AI allowance and a paid Captivate
Pro plan at $12/month or $96/year, through Stripe-hosted Checkout with
subscription state mirrored into Supabase.

### Completed (billing)

- **Schema**: `0017_billing.sql` adds `billing_customers`, `subscriptions` and
  `stripe_events`. No insert, update or delete policy on any of them, for
  anybody — the webhook writes through the service role and is the only writer.
  Five RLS assertions prove a user can neither forge nor edit their own
  entitlement.
- **Entitlement**: `currentPlan()` reads the mirror table, fails closed to
  Free, graces `past_due` until the period ends, and returns Pro when no Stripe
  key is configured — a deployment that cannot charge must not throttle.
- **The gate**: `guard` and `spend` now take a budget group and ask the plan
  how much is allowed, so the revenue boundary rides the reservation function
  that already counts and inserts under a per-user lock.
- **Checkout, portal, webhook**: price ids never come from the client; the
  portal resolves the customer from the session; the webhook is idempotent on
  the event id and refuses out-of-order events.
- **Surfaces**: a Billing section in settings, a public `/pricing` page built
  from the enforced budgets, and plan-aware refusal copy.

Stripe objects exist on the Captivate account (`acct_1UAUw5LBp2folCbt`) in both
test and live mode, under the lookup keys `captivate_pro_monthly` and
`captivate_pro_annual`.

### Previous objective

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

- `npm run verify` green: 853 unit/component tests across 65 files, build clean.
- `npm run test:rls` green against a real Postgres, including the five new
  billing isolation assertions.
- New coverage: `tests/unit/cover-scene.test.tsx`, `tests/unit/weave-asides.test.ts`,
  extended `place-drawing`, `present`, `narrative-map` suites.

### Earlier in this stabilization cycle (already on `main`)

- PR #22 drawn pictures; #23 sign-in read retry; #24 Claude 5 sampling-param
  removal; #25 rail inset, auto-drawings, Element Capture recording; #26
  corrective-retry wire shape; #27 imagery→drawable-layout routing. All merged
  with the live `ai_generations` ledger confirming successful map+scenes runs.

## Blockers

- None in code. Billing enforces nothing until the owner actions below are
  done, which is deliberate: a deployment that cannot charge must not throttle.

## Required User Actions

**Billing is inert until these are done — merging changes nothing.**

1. Add to Vercel: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`, and
   `SUPABASE_SERVICE_ROLE_KEY` (the webhook is the only writer of subscription
   state, so it needs elevated access).
2. Apply `supabase/migrations/0017_billing.sql` to the production database.
3. Register the webhook endpoint at `https://<site>/api/stripe/webhook` for
   `checkout.session.completed` and
   `customer.subscription.created|updated|deleted`, then copy its signing
   secret into `STRIPE_WEBHOOK_SECRET`.
4. Set the Stripe account's public business name to **Axtevi** — that is what
   appears on card statements, receipts and the Billing Portal, with Captivate
   Pro as the product on them.

## Standing user actions (not new)

- Add `PEXELS_API_KEY` (free) and/or `OPENAI_API_KEY` (paid, capped by
  `CAPTIVATE_IMAGE_BUDGET_USD` / `CAPTIVATE_IMAGE_DAILY_MAX`) in Vercel to
  light up cover photographs and the photo dress pass. Without keys, decks
  get staged drawings and covers degrade to title slides.
- Vercel project access for the agent integration still returns 403; logs are
  read through the owner when needed.

## Recommended Next Steps

1. Merge the billing PR on green CI (agent-owned) and let Vercel deploy. It is
   inert until the owner actions above are done.
2. Owner: apply the migration, add the Stripe env vars, register the webhook,
   and set the Stripe business name to Axtevi.
3. Then prove the loop end to end in test mode: upgrade, confirm the settings
   section flips to Pro, cancel from the portal, confirm it reads "ends" and
   the plan holds until the period end.
4. Owner: add the image-provider keys to see the full cover experience.
