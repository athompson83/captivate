-- ---------------------------------------------------------------------------
-- Remote sessions: controlling a presentation from a phone.
--
-- The console talks to the stage over BroadcastChannel, which is same-origin
-- and same-browser by construction — there is no network for anyone to reach.
-- A phone is a different device, so this is the first transport that leaves
-- the browser, and the first one that needs an authorisation story of its own.
--
-- The topic a phone joins is derived from `presentation_sessions.id`, not from
-- the presentation id. A presentation id is long-lived and appears in ordinary
-- shareable-looking URLs; a channel named after it would be addressable by
-- anyone who ever saw one, forever. A session id is minted when the presenter
-- asks for a remote, and the row is what says whether that topic is joinable
-- at all — so most of the time the channel simply does not exist.
--
-- This is defence in depth rather than the control itself. The control is the
-- policy on realtime.messages below: only the session's owner, only while the
-- session is active, only before it expires.
-- ---------------------------------------------------------------------------

create table if not exists public.presentation_sessions (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  status          text not null default 'active' check (status in ('active', 'ended')),
  created_at      timestamptz not null default now(),
  -- Long enough that a talk running over is not cut off, short enough that a
  -- session from last month cannot still be joined.
  expires_at      timestamptz not null default now() + interval '8 hours',
  ended_at        timestamptz
);

create index if not exists presentation_sessions_owner_idx
  on public.presentation_sessions (owner_id, created_at desc);
create index if not exists presentation_sessions_presentation_idx
  on public.presentation_sessions (presentation_id, status);

alter table public.presentation_sessions enable row level security;

-- Owner-scoped like every other table. Insert additionally requires that the
-- deck being controlled is the caller's: without it a signed-in user could
-- mint a session row naming someone else's presentation, and while that would
-- not let them join that deck's stage, it would put a row into circulation
-- claiming to control it.
create policy "presentation_sessions_select_own" on public.presentation_sessions
  for select to authenticated using (owner_id = auth.uid());
create policy "presentation_sessions_insert_own" on public.presentation_sessions
  for insert to authenticated
  with check (owner_id = auth.uid() and public.captivate_owns_presentation(presentation_id));
create policy "presentation_sessions_update_own" on public.presentation_sessions
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "presentation_sessions_delete_own" on public.presentation_sessions
  for delete to authenticated using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- The channel gate.
--
-- `captivate_remote_topic_open` is the single place that decides whether a
-- topic may be joined or published to, so the rule is written once and both
-- policies below say the same thing. It answers false for a name that is not
-- ours, a session that does not exist, one that has ended, one that has
-- expired, and one belonging to somebody else — in every case without saying
-- which, since the caller learns only "no".
--
-- SECURITY DEFINER because the caller is being asked about a row RLS would not
-- show them if it were not theirs, and answering "no" is the whole point.
-- ---------------------------------------------------------------------------
create or replace function public.captivate_remote_topic_open(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.presentation_sessions s
    where p_topic is not null
      and p_topic like 'captivate-remote-%'
      -- A uuid cast on arbitrary text raises rather than returning null, so
      -- the shape is checked before the cast rather than after.
      and substring(p_topic from 18)
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and s.id = substring(p_topic from 18)::uuid
      and s.owner_id = auth.uid()
      and s.status = 'active'
      and s.expires_at > now()
  );
$$;

revoke all on function public.captivate_remote_topic_open(text) from public;
grant execute on function public.captivate_remote_topic_open(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime authorisation.
--
-- The client joins with `config.private: true`, which makes Realtime check
-- these policies on every join and every publish rather than letting anyone
-- who knows the topic name in. Both directions are gated identically: the
-- phone publishes commands and the stage publishes state, and both authenticate
-- as the same account, so there is no asymmetry to encode.
--
-- Guarded because `realtime.messages` exists only where Supabase's Realtime
-- extension is installed. The local test harness stubs it; a plain Postgres
-- without either would otherwise fail the whole migration on a table it has
-- no reason to have.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages absent; skipping remote channel policies';
    return;
  end if;

  execute 'alter table realtime.messages enable row level security';
  execute 'drop policy if exists captivate_remote_join on realtime.messages';
  execute 'drop policy if exists captivate_remote_publish on realtime.messages';
  execute $p$
    create policy captivate_remote_join on realtime.messages
      for select to authenticated
      using (public.captivate_remote_topic_open(realtime.topic()))
  $p$;
  execute $p$
    create policy captivate_remote_publish on realtime.messages
      for insert to authenticated
      with check (public.captivate_remote_topic_open(realtime.topic()))
  $p$;
end $$;
