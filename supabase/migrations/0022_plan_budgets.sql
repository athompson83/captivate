-- ---------------------------------------------------------------------------
-- The allowance is not the caller's to name either.
--
-- 0021 moved the image ceilings into the database because the function took
-- them as arguments, and PostgREST exposes these functions to `authenticated`
-- — so nothing on the wire distinguishes the server's call from the same RPC
-- issued straight from a browser. `captivate_reserve_generation` had exactly
-- the same shape and was left alone:
--
--   rpc/captivate_reserve_generation
--   { "p_window_minutes": 43200, "p_max": 999999, ... }
--
-- reserves a generation against a ceiling the caller invented. The plan gate
-- above it is then decoration.
--
-- There was a second hole beside it. A paid plan has two ceilings — a rolling
-- 30-day allowance and an hourly burst — and only the allowance was inside the
-- locked statement; the burst was a separate application read, which is a
-- read anybody can simply not perform. Both now happen in one transaction,
-- under the lock this function already took.
--
-- Closing either means the database has to know the plan, so this migration
-- gives it the two things it was missing: the tier a subscription resolved to,
-- stored beside the price it was resolved from, and a table of what each plan
-- allows.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The tier, stored rather than re-derived.
--
-- `price_id` alone is not enough. A Stripe price is immutable, so changing
-- what a tier costs means a new price and a rotated environment variable — and
-- from that moment the old price resolves to nothing and its holder silently
-- becomes the lowest paid tier. Resolving once, at the moment the webhook
-- writes the row, and keeping the answer is what makes an existing
-- subscription independent of configuration it was never party to.
--
-- Null for rows written before this column existed. `planFromSubscription`
-- reads null as Basic — the lowest paid tier — because guessing upward hands
-- somebody Pro for Basic's money on a stale variable.
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists plan text
  check (plan is null or plan in ('basic', 'pro'));

comment on column public.subscriptions.plan is
  'The tier this subscription grants, resolved from price_id when the webhook wrote the row. Stored so a rotated or retired price cannot change what somebody already bought.';

-- Every row that predates the column is Pro, because Pro is what it was.
--
-- Without this the column is null for every existing subscriber, and
-- `captivate_current_plan` reads null as Basic — the lowest paid tier, which is
-- the right guess for an *unrecognised* price and exactly the wrong one here.
-- Until this migration there was only one thing to buy, and it was Pro. So the
-- moment it applied, every active subscriber would have been moved to a smaller
-- allowance than the one they were paying for, silently, until some later
-- Stripe event happened to rewrite their row.
--
-- Deliberately not conditional on `price_id` matching a configured variable:
-- the environment may already name the new prices, and a subscriber bought
-- their tier from the product, not from configuration.
update public.subscriptions
   set plan = 'pro'
 where plan is null;

-- ---------------------------------------------------------------------------
-- What each plan allows, in the database that enforces it.
--
-- Mirrors `src/lib/billing/plans.ts`, which is the source the pricing page and
-- the settings meter read. Two copies of a number is a drift risk, so
-- `tests/unit/plan-budget-parity.test.ts` parses this file and asserts every
-- row matches — a migration that says something different from the product is
-- a migration that refuses calls the product told the author it would allow.
--
-- No policies, on the same grounds as `ai_image_limits`: these are the
-- deployment's ceilings, not any user's. A select policy for `authenticated`
-- would hand every user the numbers this table exists to stop them choosing.
-- ---------------------------------------------------------------------------
create table if not exists public.plan_budgets (
  plan               text    not null check (plan in ('free', 'basic', 'pro', 'unlimited')),
  budget_group       text    not null check (budget_group in ('deck', 'draft', 'drawing', 'light')),
  -- The rolling allowance: what was bought, what drains, what a top-up adds to.
  allowance_minutes  integer not null check (allowance_minutes > 0),
  allowance_max      integer not null check (allowance_max > 0),
  -- Abuse protection. Not a product promise and not purchasable.
  burst_minutes      integer not null check (burst_minutes > 0),
  burst_max          integer not null check (burst_max > 0),
  primary key (plan, budget_group)
);

alter table public.plan_budgets enable row level security;

-- 10, 25 and 60 presentations in any rolling 30 days; 3, 10 and 20 an hour.
-- Every other figure is that number times what one presentation can consume:
-- one deck call, two drafts, ten staged drawings and ten light actions.
insert into public.plan_budgets (plan, budget_group, allowance_minutes, allowance_max, burst_minutes, burst_max)
values
  ('free',      'deck',    43200,    10, 60,    3),
  ('free',      'draft',   43200,    20, 60,    6),
  ('free',      'drawing', 43200,   100, 60,   30),
  ('free',      'light',   43200,   100, 60,   30),
  ('basic',     'deck',    43200,    25, 60,   10),
  ('basic',     'draft',   43200,    50, 60,   20),
  ('basic',     'drawing', 43200,   250, 60,  100),
  ('basic',     'light',   43200,   250, 60,  100),
  ('pro',       'deck',    43200,    60, 60,   20),
  ('pro',       'draft',   43200,   120, 60,   40),
  ('pro',       'drawing', 43200,   600, 60,  200),
  ('pro',       'light',   43200,   600, 60,  200),
  ('unlimited', 'deck',    43200,  2000, 60,  200),
  ('unlimited', 'draft',   43200,  4000, 60,  400),
  ('unlimited', 'drawing', 43200, 20000, 60, 2000),
  ('unlimited', 'light',   43200, 20000, 60, 2000)
on conflict (plan, budget_group) do update
  set allowance_minutes = excluded.allowance_minutes,
      allowance_max     = excluded.allowance_max,
      burst_minutes     = excluded.burst_minutes,
      burst_max         = excluded.burst_max;

-- ---------------------------------------------------------------------------
-- Which kinds each group counts.
--
-- The same one definition problem the application had: a group is a budget
-- *and* what draws on it, and when the two diverged, drafting an argument
-- spent a deck the author had not created.
-- ---------------------------------------------------------------------------
create or replace function public.captivate_budget_kinds(p_group text)
returns text[]
language sql
immutable
as $$
  select case p_group
    when 'deck'    then array['scenes', 'presentation']
    when 'draft'   then array['map', 'scene']
    when 'drawing' then array['drawing']
    when 'light'   then array['moment', 'rewrite', 'speaker_notes', 'visuals', 'flow']
  end;
$$;

-- ---------------------------------------------------------------------------
-- The caller's plan, decided here rather than passed in.
--
-- A grant outranks a subscription: somebody with both should get the better of
-- the two. Everything unrecognised is free, because failing open is how a bug
-- becomes free Pro for everybody.
-- ---------------------------------------------------------------------------
create or replace function public.captivate_current_plan()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_user uuid := auth.uid();
  v_plan text;
begin
  if v_user is null then
    return 'free';
  end if;

  select g.plan into v_plan
    from public.plan_grants g
   where g.user_id = v_user
     and (g.expires_at is null or g.expires_at > now());
  if v_plan is not null then
    return v_plan;
  end if;

  select case
           when s.status in ('active', 'trialing')
             then coalesce(s.plan, 'basic')
           when s.status = 'past_due'
                and (s.current_period_end is null or s.current_period_end > now())
             then coalesce(s.plan, 'basic')
           else 'free'
         end
    into v_plan
    from public.subscriptions s
   where s.user_id = v_user;

  return coalesce(v_plan, 'free');
end;
$$;

revoke all on function public.captivate_current_plan() from public, anon;
grant execute on function public.captivate_current_plan() to authenticated;

-- ---------------------------------------------------------------------------
-- The reservation, reading its own ceilings and enforcing both of them.
--
-- Dropped rather than replaced: `create or replace` with a different argument
-- list leaves the old signature in place and callable, which would close
-- nothing at all. 0021 learned this for the image reservation.
-- ---------------------------------------------------------------------------
drop function if exists public.captivate_reserve_generation(text, text[], text, uuid, integer, integer);

-- The caller now names *what kind of work this is* and nothing else. It cannot
-- name its ceiling, its window, or the group its kind counts against — those
-- were the three things it could previously choose for itself.
create or replace function public.captivate_reserve_generation(
  p_kind            text,
  p_group           text,
  p_prompt          text,
  p_presentation_id uuid
)
-- The refusal carries the ceiling that stopped it, so the message can name a
-- real number and a real window. "You have reached the limit" without saying
-- which limit tells an author nothing they can act on — and with two ceilings
-- in play it does not even say whether to wait an hour or a month.
returns table(id uuid, refusal text, limit_max integer, limit_minutes integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user  uuid := auth.uid();
  v_plan  text;
  v_kinds text[];
  v_presentation uuid := p_presentation_id;
  v_allowance_minutes integer;
  v_allowance_max     integer;
  v_burst_minutes     integer;
  v_burst_max         integer;
  v_used  integer;
  v_id    uuid;
begin
  -- Fail closed. No identity, no reservation, and so no spend.
  if v_user is null then
    return query select null::uuid, 'signed-out'::text, null::integer, null::integer;
    return;
  end if;

  v_kinds := public.captivate_budget_kinds(p_group);
  -- An unknown group, or a kind recorded against a budget it does not draw on.
  -- Both are the same mistake as the create route charging the deck budget for
  -- `map` rows, except chosen deliberately: without this, a caller records a
  -- deck generation as `light` and spends the cheapest allowance it has.
  if v_kinds is null or not (p_kind = any(v_kinds)) then
    return query select null::uuid, 'misconfigured'::text, null::integer, null::integer;
    return;
  end if;

  -- Serialise this user's reservations for the rest of the transaction. Two
  -- concurrent calls would otherwise both read a count below the limit and
  -- both insert; this is the whole point of the function, and it is why both
  -- ceilings are checked inside it rather than one of them in the application.
  perform pg_advisory_xact_lock(hashtext('captivate_ai:' || v_user::text));

  -- Inside the lock, like the image budget: a plan that changes while requests
  -- queue must bind the ones already waiting, or a downgrade is not a boundary.
  v_plan := public.captivate_current_plan();

  select b.allowance_minutes, b.allowance_max, b.burst_minutes, b.burst_max
    into v_allowance_minutes, v_allowance_max, v_burst_minutes, v_burst_max
    from public.plan_budgets b
   where b.plan = v_plan
     and b.budget_group = p_group;

  -- An unseeded table is a deployment that has not said what a plan allows.
  -- Guessing on its behalf is how a ceiling stops meaning anything.
  if v_allowance_max is null then
    return query select null::uuid, 'misconfigured'::text, null::integer, null::integer;
    return;
  end if;

  -- The function runs as definer, so RLS is not there to catch a caller who
  -- names a deck that is not theirs. Attribute the row to no deck rather than
  -- to someone else's.
  if v_presentation is not null and not public.captivate_owns_presentation(v_presentation) then
    v_presentation := null;
  end if;

  -- The burst ceiling first, because it is the shorter window and refusing on
  -- it tells the author to wait an hour rather than a month.
  v_used := public.captivate_count_generations(v_kinds, v_burst_minutes);
  if v_used >= v_burst_max then
    return query select null::uuid, 'burst'::text, v_burst_max, v_burst_minutes;
    return;
  end if;

  v_used := public.captivate_count_generations(v_kinds, v_allowance_minutes);
  if v_used >= v_allowance_max then
    return query select null::uuid, 'allowance'::text, v_allowance_max, v_allowance_minutes;
    return;
  end if;

  insert into public.ai_generations (owner_id, presentation_id, kind, prompt, status)
  values (v_user, v_presentation, p_kind, left(coalesce(p_prompt, ''), 4000), 'pending')
  returning public.ai_generations.id into v_id;

  return query select v_id, null::text, v_allowance_max, v_allowance_minutes;
end;
$function$;

-- `anon` by name as well as `public`: Supabase's default privileges grant
-- execute on new functions in this schema to `anon, authenticated`, and those
-- are grants to the role rather than to `public`, so revoking `public` alone
-- leaves a freshly created function callable without signing in.
revoke all on function public.captivate_reserve_generation(text, text, text, uuid) from public;
revoke all on function public.captivate_reserve_generation(text, text, text, uuid) from anon;
grant execute on function public.captivate_reserve_generation(text, text, text, uuid) to authenticated;

revoke all on function public.captivate_budget_kinds(text) from public;
revoke all on function public.captivate_budget_kinds(text) from anon;
grant execute on function public.captivate_budget_kinds(text) to authenticated;
