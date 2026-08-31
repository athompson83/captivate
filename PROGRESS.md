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
- Database target: canonical Captivate Supabase project (`qnbwyymwhvqprjtyfdmb`).
  `0017_billing.sql` is **applied to production**; the three billing tables exist
  with RLS on and no write policy for any role.

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

- None. Billing is configured and enforcing.

## Billing rollout status

Live at `https://www.axtevi.com`. Done:

- Vercel env vars added and deployed — an unsigned POST to
  `/api/stripe/webhook` returns 400 (signature verification running), not the
  503 it returned while unconfigured.
- `0017_billing.sql` applied to production.
- Webhook endpoints registered in both Stripe modes at
  `https://www.axtevi.com/api/stripe/webhook`. Both were missing
  `customer.subscription.updated` — the event carrying cancellation,
  plan change, renewal and `past_due` — and both have been corrected.

Still owner-side:

1. Set the Stripe account's public business name to **Axtevi** — that is what
   appears on card statements, receipts and the Billing Portal, with Captivate
   Pro as the product on them.
2. Confirm `STRIPE_WEBHOOK_SECRET` is the signing secret of the endpoint
   matching the mode of `STRIPE_SECRET_KEY`. Test and live endpoints have
   different secrets; a mismatch makes every delivery fail signature
   verification while everything else looks correct.
3. Prove the loop in test mode: upgrade, confirm settings flips to Pro, cancel
   from the portal, confirm it reads "ends" and Pro holds to the period end.

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
