# Billing: Free and Captivate Pro — design

Captivate has no way to charge anyone, and every model call it makes costs the
deployment money. This spec adds a subscription: a free tier that is the whole
product with a bounded AI allowance, and **Captivate Pro** at $12/month or
$96/year that raises the ceiling and unlocks paid imagery.

## Decisions made with the owner

1. **Free plus one paid plan.** Not credits, not metered overage, not a
   lifetime purchase.
2. **$12/month, $96/year**, USD.
3. **AI volume and AI imagery are what Pro buys.** Not deck count, not
   features. Nothing a person authored is ever locked.
4. **No trial.** The free tier is the trial; a card is only ever asked for by
   someone who has already decided.
5. **Stripe-hosted Checkout and Billing Portal**, with a webhook mirroring
   subscription state into Supabase and every entitlement check reading that
   mirror.

## The rule this design exists to hold

**A lapsed subscription never takes anything away.** Every deck, asset,
recording and share link a person made stays editable, presentable and
exportable forever. Downgrading limits *future model calls* and nothing else.
This is `AGENTS.md`'s "an unbuilt feature is absent, not disabled" applied to
money: holding a user's own work hostage is the one thing a billing system
must not do.

## What the plans are

| | Free | Pro |
| --- | --- | --- |
| Editor, world canvas, present, record, share, export | everything | everything |
| Presentations generated | 10 per 30 days | 30 per hour |
| Narrative maps | 20 per 30 days | 30 per hour |
| Staged drawings | 20 per 30 days | 30 per hour |
| Text tools (rewrite, notes, moment) | 50 per 30 days | 200 per hour |
| Stock cover photography | yes | yes |
| AI image generation | no | yes, within the deployment budget |

### Why the free allowance is counted in presentations

Generating one deck is already several model calls: a map, a scenes pass, and
two to six drawings. "Ten AI generations a month" counted per call would give a
free user *one* presentation and read as a bait-and-switch. So the headline
allowance counts the unit a person actually recognises — a generated
presentation, one `scenes` row — and the other kinds carry their own bounded
sub-budgets so no account can run up unbounded spend through a side door.

### The window is rolling, and the copy must say so

The existing limiter counts rows in a rolling window, so "per 30 days" means
the last 30 days, not a calendar month that resets on the 1st. Every string
shown to a user says *"in the last 30 days"*. A rolling window described as
monthly is a lie about billing, which is the worst kind of copy to get wrong.

## Data model

One migration, `0017_billing.sql`, three tables.

```sql
create table public.billing_customers (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique not null,
  created_at         timestamptz not null default now()
);

create table public.subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  stripe_subscription_id text unique not null,
  status                 text not null,
  price_id               text not null,
  interval               text not null,
  current_period_end     timestamptz not null,
  cancel_at_period_end   boolean not null default false,
  -- The `created` of the Stripe event this row was last written from.
  updated_from_event_at  timestamptz not null,
  updated_at             timestamptz not null default now()
);

create table public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);
```

### RLS, and the verb that is deliberately missing

Every table has RLS enabled. An owner may `select` their own
`billing_customers` and `subscriptions` row. **There is no `insert`, `update`
or `delete` policy on any of the three, for anybody.** The webhook writes
through the service-role client, which bypasses RLS and is the only writer.

This is the whole security story of the feature. A user who can write their own
`subscriptions` row grants themselves Pro; the schema does not offer the verb,
so there is no policy to get subtly wrong later. `stripe_events` has no read
policy either — nothing in the app needs to read it but the webhook.

## Entitlement

`src/lib/billing/plan.ts`, `server-only`:

```ts
export type Plan = "free" | "pro";
export async function currentPlan(): Promise<Plan>;
export function limitFor(plan: Plan, group: BudgetGroup): RateLimit;
export type BudgetGroup = "deck" | "map" | "drawing" | "light";
```

`currentPlan()` reads the mirror table for the signed-in user and returns
`"pro"` when the status is `active` or `trialing` **and** `current_period_end`
is in the future. Every other status, a missing row, or any error returns
`"free"` — it fails closed, because failing open on a read error is how a bug
becomes free Pro for everyone.

**One deliberate exception: `past_due` keeps Pro until the period genuinely
ends.** Stripe's dunning is still retrying the card. Cutting off a paying
customer mid-cycle over a temporarily declined payment is hostile, and the
period end is the honest boundary.

### Nothing new counts the spend

The plan changes exactly one value. `captivate_reserve_generation` already
counts and inserts under a per-user advisory lock, so the limit it enforces is
atomic against concurrent requests. Free is `{ windowMinutes: 43200, max: 10 }`
for the deck group; Pro is `{ windowMinutes: 60, max: 30 }`. The revenue
boundary inherits, for free, the concurrency guarantee that was built for the
spend boundary.

`guard()`'s third parameter changes from a `RateLimit` constant to a
`BudgetGroup`, and `guard` resolves the plan itself. `spend()` in
`src/lib/ai/service.ts` does the same, because the reservation — not the route
pre-filter — is the authoritative gate.

Image generation gets an explicit plan check in `generateImage`: free callers
are refused with "AI image generation is part of Captivate Pro" before any
budget is reserved. Stock search stays free for everyone — it costs the
deployment nothing and it is what makes a free deck look good enough to want
more of.

## Checkout, portal, webhook

Server actions in `src/lib/data/billing.ts` (`"use server"`, async exports
only — the file exports no constants, per the rule that a constant in a
`"use server"` file breaks every action in it at runtime):

- `startCheckout(interval)` takes only `"month" | "year"`. **The price id is
  never accepted from the client**; it is read from the environment on the
  server. A client that names its own price is a client that sets its own
  price. The session carries `client_reference_id` and `metadata.user_id`, and
  returns to `/settings?checkout=success|cancelled`.
- `openBillingPortal()` opens a portal session for the caller's own customer
  only, resolved from `billing_customers` by `auth.uid()` — never from an id
  in the request.

Both return `{ ok: true, data } | { ok: false, error }` like every other server
action here; the caller surfaces `error` in a toast.

`src/app/api/stripe/webhook/route.ts` runs on the Node runtime, reads the raw
body with `await request.text()`, and verifies the signature with
`stripe.webhooks.constructEvent`. **The endpoint is public and unauthenticated,
so the signature is the authentication**; a bad signature is a 400 and nothing
else happens.

Three properties the handler must have:

- **Idempotent.** The event id is inserted into `stripe_events` first; a unique
  violation means this delivery was already processed and the handler returns
  200 without touching anything. Stripe retries, and retries must not double-apply.
- **Order-independent.** Stripe does not guarantee delivery order. Every write
  carries the event's `created` timestamp and only lands when it is newer than
  the stored `updated_from_event_at`. Without this, a late `subscription.deleted`
  arriving after a re-subscribe strands a paying customer on Free.
- **Honest about failure.** 200 for handled and deliberately-ignored events;
  500 only when a write genuinely failed, so Stripe retries it.

Handled: `checkout.session.completed`,
`customer.subscription.created|updated|deleted`. `invoice.payment_failed` is
recorded but changes no state — the status arrives on the subscription event.

## Surfaces

- **`/settings`** gains a Billing section: the current plan, what it includes,
  usage in the last 30 days for free accounts ("6 of 10 presentations
  generated"), renewal or cancellation date for Pro, and one button — Upgrade,
  or Manage billing.
- **`/pricing`**, public: two cards, the table above, honest about what Free
  keeps forever.
- **The refusal becomes an offer.** The existing rate-limit message is
  plan-aware: a free user at their ceiling is told what they have used, when it
  frees up, and offered the upgrade — instead of being refused with a number
  they cannot interpret.

## Configuration

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`,
`STRIPE_PRICE_PRO_ANNUAL`. All server-only; none are committed. Redirect URLs
are built from the existing `NEXT_PUBLIC_SITE_URL`, so **no domain is
hardcoded** and moving to `captivate.axtevi.com` is a configuration change.

Stripe objects already created on the Captivate account
(`acct_1UAUw5LBp2folCbt`), the same shape in both modes, addressable by the
lookup keys `captivate_pro_monthly` and `captivate_pro_annual`:

| | Test | Live |
| --- | --- | --- |
| Product | `prod_VAqzWXqAes4R1I` | `prod_VAqz4UKFh4sOfT` |
| Monthly $12 | `price_1UAVHlLBp2folCbtHJBXv7tR` | `price_1UAVIYLBp2folCbtKKjnkbx9` |
| Annual $96 | `price_1UAVHoLBp2folCbtHnyV85LJ` | `price_1UAVIdLBp2folCbtXOr9PO3o` |

Entitlement is derived from a price-id→plan map rather than assuming a single
product, so a second Axtevi product later needs no migration.

**Axtevi is the brand on the money.** The product is Captivate Pro; the Stripe
account's public business name, statement descriptor and Billing Portal
branding should read Axtevi, because that is what appears on a customer's card
statement and receipts. This is owner configuration in the Stripe dashboard,
not code.

### An unconfigured deployment does not gate

When `STRIPE_SECRET_KEY` is absent, `currentPlan()` returns `"pro"`. A
deployment that cannot charge must not throttle — this is the same principle as
the AI tools degrading rather than disappearing when no model is configured.
Two consequences that matter: merging this changes nothing about the running
app until keys are deliberately added, and a half-finished rollout cannot
accidentally throttle real users. The Billing section says billing is not
configured on this deployment rather than showing a dead Upgrade button.

## Non-goals

- No teams, seats, or shared workspaces.
- No usage-based or metered billing.
- No in-app card entry — Stripe's hosted pages own every card field.
- No coupons, referrals or promotion codes in this pass (Stripe can issue them
  against the Checkout session later without code changes).
- No tax registration or Stripe Tax configuration; that is an owner decision
  with legal consequences.
- No email receipts written by Captivate — Stripe sends them.

## Testing

- `currentPlan`: a table over every Stripe status × period-end combination;
  fails closed to free on a read error; returns pro when unconfigured;
  `past_due` before period end is pro and after it is free.
- `limitFor`: each plan and budget group maps to the intended window and max;
  a free deck budget is 10 per 30 days.
- Webhook: an invalid signature is rejected without a write; replaying an
  already-seen event id changes nothing and returns 200; an event older than
  the stored `updated_from_event_at` does not overwrite newer state;
  `subscription.deleted` lands the user on free.
- Server actions: `startCheckout` ignores any price supplied in its input;
  `openBillingPortal` resolves the customer from the session, never the request.
- RLS (`supabase/tests/rls_isolation.test.sql`): user A cannot read user B's
  subscription; **no authenticated role can update its own subscription row.**
- Component: the Billing section in free, pro, cancelling and unconfigured
  states; the plan-aware limit message.
- `npm run verify` green.

## Risks

- **The webhook is the only writer, so a missed delivery is a customer who paid
  and is not Pro.** Mitigated by Stripe's own retries plus idempotency, and by
  `checkout.session.completed` and `subscription.created` both being sufficient
  to establish the row. A manual reconciliation path — re-reading a customer's
  subscriptions from Stripe — is worth adding the first time it is needed, not
  before.
- **A rolling 30-day window is unfamiliar.** It is honest and needs no new
  machinery; the copy carries the explanation.
- **Test and live price ids differ.** The env var names are identical across
  environments, so the risk is deploying test prices to production. The Billing
  section shows which mode the deployment is in when the key is a test key.
