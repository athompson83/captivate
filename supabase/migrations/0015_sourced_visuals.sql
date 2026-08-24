-- ---------------------------------------------------------------------------
-- Where an image came from, and what it cost.
--
-- Every image in Captivate has so far been one a person uploaded, so "an
-- asset" needed no provenance beyond its filename. Stock search and image
-- generation change that: one carries a licence and a photographer who is owed
-- credit, the other carries a prompt, a model, and a bill.
--
-- These are columns on `assets` rather than a second table because a sourced
-- image is an asset in every other respect — it lives in the same private
-- bucket, is served through the same signed-URL route, and is subject to the
-- same owner-scoped policies. `source` defaults to 'upload', so no existing row
-- needs backfilling and no existing policy changes.
-- ---------------------------------------------------------------------------

alter table public.assets
  add column if not exists source text not null default 'upload'
    check (source in ('upload', 'stock', 'generated'));

-- Stock: who took it, where it lives, and under what terms. `verified_at` is
-- when those terms were last confirmed against the provider, so a future
-- licence change has something to check existing rows against rather than only
-- new ones.
alter table public.assets add column if not exists provider          text;
alter table public.assets add column if not exists provider_asset_id text;
alter table public.assets add column if not exists original_page_url text;
alter table public.assets add column if not exists creator_name      text;
alter table public.assets add column if not exists creator_page_url  text;
alter table public.assets add column if not exists license_ref       text;
alter table public.assets add column if not exists verified_at       timestamptz;

-- Generated: exactly what was asked for, and what answering cost.
alter table public.assets add column if not exists model          text;
alter table public.assets add column if not exists prompt         text;
alter table public.assets add column if not exists quality        text;
alter table public.assets add column if not exists generation_ms  integer;

-- ---------------------------------------------------------------------------
-- Image generation is metered the same way text generation is, with one
-- addition: money.
--
-- The per-user hourly limit that bounds text calls is the wrong shape on its
-- own here, because the cost of an image is real and the deployment's budget is
-- shared. So the reservation checks two things at once — a global monthly spend
-- ceiling and a per-user daily count — and both are incremented by the same
-- statement that checks them.
--
-- The lock is global rather than per-user, unlike the text reservation. That is
-- the point: two different people spending the last of a shared budget at the
-- same moment is exactly the race a per-user lock would not catch.
-- ---------------------------------------------------------------------------
alter table public.ai_generations
  add column if not exists cost_usd numeric(10, 4) not null default 0;

-- How long the provider took. Latency is one of the numbers the provider
-- review at 250 attempts needs, and `output_tokens` is not it — an image
-- response has no tokens, and borrowing the column would make both readings
-- wrong.
alter table public.ai_generations
  add column if not exists duration_ms integer;

create index if not exists ai_generations_kind_created_idx
  on public.ai_generations (kind, created_at desc);

create or replace function public.captivate_reserve_image_generation(
  p_prompt           text,
  p_presentation_id  uuid,
  p_estimate_usd     numeric,
  p_monthly_budget   numeric,
  p_daily_max        integer
) returns table (id uuid, refusal text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_spent numeric;
  v_today integer;
  v_presentation uuid := p_presentation_id;
  v_id    uuid;
begin
  -- Fail closed. No identity, no reservation, no spend.
  if v_user is null then
    return query select null::uuid, 'signed-out'::text;
    return;
  end if;
  if p_estimate_usd is null or p_estimate_usd < 0 or p_monthly_budget is null or p_daily_max is null then
    return query select null::uuid, 'misconfigured'::text;
    return;
  end if;

  -- One lock for the whole deployment: the budget is shared, so two people
  -- spending its last dollar simultaneously is the case that has to be caught.
  perform pg_advisory_xact_lock(hashtext('captivate_image_budget'));

  if v_presentation is not null and not public.captivate_owns_presentation(v_presentation) then
    v_presentation := null;
  end if;

  select coalesce(sum(g.cost_usd), 0) into v_spent
    from public.ai_generations g
   where g.kind = 'image'
     and g.created_at >= date_trunc('month', now());

  if v_spent + p_estimate_usd > p_monthly_budget then
    -- Distinguished from the daily cap on purpose: these are different
    -- situations for a presenter, and one of them is not their fault.
    return query select null::uuid, 'budget'::text;
    return;
  end if;

  select count(*) into v_today
    from public.ai_generations g
   where g.owner_id = v_user
     and g.kind = 'image'
     and g.created_at >= date_trunc('day', now());

  if v_today >= p_daily_max then
    return query select null::uuid, 'daily'::text;
    return;
  end if;

  -- Reserved at the estimate. Settling reconciles it to what was actually
  -- charged; under-reserving and hoping would be the wrong direction to be
  -- wrong in.
  insert into public.ai_generations (owner_id, presentation_id, kind, prompt, status, cost_usd)
  values (v_user, v_presentation, 'image', left(coalesce(p_prompt, ''), 4000), 'pending', p_estimate_usd)
  returning public.ai_generations.id into v_id;

  return query select v_id, null::text;
end;
$$;

revoke all on function public.captivate_reserve_image_generation(text, uuid, numeric, numeric, integer) from public;
grant execute on function public.captivate_reserve_image_generation(text, uuid, numeric, numeric, integer) to authenticated;

-- Reconciles a reservation to what the provider actually charged.
--
-- Same shape and same constraints as `captivate_complete_generation`: the
-- caller's own row, pending only, once. It cannot lower a row below zero or
-- reopen it, so it is not a way to give yourself budget back.
create or replace function public.captivate_settle_image_generation(
  p_id            uuid,
  p_status        text,
  p_cost_usd      numeric,
  p_model         text,
  p_generation_ms integer,
  p_error         text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_rows integer;
begin
  if v_user is null then
    return false;
  end if;
  if p_status is null or p_status not in ('succeeded', 'failed', 'invalid_output') then
    return false;
  end if;

  update public.ai_generations
     set status       = p_status,
         cost_usd     = greatest(0, coalesce(p_cost_usd, cost_usd)),
         model        = p_model,
         error_message = left(p_error, 500),
         duration_ms  = p_generation_ms,
         completed_at = now()
   where id       = p_id
     and owner_id = v_user
     and status   = 'pending';

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.captivate_settle_image_generation(uuid, text, numeric, text, integer, text) from public;
grant execute on function public.captivate_settle_image_generation(uuid, text, numeric, text, integer, text) to authenticated;
