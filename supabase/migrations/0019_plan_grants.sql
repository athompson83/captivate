-- ---------------------------------------------------------------------------
-- Plans granted rather than bought.
--
-- Some accounts are entitled without paying: the people who run Captivate,
-- a support case where somebody was wrongly throttled, a pilot at an
-- institution deciding whether to buy. Every one of those was previously
-- handled by writing a fake Stripe subscription into the mirror table, which
-- is a lie in the one table whose job is to be Stripe's truth — and a lie the
-- next webhook would silently overwrite.
--
-- A grant is its own thing. It says who, which plan, why, and until when.
--
-- The same absence as the billing tables: select-own and nothing else. There
-- is no insert, update or delete policy for any role, because a user who can
-- write their own grant grants themselves the product. Grants are made
-- through the service role — in practice, a migration or an operator with the
-- service key — and are visible to their holder so the settings page can say
-- where their plan came from rather than implying they are paying.
-- ---------------------------------------------------------------------------

create table if not exists public.plan_grants (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  plan       text not null check (plan in ('pro', 'unlimited')),
  -- Why this exists, in words, for whoever finds it in a year.
  note       text not null default '',
  granted_at timestamptz not null default now(),
  -- Null means it does not expire. A pilot should; an owner should not.
  expires_at timestamptz
);

alter table public.plan_grants enable row level security;

create policy "plan_grants_select_own" on public.plan_grants
  for select to authenticated using (user_id = auth.uid());
