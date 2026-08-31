-- ---------------------------------------------------------------------------
-- Billing: who pays, and what that entitles them to.
--
-- Three tables and one deliberate absence. `subscriptions` mirrors Stripe's
-- truth so an entitlement check is a cheap local read rather than a network
-- call in front of every AI generation — a design that also means Captivate
-- keeps working when Stripe does not.
--
-- The absence is the security story: there is no insert, update or delete
-- policy on any of these tables, for anybody. A user who can write their own
-- subscription row grants themselves Pro, so the schema simply never offers
-- the verb. The webhook writes through the service-role client, which bypasses
-- RLS, and it is the only writer.
-- ---------------------------------------------------------------------------

create table if not exists public.billing_customers (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at         timestamptz not null default now()
);

alter table public.billing_customers enable row level security;

create policy "billing_customers_select_own" on public.billing_customers
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- `current_period_end` is nullable on purpose.
--
-- Recent Stripe API versions removed the period from the Subscription object
-- and moved it onto the subscription *item*. A shape we cannot read must never
-- be written as a bogus timestamp, because a period end in the past would
-- downgrade somebody who has just paid. Null means "trust the status".
--
-- `billing_interval` is spelled out because `interval` is a Postgres type name
-- and a column called that needs quoting at every call site.
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  stripe_subscription_id text not null unique,
  status                 text not null,
  price_id               text not null,
  billing_interval       text not null check (billing_interval in ('month', 'year')),
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  -- The `created` of the Stripe event this row was last written from. Stripe
  -- does not guarantee delivery order, so a write only lands when it is newer
  -- than this; without it a late `deleted` arriving after a re-subscribe would
  -- strand a paying customer on Free.
  updated_from_event_at  timestamptz not null,
  updated_at             timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "subscriptions_select_own" on public.subscriptions
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Delivered webhook events, for idempotency. Stripe retries, and a retry must
-- not double-apply. No policies at all: nothing but the service role reads or
-- writes this.
-- ---------------------------------------------------------------------------
create table if not exists public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
