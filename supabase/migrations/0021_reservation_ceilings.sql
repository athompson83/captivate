-- ---------------------------------------------------------------------------
-- The price is not the caller's to name either.
--
-- 0020 closed the settlement end of this: `cost_usd` stopped being writable
-- once a reservation had been made, because a settlement that could restate
-- the price could zero the deployment's shared monthly budget or exhaust it
-- for everybody.
--
-- The reservation end was left open, and it is the cheaper attack of the two.
-- `captivate_reserve_image_generation` took the estimate, the monthly budget
-- and the daily cap as arguments, and PostgREST exposes it to `authenticated`
-- — so, exactly as 0020 says, nothing on the wire distinguishes the server's
-- call from the same RPC issued straight from a browser. One request:
--
--   rpc/captivate_reserve_image_generation
--   { "p_estimate_usd": 500, "p_monthly_budget": 100000, "p_daily_max": 100000 }
--
-- wrote a row whose `cost_usd` was 500 into a sum that is deliberately
-- *global* — the ceiling is on the deployment, not on the author — and every
-- other user was refused with 'budget' for the rest of the calendar month. No
-- model was called and no real money was spent; the shared allowance was
-- simply consumed by a number the caller chose.
--
-- So the three numbers move to where the check happens. The function now takes
-- only what the caller is entitled to decide — what to draw, and which deck it
-- belongs to — and reads its own ceilings.
-- ---------------------------------------------------------------------------

-- One row, by construction: the primary key can only ever be true.
create table if not exists public.ai_image_limits (
  id             boolean     primary key default true check (id),
  cost_usd       numeric(10, 4) not null check (cost_usd >= 0),
  monthly_budget numeric(10, 2) not null check (monthly_budget >= 0),
  daily_max      integer     not null check (daily_max >= 0),
  updated_at     timestamptz not null default now()
);

-- No policies at all, on the same grounds as `stripe_events`: the ceilings are
-- the deployment's, not any user's. The definer function below reads them and
-- the service role maintains them; a policy granting `authenticated` so much as
-- select would hand every user the numbers this migration exists to stop them
-- choosing.
alter table public.ai_image_limits enable row level security;

-- The documented defaults — the same numbers `budget()` fell back to, and the
-- only values `.env.example` ever named.
--
-- For a deployment that took those defaults this changes nothing but who is
-- allowed to state them. For one that had set `CAPTIVATE_IMAGE_BUDGET_USD`
-- *lower*, deliberately, as a spending safeguard, seeding 100 here would raise
-- its ceiling — and the application stops reading the variable in the same
-- change, so nothing would say so. That is the one direction this migration
-- must not move quietly, and a migration cannot read the environment to avoid
-- it: `generateImage` logs `ai.image.ceilings-moved` for as long as either
-- variable is still set, and `docs/DEPLOYMENT.md` carries the update to run.
insert into public.ai_image_limits (id, cost_usd, monthly_budget, daily_max)
values (true, 0.05, 100.00, 25)
on conflict (id) do nothing;

-- Dropped rather than replaced: a `create or replace` with fewer arguments
-- leaves the old signature in place and callable, which would close nothing at
-- all.
drop function if exists public.captivate_reserve_image_generation(text, uuid, numeric, numeric, integer);

create or replace function public.captivate_reserve_image_generation(
  p_prompt          text,
  p_presentation_id uuid
)
-- `daily_max` comes back so a refusal can name the real number. The caller no
-- longer holds the ceilings, and a message that says "you have reached the
-- daily limit" without saying what it is tells the author nothing they can act
-- on.
returns table(id uuid, refusal text, daily_max integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user   uuid := auth.uid();
  v_cost   numeric;
  v_budget numeric;
  v_daily  integer;
  v_spent  numeric;
  v_today  integer;
  v_presentation uuid := p_presentation_id;
  v_id     uuid;
begin
  if v_user is null then
    return query select null::uuid, 'signed-out'::text, null::integer;
    return;
  end if;

  select l.cost_usd, l.monthly_budget, l.daily_max
    into v_cost, v_budget, v_daily
    from public.ai_image_limits l
   where l.id;

  -- Fails closed. An unseeded table is a deployment that has not said what an
  -- image may cost, and guessing on its behalf is how a ceiling stops meaning
  -- anything.
  if v_cost is null then
    return query select null::uuid, 'misconfigured'::text, null::integer;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('captivate_image_budget'));

  if v_presentation is not null and not public.captivate_owns_presentation(v_presentation) then
    v_presentation := null;
  end if;

  select coalesce(sum(g.cost_usd), 0) into v_spent
    from public.ai_generations g
   where g.kind = 'image'
     and g.created_at >= date_trunc('month', now());

  if v_spent + v_cost > v_budget then
    return query select null::uuid, 'budget'::text, v_daily;
    return;
  end if;

  select count(*) into v_today
    from public.ai_generations g
   where g.owner_id = v_user
     and g.kind = 'image'
     and g.created_at >= date_trunc('day', now());

  if v_today >= v_daily then
    return query select null::uuid, 'daily'::text, v_daily;
    return;
  end if;

  insert into public.ai_generations (owner_id, presentation_id, kind, prompt, status, cost_usd)
  values (v_user, v_presentation, 'image', left(coalesce(p_prompt, ''), 4000), 'pending', v_cost)
  returning public.ai_generations.id into v_id;

  return query select v_id, null::text, v_daily;
end;
$function$;

-- `anon` by name as well as `public`. Supabase sets default privileges granting
-- execute on new functions in this schema to `anon, authenticated`, and those
-- are grants to the role rather than to `public` — so revoking `public` alone
-- left a freshly created function callable without signing in. The old
-- signature predated that default and so never showed it; recreating the
-- function is what applies it, which is exactly what this migration does.
revoke all on function public.captivate_reserve_image_generation(text, uuid) from public;
revoke all on function public.captivate_reserve_image_generation(text, uuid) from anon;
grant execute on function public.captivate_reserve_image_generation(text, uuid) to authenticated;
