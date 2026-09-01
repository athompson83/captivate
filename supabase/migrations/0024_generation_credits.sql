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
  -- What was bought never changes, so "what did I actually pay for?" is
  -- answerable after the balance has been spent down.
  presentations_granted      integer     not null check (presentations_granted > 0),
  presentations_remaining    integer     not null check (presentations_remaining >= 0),
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
  updated_at                 timestamptz not null default now(),
  constraint generation_credits_remaining_within_granted
    check (presentations_remaining <= presentations_granted)
);

-- The lookup the reservation makes on every refused call: this user's live
-- balance, oldest first.
create index if not exists generation_credits_spendable_idx
  on public.generation_credits (user_id, expires_at)
  where presentations_remaining > 0 and revoked_at is null;

alter table public.generation_credits enable row level security;

-- Readable by its owner and writable by nobody. The balance is bought, not
-- edited: an update policy here would let an author set their own remaining
-- count, and an insert policy would let them mint the whole thing. The webhook
-- writes with the service role, and the reservation spends as definer.
create policy "generation_credits_select_own" on public.generation_credits
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Which credit a generation is holding.
--
-- The allowance gives itself back: a call that never reached the model stops
-- counting, so the author is not charged for our downtime. A credit decremented
-- at reservation time does not, so the same failure would cost real money. The
-- link is what lets the settlement put it back — and take it again if a later,
-- truthful settlement says the call did reach the model after all.
-- ---------------------------------------------------------------------------
alter table public.ai_generations
  add column if not exists credit_id uuid references public.generation_credits (id) on delete set null,
  -- True while this row is actually holding the credit. Distinct from
  -- `credit_id is not null`, because a refunded row keeps the link so the same
  -- credit is re-charged rather than an arbitrary one.
  add column if not exists credit_charged boolean not null default false;

-- ---------------------------------------------------------------------------
-- What is left to spend, for the settings page.
--
-- Expired and revoked balances are not "left". Scoped to the caller with no
-- argument, because a user id in an argument is a user id somebody else can
-- name.
-- ---------------------------------------------------------------------------
create or replace function public.captivate_credit_balance()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(c.presentations_remaining), 0)::integer
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
  -- Spending a credit both decrements the balance and adds a row to the count,
  -- so a ceiling keyed on the remaining balance closes from both ends and
  -- strands half the purchase: ten credits bought five presentations and then
  -- refused, with five still showing. What an author is entitled to is their
  -- allowance plus everything they paid for, and `presentations_remaining` is
  -- the record of how much of that they have taken — the two agree exactly,
  -- because one deck spends one credit and adds one to the count.
  select coalesce(sum(c.presentations_granted), 0)::integer
    into v_credits
    from public.generation_credits c
   where c.user_id = v_user
     and c.revoked_at is null
     and c.expires_at > now();

  -- One credit is worth one presentation, which is worth this much of *this*
  -- pool. So ten credits raise the deck ceiling by ten and the drawing ceiling
  -- by a hundred — enough to illustrate all ten.
  v_headroom := v_allowance_max + v_credits * public.captivate_per_presentation(p_group);

  v_used := public.captivate_count_generations(v_kinds, v_allowance_minutes);
  if v_used >= v_headroom then
    -- The refusal names the allowance, not the topped-up figure: what the
    -- author needs to know is what their plan gives them, and the credits are
    -- reported separately in settings.
    return query select null::uuid, 'allowance'::text, v_allowance_max, v_allowance_minutes;
    return;
  end if;

  -- Past the plan's own allowance, and only for a whole presentation: a credit
  -- is spent when a deck is generated, not on each of the calls that dress it.
  -- The extra headroom in the other pools is what makes that deck finishable,
  -- and it lasts exactly as long as the credit does.
  if v_used >= v_allowance_max and p_group = 'deck' then
    update public.generation_credits
       set presentations_remaining = presentations_remaining - 1,
           updated_at = now()
     where public.generation_credits.id = (
       select c.id
         from public.generation_credits c
        where c.user_id = v_user
          and c.presentations_remaining > 0
          and c.revoked_at is null
          and c.expires_at > now()
        -- Soonest to expire first, so a balance is not stranded by spending a
        -- later purchase ahead of an earlier one.
        order by c.expires_at, c.purchased_at
        limit 1
     )
    returning public.generation_credits.id into v_credit;

    -- The sum said there was one. If the update found nothing, something moved
    -- underneath us; refuse rather than admit the call for free.
    if v_credit is null then
      return query select null::uuid, 'allowance'::text, v_allowance_max, v_allowance_minutes;
      return;
    end if;
  end if;

  insert into public.ai_generations
    (owner_id, presentation_id, kind, prompt, status, credit_id, credit_charged)
  values
    (v_user, v_presentation, p_kind, left(coalesce(p_prompt, ''), 4000), 'pending',
     v_credit, v_credit is not null)
  returning public.ai_generations.id into v_id;

  return query select v_id, null::text, v_allowance_max, v_allowance_minutes;
end;
$function$;

revoke all on function public.captivate_reserve_generation(text, text, text, uuid) from public;
revoke all on function public.captivate_reserve_generation(text, text, text, uuid) from anon;
grant execute on function public.captivate_reserve_generation(text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Settling gives a credit back, and can take it again.
--
-- The allowance already behaves this way and nobody had to write it: a call
-- that never reached the model stops counting, so the author is not charged for
-- our downtime. A credit is a stored balance, so the same courtesy has to be
-- performed rather than derived.
--
-- Both directions, because 0020's supersession rule makes both reachable. A row
-- may be rewritten exactly while it is not counting — still pending, or failed
-- with no tokens — which is precisely the sequence: reserve, forge a refund,
-- and let the server write the truth a moment later. So the reconciliation is
-- stated as "does this row count now?" rather than as a one-way refund, and it
-- runs after every settlement.
-- ---------------------------------------------------------------------------
create or replace function public.captivate_complete_generation(
  p_id            uuid,
  p_status        text,
  p_model         text,
  p_input_tokens  integer,
  p_output_tokens integer,
  p_error         text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_rows integer;
  v_counts boolean;
  v_credit uuid;
  v_charged boolean;
begin
  if v_user is null then
    return false;
  end if;
  if p_status is null or p_status not in ('succeeded', 'failed', 'invalid_output') then
    return false;
  end if;

  update public.ai_generations g
     set status         = p_status,
         model          = p_model,
         input_tokens   = p_input_tokens,
         output_tokens  = p_output_tokens,
         error_message  = left(p_error, 500),
         completed_at   = now(),
         cost_usd       = coalesce(
                            public.captivate_model_cost(
                              p_model, p_input_tokens, p_output_tokens, g.created_at),
                            g.cost_usd)
   where g.id       = p_id
     and g.owner_id = v_user
     and g.kind <> 'image'
     and (g.status = 'pending'
          or (g.status = 'failed' and coalesce(g.output_tokens, 0) = 0));

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    return false;
  end if;

  select g.credit_id, g.credit_charged into v_credit, v_charged
    from public.ai_generations g
   where g.id = p_id;

  if v_credit is null then
    return true;
  end if;

  -- The same rule `captivate_count_generations` applies: only a *failed* call
  -- with no output tokens is one that never reached the model.
  v_counts := not (p_status = 'failed' and coalesce(p_output_tokens, 0) = 0);

  -- Serialise against a concurrent reservation spending the same balance.
  perform pg_advisory_xact_lock(hashtext('captivate_ai:' || v_user::text));

  if v_charged and not v_counts then
    update public.generation_credits
       set presentations_remaining = presentations_remaining + 1,
           updated_at = now()
     where public.generation_credits.id = v_credit
       -- Never past what was bought. Without this a settlement loop could mint
       -- balance out of a single purchase.
       and presentations_remaining < presentations_granted;
    update public.ai_generations set credit_charged = false where public.ai_generations.id = p_id;
  elsif not v_charged and v_counts then
    -- The truthful settlement arriving after a forged refund. The credit was
    -- given back a moment ago, so taking it again cannot go below zero.
    update public.generation_credits
       set presentations_remaining = presentations_remaining - 1,
           updated_at = now()
     where public.generation_credits.id = v_credit
       and presentations_remaining > 0;
    update public.ai_generations set credit_charged = true where public.ai_generations.id = p_id;
  end if;

  return true;
end;
$$;

revoke all on function public.captivate_complete_generation(uuid, text, text, integer, integer, text) from public;
revoke all on function public.captivate_complete_generation(uuid, text, text, integer, integer, text) from anon;
grant execute on function public.captivate_complete_generation(uuid, text, text, integer, integer, text) to authenticated;
