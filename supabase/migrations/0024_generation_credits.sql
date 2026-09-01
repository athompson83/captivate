-- ---------------------------------------------------------------------------
-- Buying more presentations when the month's allowance is gone.
--
-- The allowance is a rolling 30-day count of ledger rows, which is what makes
-- it exact and self-healing: nothing to reset, nothing to reconcile, and a call
-- that never reached the model simply stops counting. A credit cannot be
-- another count. It is a thing somebody paid for, so it has to survive until it
-- is used, and using it has to be as atomic as the reservation it is topping
-- up.
--
-- A credit buys a **presentation**, not a row in one table.
--
-- That distinction is the whole design. Generating a presentation is a map
-- call, a scenes call and a staged drawing for every ten minutes of talk — up
-- to ten of them where there is no photo provider and drawings are the only
-- pictures there are. A credit that replenished the deck counter alone would
-- sell somebody ten presentations they could not illustrate, and refuse them
-- at the drawing pool with a balance still showing. So one credit raises
-- *every* pool by what one presentation can take from it, and is spent once,
-- when a deck is actually generated.
-- ---------------------------------------------------------------------------

create table if not exists public.generation_credits (
  id                         uuid        primary key default gen_random_uuid(),
  user_id                    uuid        not null references auth.users (id) on delete cascade,
  -- What was bought, and the only quantity stored. What is *left* is derived
  -- from the ledger rather than kept here — see `captivate_credit_spent`.
  presentations_granted      integer     not null check (presentations_granted > 0),
  -- The Checkout Session that paid for it. Unique, and it is the idempotency
  -- key for the whole flow: a webhook retry, or two deliveries of one event
  -- racing, grants the credit exactly once because the second insert violates
  -- this rather than adding a second balance.
  stripe_checkout_session_id text        not null unique,
  stripe_payment_intent_id   text,
  -- Which event granted it, kept for provenance: reconciling a disputed
  -- balance against Stripe starts here.
  stripe_event_id            text        not null,
  purchased_at               timestamptz not null default now(),
  -- Credits are usable for a stated period and the copy says so. A balance
  -- that never expires is a liability carried forever against a price paid
  -- once.
  expires_at                 timestamptz not null,
  -- Refunded, disputed or charged back. Kept rather than deleted, so the
  -- history of a balance is still readable after it is withdrawn.
  revoked_at                 timestamptz,
  revoked_reason             text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

-- The lookup the reservation makes on every refused call: this user's live
-- balances, soonest to expire first.
create index if not exists generation_credits_live_idx
  on public.generation_credits (user_id, expires_at)
  where revoked_at is null;

alter table public.generation_credits enable row level security;

-- Readable by its owner and writable by nobody. The balance is bought, not
-- edited: an update policy here would let an author set their own remaining
-- count, and an insert policy would let them mint the whole thing. The webhook
-- writes with the service role, and the reservation spends as definer.
create policy "generation_credits_select_own" on public.generation_credits
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Which credit a generation was made on.
--
-- This link *is* the balance. A stored remainder, decremented on reservation
-- and incremented back when a call turned out never to have reached the model,
-- looked simpler and was wrong: settling is done by the caller under their own
-- JWT, and 0020's supersession rule deliberately lets a row still pending — or
-- failed with no tokens — be written again. So an author could settle their own
-- pending row as a zero-token failure, take the refund, spend it on a second
-- reservation, and let the truthful settlement land afterwards. One purchase,
-- two presentations, and repeatable.
--
-- Counting instead of remembering removes the window rather than narrowing it.
-- The refund is not an event that can be forged out of order: a row that does
-- not count is not subtracted, and the moment the truth lands it counts again.
-- It is the same property that makes the rolling allowance exact, applied to
-- the thing somebody actually paid for.
-- ---------------------------------------------------------------------------
alter table public.ai_generations
  add column if not exists credit_id uuid references public.generation_credits (id) on delete set null;

-- What a credit has been spent on is now a question asked of this column on
-- every reservation, so it is worth an index.
create index if not exists ai_generations_credit_idx
  on public.ai_generations (credit_id)
  where credit_id is not null;

-- ---------------------------------------------------------------------------
-- How much of one purchase has been used.
--
-- Counted exactly the way `captivate_count_generations` counts an allowance,
-- and for the same reason: a reservation that never reached the model must not
-- cost the author anything, and an abandoned one must not hold a credit
-- hostage. The difference is that this is not windowed — a presentation made
-- on a credit forty days ago still used it.
--
-- Published to nobody. It takes a credit id, and a credit id is a thing
-- somebody else can name; the callers below are definer functions that have
-- already scoped their rows to `auth.uid()`.
-- ---------------------------------------------------------------------------
create or replace function public.captivate_credit_spent(p_credit uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
    from public.ai_generations g
   where g.credit_id = p_credit
     -- A fresh row counts whatever the caller says about it.
     --
     -- This is the whole defence, and it took two attempts to find. Settling
     -- runs under the author's own JWT, so "this call failed and produced
     -- nothing" is a sentence the author can write about their own in-flight
     -- reservation. Freeing the credit the moment they say it does not just
     -- allow one race: it makes the credit reusable for the entire length of a
     -- provider call. Reserve, forge the failure, reserve again — each one a
     -- real generation, none of them yet settled, all on a single purchase,
     -- bounded only by the burst ceiling.
     --
     -- So the refund waits out the same window an abandoned reservation waits
     -- out. Inside it, nothing the caller writes can free the credit. Outside
     -- it, the truth has long since arrived — no route may run longer than the
     -- platform's five-minute ceiling — so a row still claiming to be a
     -- zero-token failure at fifteen minutes really is one, and giving the
     -- credit back is right. An author whose generation genuinely failed waits
     -- a quarter of an hour for their credit. That is the price of the author
     -- not being able to mint them.
     and (g.created_at >= now() - interval '15 minutes'
          or not (g.status = 'failed' and coalesce(g.output_tokens, 0) = 0));
$$;

revoke all on function public.captivate_credit_spent(uuid) from public;
revoke all on function public.captivate_credit_spent(uuid) from anon;
revoke all on function public.captivate_credit_spent(uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- What is left to spend, for the settings page.
--
-- Expired and revoked balances are not "left". Scoped to the caller with no
-- argument, because a user id in an argument is a user id somebody else can
-- name.
--
-- Floored at zero per purchase. A balance cannot go below what was bought, but
-- the count it is derived from can briefly exceed it — a reservation is made
-- against a live credit and the row it inserted is what marks the credit spent,
-- so two simultaneous reservations serialised on the same lock cannot both take
-- the last one, but a settlement arriving late can still make a row start
-- counting after the fact. Showing a negative number to somebody looking at
-- what they have left would be worse than showing none.
-- ---------------------------------------------------------------------------
create or replace function public.captivate_credit_balance()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
           sum(greatest(c.presentations_granted - public.captivate_credit_spent(c.id), 0)),
           0)::integer
    from public.generation_credits c
   where c.user_id = auth.uid()
     and auth.uid() is not null
     and c.revoked_at is null
     and c.expires_at > now();
$$;

revoke all on function public.captivate_credit_balance() from public;
revoke all on function public.captivate_credit_balance() from anon;
grant execute on function public.captivate_credit_balance() to authenticated;

-- ---------------------------------------------------------------------------
-- How much of a pool one presentation can take.
--
-- The same numbers as `PER_PRESENTATION` in `src/lib/billing/plans.ts`, and
-- `plan-budget-parity` asserts they match. This is what turns a credit into a
-- presentation rather than a deck counter: a credit raises the deck pool by
-- one, the draft pool by two, and the drawing and light pools by ten each,
-- because that is what generating one presentation can actually consume.
-- ---------------------------------------------------------------------------
create or replace function public.captivate_per_presentation(p_group text)
returns integer
language sql
immutable
as $$
  select case p_group
    when 'deck'    then 1
    when 'draft'   then 2
    when 'drawing' then 10
    when 'light'   then 10
  end;
$$;

revoke all on function public.captivate_per_presentation(text) from public;
revoke all on function public.captivate_per_presentation(text) from anon;
grant execute on function public.captivate_per_presentation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The reservation, aware that an allowance can be topped up.
--
-- Dropped rather than replaced: `create or replace` with a different return
-- type is an error, and one with a different argument list would leave the old
-- signature callable.
-- ---------------------------------------------------------------------------
drop function if exists public.captivate_reserve_generation(text, text, text, uuid);

create or replace function public.captivate_reserve_generation(
  p_kind            text,
  p_group           text,
  p_prompt          text,
  p_presentation_id uuid
)
returns table(id uuid, refusal text, limit_max integer, limit_minutes integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
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
  v_credits integer;
  v_headroom integer;
  v_credit  uuid;
  v_used  integer;
  v_base_used integer;
  v_id    uuid;
begin
  if v_user is null then
    return query select null::uuid, 'signed-out'::text, null::integer, null::integer;
    return;
  end if;

  v_kinds := public.captivate_budget_kinds(p_group);
  if v_kinds is null or not (p_kind = any(v_kinds)) then
    return query select null::uuid, 'misconfigured'::text, null::integer, null::integer;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('captivate_ai:' || v_user::text));

  v_plan := public.captivate_current_plan();

  select b.allowance_minutes, b.allowance_max, b.burst_minutes, b.burst_max
    into v_allowance_minutes, v_allowance_max, v_burst_minutes, v_burst_max
    from public.plan_budgets b
   where b.plan = v_plan
     and b.budget_group = p_group;

  if v_allowance_max is null then
    return query select null::uuid, 'misconfigured'::text, null::integer, null::integer;
    return;
  end if;

  if v_presentation is not null and not public.captivate_owns_presentation(v_presentation) then
    v_presentation := null;
  end if;

  -- The burst ceiling first: it is the shorter window, and refusing on it tells
  -- the author to wait an hour rather than a month. Credits do not raise it —
  -- it is abuse protection rather than something bought, and a top-up is for
  -- the month somebody went over, not a way to run a script faster.
  v_used := public.captivate_count_generations(v_kinds, v_burst_minutes);
  if v_used >= v_burst_max then
    return query select null::uuid, 'burst'::text, v_burst_max, v_burst_minutes;
    return;
  end if;

  -- What was *bought* and is still live, not what is left of it.
  --
  -- Spending a credit both uses up a unit of the purchase and adds a row to the
  -- count, so a ceiling keyed on the remaining balance closes from both ends and
  -- strands half of it: ten credits bought five presentations and then refused,
  -- with five still showing. What an author is entitled to is their allowance
  -- plus everything they paid for.
  -- Counted from the credit-backed presentations that were *admitted*, not from
  -- the purchases that are still live.
  --
  -- These pools are not spent from; they are raised so that a presentation the
  -- author already paid for can be finished. Keying that on the purchase's
  -- liveness breaks it at the boundary: a deck admitted on a credit an hour
  -- before expiry outlives the credit by minutes, and its drawings are then
  -- refused with the deck already made and the money already gone. Keying it on
  -- the decks themselves means the headroom arrives exactly when there is a
  -- presentation that needs it and lasts exactly as long as that presentation
  -- is inside the rolling window it is counted in.
  select count(*)::integer
    into v_credits
    from public.ai_generations g
   where g.owner_id = v_user
     and g.credit_id is not null
     and g.kind = any(public.captivate_budget_kinds('deck'))
     and g.created_at >= now() - make_interval(mins => v_allowance_minutes)
     and (g.status <> 'pending' or g.created_at >= now() - interval '15 minutes')
     and not (g.status = 'failed' and coalesce(g.output_tokens, 0) = 0);

  -- One credit is worth one presentation, which is worth this much of *this*
  -- pool. So ten credits raise the deck ceiling by ten and the drawing ceiling
  -- by a hundred — enough to illustrate all ten.
  --
  -- Coalesced, because a null here is not a smaller ceiling — it is *no*
  -- ceiling: `v_used >= null` is null, the allowance branch is skipped, and the
  -- reservation is granted unbounded. `captivate_budget_kinds` rejects an
  -- unknown group before this today, so it is unreachable; it becomes reachable
  -- the moment a group is added there and not here, which is a two-line change
  -- with no other symptom. The parity test asserts both have every arm.
  v_headroom :=
    v_allowance_max + v_credits * coalesce(public.captivate_per_presentation(p_group), 0);

  v_used := public.captivate_count_generations(v_kinds, v_allowance_minutes);

  if p_group = 'deck' then
    -- A deck is the one call a credit is spent on, so it is the one place the
    -- two kinds of usage have to be told apart. `v_used` counts every deck in
    -- the window, credit-backed ones included, and asking whether *that* has
    -- reached the plan's allowance conflates them: an author who bought ten
    -- credits and spent them is at 35 of a 25 allowance, so when their oldest
    -- base-allowance deck ages out of the rolling window the slot it freed is
    -- invisible — the count is still 34, still over 25, so a credit is looked
    -- for, and there are none left. A renewed allowance, refused.
    --
    -- What the plan grants is measured against what was drawn from the plan.
    select count(*)::integer
      into v_base_used
      from public.ai_generations g
     where g.owner_id = v_user
       and g.kind = any(v_kinds)
       and g.credit_id is null
       and g.created_at >= now() - make_interval(mins => v_allowance_minutes)
       and (g.status <> 'pending' or g.created_at >= now() - interval '15 minutes')
       and not (g.status = 'failed' and coalesce(g.output_tokens, 0) = 0);

    if v_base_used >= v_allowance_max then
      -- Past the plan's own allowance, so this one is bought. Soonest to expire
      -- first, so a balance is not stranded by spending a later purchase ahead
      -- of an earlier one.
      select c.id
        into v_credit
        from public.generation_credits c
       where c.user_id = v_user
         and c.revoked_at is null
         and c.expires_at > now()
         and c.presentations_granted > public.captivate_credit_spent(c.id)
       order by c.expires_at, c.purchased_at
       limit 1;

      if v_credit is null then
        -- The refusal names the allowance, not the topped-up figure: what the
        -- author needs to know is what their plan gives them, and the credits
        -- are reported separately in settings.
        return query select null::uuid, 'allowance'::text, v_allowance_max, v_allowance_minutes;
        return;
      end if;
    end if;

  elsif v_used >= v_headroom then
    -- The other pools are not spent from, they are *raised*: the drawings and
    -- rewrites that dress a bought presentation are what make it finishable, and
    -- they are already paid for by the credit the deck spent. So there is
    -- nothing to debit here, only a taller ceiling for as long as the credit is
    -- live.
    return query select null::uuid, 'allowance'::text, v_allowance_max, v_allowance_minutes;
    return;
  end if;

  -- The inserted row *is* the debit. Nothing decrements a stored balance,
  -- which is what makes the spend and the record of it the same write and so
  -- impossible to get out of step.
  insert into public.ai_generations
    (owner_id, presentation_id, kind, prompt, status, credit_id)
  values
    (v_user, v_presentation, p_kind, left(coalesce(p_prompt, ''), 4000), 'pending', v_credit)
  returning public.ai_generations.id into v_id;

  return query select v_id, null::text, v_allowance_max, v_allowance_minutes;
end;
$function$;

revoke all on function public.captivate_reserve_generation(text, text, text, uuid) from public;
revoke all on function public.captivate_reserve_generation(text, text, text, uuid) from anon;
grant execute on function public.captivate_reserve_generation(text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Settling needs no credit bookkeeping, and that is the point.
--
-- `captivate_complete_generation` is unchanged by this migration. It writes the
-- outcome of a call, and the outcome is the whole of the accounting: a row that
-- counts has used a credit and a row that does not has not. There is no refund
-- to perform, nothing to reconcile, and no ordering between the settlement and
-- a balance for a caller to get between.
-- ---------------------------------------------------------------------------
