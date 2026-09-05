\set ON_ERROR_STOP on
-- Grant the table privileges Supabase normally grants; RLS is the actual gate.
-- anon gets the same select grants it holds on a real Supabase project: every
-- policy is scoped `to authenticated`, so those grants must still yield
-- nothing — which is exactly what the anon probes below assert.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on schema public to anon;
grant select on all tables in schema public to anon;

-- Same story for storage.objects: Supabase grants both roles table access by
-- default, and its own RLS policies (migration 0002, plus 0011's share-link
-- addition) are what actually decide who can read or write which object.
grant usage on schema storage to authenticated, anon;
grant select, insert, update, delete on storage.objects to authenticated, anon;
grant select on storage.buckets to authenticated, anon;

-- Two users, each with one presentation containing one scene and one note.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

-- ---- Alice creates content, acting as `authenticated` under RLS -------------
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
insert into public.presentations (id, title) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Alice deck');
insert into public.sections (id, presentation_id, title) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'Alice section');
insert into public.scenes (id, presentation_id, title, speaker_notes) values
  ('aaaaaaaa-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000001', 'Alice scene', 'PRIVATE ALICE NOTES');
insert into public.scenes (id, presentation_id, title, flow_role) values
  ('aaaaaaaa-0000-0000-0000-00000000000d', 'aaaaaaaa-0000-0000-0000-000000000001', 'Alice aside', 'detail');
insert into public.lecture_notes (id, presentation_id, title, body) values
  ('aaaaaaaa-0000-0000-0000-00000000000c', 'aaaaaaaa-0000-0000-0000-000000000001', 'Alice note', 'secret');
reset role;

-- ---- Bob attempts to reach Alice's data ------------------------------------
set role authenticated;
set "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';

select 'bob_sees_alice_presentations' as check, count(*) as n from public.presentations;
select 'bob_sees_alice_scenes'        as check, count(*) as n from public.scenes;
select 'bob_sees_alice_sections'      as check, count(*) as n from public.sections;
select 'bob_sees_alice_notes'         as check, count(*) as n from public.lecture_notes;

-- Direct IDOR attempt by primary key.
select 'bob_idor_by_id' as check, count(*) as n from public.presentations
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'bob_idor_speaker_notes' as check, count(*) as n from public.scenes
  where id = 'aaaaaaaa-0000-0000-0000-00000000000b';

-- Bob tries to write into Alice's deck.
do $$
begin
  insert into public.scenes (presentation_id, title)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'Bob injected scene');
  raise exception 'FAIL: bob inserted a scene into alice''s deck';
exception
  when insufficient_privilege then raise notice 'PASS: bob blocked from inserting into alice deck';
end $$;

-- Bob tries to forge ownership on his own row.
do $$
begin
  insert into public.presentations (owner_id, title)
  values ('11111111-1111-1111-1111-111111111111', 'Bob forging alice ownership');
  raise exception 'FAIL: bob forged owner_id';
exception
  when insufficient_privilege then raise notice 'PASS: bob blocked from forging owner_id';
end $$;

-- Bob tries to delete Alice's presentation.
with d as (
  delete from public.presentations
   where id = 'aaaaaaaa-0000-0000-0000-000000000001' returning 1
)
select 'bob_delete_alice_rows' as check, count(*) as n from d;

-- Bob's own writes must still work.
insert into public.presentations (id, title) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Bob deck');
select 'bob_sees_own' as check, count(*) as n from public.presentations;
reset role;

-- Alice's data is intact.
select 'alice_data_intact' as check, count(*) as n from public.presentations
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- ---- Migration coverage ----------------------------------------------------
-- run.sh must apply every migration in supabase/migrations/, not only
-- 0001_captivate_core.sql. If it silently stopped at 0001 again, every RLS
-- probe above would still "pass" while testing a schema years out of date —
-- these checks fail loudly instead, against objects only later migrations
-- create.
do $$
begin
  if to_regclass('public.moments') is null then
    raise exception 'FAIL: public.moments (added by 0006_narrative_map.sql) is missing — later migrations were not applied';
  end if;
  raise notice 'PASS: public.moments exists (0006_narrative_map.sql applied)';
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'presentations' and column_name = 'target_seconds'
  ) then
    raise exception 'FAIL: presentations.target_seconds (added by 0007_target_duration.sql) is missing — later migrations were not applied';
  end if;
  raise notice 'PASS: presentations.target_seconds exists (0007_target_duration.sql applied)';
end $$;

-- ---------------------------------------------------------------------------
-- The other five owner-scoped tables.
--
-- The probes above covered presentations, sections, scenes, lecture_notes and
-- moments. Every other owner-scoped table had policies that no test exercised,
-- so a policy dropped or written the wrong way round on any of them would have
-- gone unnoticed — the harness would still have reported PASS.
-- ---------------------------------------------------------------------------

set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

insert into public.folders (id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f001', 'Alice folder');
insert into public.assets (id, storage_path, kind, mime_type, byte_size) values
  ('aaaaaaaa-0000-0000-0000-00000000a001',
   '11111111-1111-1111-1111-111111111111/secret.png', 'image', 'image/png', 1024);
insert into public.recordings (id, title) values
  ('aaaaaaaa-0000-0000-0000-00000000d001', 'Alice recording');
insert into public.ai_generations (id, kind, prompt) values
  ('aaaaaaaa-0000-0000-0000-00000000e001', 'scene', 'ALICE PRIVATE PROMPT');

-- ---- Share links ------------------------------------------------------------
-- Alice shares her deck; the token is the whole of a link-holder's authority.
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
update public.presentations
   set share_token = 'cccccccc-0000-0000-0000-000000000001'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;

set role anon;

-- Even with production-shaped grants, table policies give anon nothing —
-- holding a token must not change that.
select 'anon_sees_presentations' as check, count(*) as n from public.presentations;
select 'anon_sees_scenes'        as check, count(*) as n from public.scenes;

-- The right token resolves the deck through the one function anon may call…
select 'shared_link_resolves' as check,
  (public.captivate_shared_presentation('cccccccc-0000-0000-0000-000000000001')
     -> 'presentation' ->> 'title' = 'Alice deck')::int as n;

-- …and the payload is the audience's: no speaker notes, no owner identity.
select 'shared_link_omits_notes' as check,
  (position('PRIVATE ALICE NOTES' in
     coalesce(public.captivate_shared_presentation('cccccccc-0000-0000-0000-000000000001')::text, ''))
   = 0)::int as n;
select 'shared_link_omits_owner' as check,
  (position('11111111-1111-1111-1111-111111111111' in
     coalesce(public.captivate_shared_presentation('cccccccc-0000-0000-0000-000000000001')::text, ''))
   = 0)::int as n;

-- The payload has to say which scenes are the argument and which are asides.
-- Without it the shared viewer counts array positions, and a reader walks into
-- a detail scene the room never saw in sequence.
select 'shared_link_marks_asides' as check,
  (public.captivate_shared_presentation('cccccccc-0000-0000-0000-000000000001')
     #> '{scenes}' @> '[{"title":"Alice scene","flowRole":"main"},
                        {"title":"Alice aside","flowRole":"detail"}]'::jsonb)::int as n;

-- A wrong token is a dead link, not an error.
select 'shared_link_wrong_token_dead' as check,
  (public.captivate_shared_presentation('cccccccc-0000-0000-0000-0000000000ff') is null)::int as n;

reset role;

-- Revoking kills the link at once.
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
update public.presentations set share_token = null
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;

set role anon;
select 'shared_link_revoked_dead' as check,
  (public.captivate_shared_presentation('cccccccc-0000-0000-0000-000000000001') is null)::int as n;
reset role;

-- The conditional write that enabling uses ("claim only where no token
-- exists") must not replace a live token — it is what makes two concurrent
-- enables collapse to one winner instead of killing each other's links.
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
update public.presentations
   set share_token = 'cccccccc-0000-0000-0000-000000000002'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';

with attempt as (
  update public.presentations
     set share_token = 'cccccccc-0000-0000-0000-000000000003'
   where id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and share_token is null
  returning 1
)
select 'shared_link_conditional_claim_blocked' as check, (count(*) = 0)::int as n from attempt;

select 'shared_link_token_survives_lost_race' as check,
  (share_token = 'cccccccc-0000-0000-0000-000000000002')::int as n
  from public.presentations
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;

-- ---- Phone remote channel -----------------------------------------------------
-- The first transport that leaves the browser. Everything below is the
-- authorisation story for it: a topic is joinable only by the session's owner,
-- only while the session is live, and only before it expires — checked at the
-- policy layer on realtime.messages rather than by a client that could skip it.
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

insert into public.presentation_sessions (id, presentation_id) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001');
update public.presentation_sessions
   set status = 'ended', ended_at = now()
 where id = 'eeeeeeee-0000-0000-0000-000000000002';
update public.presentation_sessions
   set expires_at = now() - interval '1 minute'
 where id = 'eeeeeeee-0000-0000-0000-000000000003';

-- Minting a session for a deck that is not ours is refused by the insert
-- policy, so a row can never claim to control someone else's presentation.
do $$
begin
  insert into public.presentation_sessions (presentation_id)
  values ('bbbbbbbb-0000-0000-0000-000000000001');
  raise exception 'FAIL: alice opened a remote session on bob''s deck';
exception
  when insufficient_privilege then
    raise notice 'PASS: a remote session cannot name someone else''s deck';
end $$;

-- The owner may join and publish on a live session's topic.
set "realtime.topic" = 'captivate-remote-eeeeeeee-0000-0000-0000-000000000001';
select 'remote_owner_joins_live' as check,
  (public.captivate_remote_topic_open(realtime.topic()))::int as n;
insert into realtime.messages (topic, payload)
  values (realtime.topic(), '{"probe":true}');
select 'remote_owner_publishes_live' as check, (count(*) = 1)::int as n
  from realtime.messages where topic = realtime.topic();

-- An ended session is dead, and so is an expired one — for the real owner.
set "realtime.topic" = 'captivate-remote-eeeeeeee-0000-0000-0000-000000000002';
select 'remote_ended_session_closed' as check,
  (not public.captivate_remote_topic_open(realtime.topic()))::int as n;
set "realtime.topic" = 'captivate-remote-eeeeeeee-0000-0000-0000-000000000003';
select 'remote_expired_session_closed' as check,
  (not public.captivate_remote_topic_open(realtime.topic()))::int as n;

-- A topic that resolves to no session, one whose id is not even a uuid, and
-- one belonging to a different feature are all closed rather than erroring.
set "realtime.topic" = 'captivate-remote-eeeeeeee-0000-0000-0000-0000000000ff';
select 'remote_unknown_session_closed' as check,
  (not public.captivate_remote_topic_open(realtime.topic()))::int as n;
set "realtime.topic" = 'captivate-remote-not-a-uuid';
select 'remote_malformed_topic_closed' as check,
  (not public.captivate_remote_topic_open(realtime.topic()))::int as n;
set "realtime.topic" = 'captivate-present-aaaaaaaa-0000-0000-0000-000000000001';
select 'remote_foreign_topic_closed' as check,
  (not public.captivate_remote_topic_open(realtime.topic()))::int as n;
reset role;

-- A different signed-in user is refused the live topic, and sees no session.
set role authenticated;
set "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
set "realtime.topic" = 'captivate-remote-eeeeeeee-0000-0000-0000-000000000001';
select 'remote_non_owner_closed' as check,
  (not public.captivate_remote_topic_open(realtime.topic()))::int as n;
select 'bob_sees_alice_sessions' as check, count(*) as n
  from public.presentation_sessions;
-- And cannot end Alice's session out from under her.
with u as (update public.presentation_sessions set status = 'ended'
  where id = 'eeeeeeee-0000-0000-0000-000000000001' returning 1)
select 'bob_delete_alice_session' as check, count(*) as n from u;

-- The helper answering "no" is not the same as the channel refusing him. This
-- is the policy on realtime.messages doing the work.
do $$
begin
  insert into realtime.messages (topic, payload)
  values ('captivate-remote-eeeeeeee-0000-0000-0000-000000000001', '{"injected":true}');
  raise exception 'FAIL: bob published onto alice''s remote channel';
exception
  when insufficient_privilege then
    raise notice 'PASS: bob blocked from publishing on another owner''s channel';
end $$;
select 'bob_publishes_on_alice_channel' as check, count(*) as n
  from realtime.messages where payload ? 'injected';
reset role;

-- An anonymous visitor is refused outright: no session is ever open to anon,
-- whatever the topic.
-- The gate is not merely closed to anon; anon cannot even ask. Asserting the
-- privilege rather than the answer, because calling it raises rather than
-- returning false — which is the stronger outcome, and worth pinning as such.
select 'remote_gate_closed_to_anon' as check,
  (not has_function_privilege('anon', 'public.captivate_remote_topic_open(text)', 'execute'))::int as n;

set role anon;
do $$
begin
  insert into realtime.messages (topic, payload)
  values ('captivate-remote-eeeeeeee-0000-0000-0000-000000000001', '{"anon":true}');
  raise exception 'FAIL: an anonymous connection published on a remote channel';
exception
  when insufficient_privilege then
    raise notice 'PASS: anon blocked from publishing on a remote channel';
end $$;
select 'anon_sees_sessions' as check, count(*) as n from public.presentation_sessions;
select 'anon_sees_channel_messages' as check, count(*) as n from realtime.messages;
reset role;

-- Alice's live session survived all of it.
select 'alice_session_intact' as check, count(*) as n
  from public.presentation_sessions
 where id = 'eeeeeeee-0000-0000-0000-000000000001' and status = 'active';
reset "realtime.topic";

-- ---- AI spend reservation -----------------------------------------------------
-- The limiter counts ai_generations rows, so the row has to exist before the
-- model is called, not after. These probe the two properties that makes the
-- ticket worth anything: it stops counting up past the limit, and it cannot be
-- rewound to buy the caller more.
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

-- The ceilings are no longer the caller's to name, so these race a real one:
-- Alice has no subscription and no grant yet, which is the free plan — ten
-- presentations in thirty days, three in an hour. Three land.
select 'reserve_within_limit' as check,
  (id is not null)::int as n
  from public.captivate_reserve_generation('scenes', 'deck', 'first', null);
select 'reserve_second_within_limit' as check,
  (id is not null)::int as n
  from public.captivate_reserve_generation('scenes', 'deck', 'second', null);
select 'reserve_third_within_limit' as check,
  (id is not null)::int as n
  from public.captivate_reserve_generation('scenes', 'deck', 'third', null);

-- The fourth is refused, refused *before* anything is spent — the point of
-- reserving rather than recording — and it says which ceiling stopped it and
-- over what window. Two ceilings mean "wait an hour" and "wait out the month"
-- are different answers, and a refusal that names neither is unactionable.
select 'reserve_beyond_limit_refused' as check,
  (id is null and refusal = 'burst' and limit_max = 3 and limit_minutes = 60)::int as n
  from public.captivate_reserve_generation('scenes', 'deck', 'fourth', null);

-- Naming someone else's deck attributes the row to no deck rather than to
-- theirs: the function runs as definer, so RLS is not there to catch it.
select id from public.captivate_reserve_generation(
  'drawing', 'drawing', 'foreign-deck',
  'bbbbbbbb-0000-0000-0000-000000000001') \gset foreign_
select 'reserve_foreign_deck_unattributed' as check,
  (presentation_id is null)::int as n
  from public.ai_generations where id = :'foreign_id';

-- …and naming its own owner's deck is attributed normally, so the check above
-- is about ownership rather than the parameter being ignored.
select id from public.captivate_reserve_generation(
  'drawing', 'drawing', 'own-deck',
  'aaaaaaaa-0000-0000-0000-000000000001') \gset own_
select 'reserve_own_deck_attributed' as check,
  (presentation_id = 'aaaaaaaa-0000-0000-0000-000000000001')::int as n
  from public.ai_generations where id = :'own_id';

-- The gateway is derived from the model, not accepted as its own parameter
-- (0029) — an unprefixed id is Anthropic direct, a `vendor/` prefix is
-- OpenRouter, the same convention `DEFAULT_MODEL` in the application codes
-- against. Completing moves pending to terminal, once, and records it.
select 'complete_own_pending' as check,
  (public.captivate_complete_generation(
     (select id from public.ai_generations
       where kind = 'scenes' and prompt = 'first'),
     'succeeded', 'claude-sonnet-5', 10, 20, null))::int as n;
select 'complete_derives_direct_gateway' as check,
  (provider = 'anthropic')::int as n
  from public.ai_generations where kind = 'scenes' and prompt = 'first';
select 'complete_is_not_replayable' as check,
  (not public.captivate_complete_generation(
     (select id from public.ai_generations
       where kind = 'scenes' and prompt = 'first'),
     'succeeded', 'test-model', 10, 20, null))::int as n;

-- The other branch: a `vendor/` prefix derives OpenRouter. Nothing lets a
-- caller claim `anthropic` while supplying an OpenRouter-shaped model id, or
-- the reverse — the two are no longer independent parameters (0029).
select 'complete_derives_openrouter_gateway' as check,
  (public.captivate_complete_generation(
     (select id from public.ai_generations
       where kind = 'scenes' and prompt = 'third'),
     'succeeded', 'anthropic/claude-sonnet-5', 10, 20, null))::int as n;
select 'complete_openrouter_gateway_recorded' as check,
  (provider = 'openrouter')::int as n
  from public.ai_generations where kind = 'scenes' and prompt = 'third';

-- A model that merely contains a slash without being shaped like a real
-- gateway id derives no gateway at all, rather than a plausible-looking one.
-- `/`, `vendor/` (empty model), `/model` (empty vendor) and `a/b/c` (more
-- than one split) all satisfy "contains a slash"; none is a model this
-- application, or any gateway it calls, has ever named anything by. The
-- settlement still succeeds — a malformed model is exactly as forgeable as
-- it always was — but leaves `provider` unset rather than wrong.
--
-- A user of its own, so a probe reservation cannot shift the burst and
-- allowance counts the rest of this file's narrative depends on.
reset role;
insert into auth.users (id, email)
values ('55555555-5555-5555-5555-555555555555', 'malformed-model@example.com')
on conflict (id) do nothing;
set role authenticated;
set "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';
select id from public.captivate_reserve_generation(
  'moment', 'light', 'malformed', null) \gset malformed_
select 'complete_rejects_malformed_model_gateway' as check,
  (public.captivate_complete_generation(:'malformed_id'::uuid, 'succeeded', 'a/b/c', 1, 1, null))::int as n;
select 'complete_malformed_model_gateway_unset' as check,
  (status = 'succeeded' and model = 'a/b/c' and provider is null)::int as n
  from public.ai_generations where id = :'malformed_id'::uuid;
reset role;
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

-- And it cannot rewind a row to pending, which is how you would stop it
-- counting against you.
select 'complete_cannot_reopen' as check,
  (not public.captivate_complete_generation(
     (select id from public.ai_generations
       where kind = 'scenes' and prompt = 'second'),
     'pending', null, null, null, null))::int as n;

-- A completed row still counts, so the limit holds after the work is done.
select 'reserve_still_refused_after_completing' as check,
  (id is null and refusal = 'burst')::int as n
  from public.captivate_reserve_generation('scenes', 'deck', 'fifth', null);

-- ---- What a reservation is allowed to cost the caller --------------------------
-- Two things were being charged to an allowance that were never delivered.
--
-- A reservation abandoned by a killed function: `/api/ai/map` ran with a
-- 60-second ceiling while the model call was given three minutes, so the
-- platform killed the function mid-generation and nothing ever settled the
-- row. It stayed pending, and on the free plan — ten decks in thirty days —
-- each such 504 took one of them away for the full thirty days.
select id from public.captivate_reserve_generation('moment', 'light', 'abandoned', null)
  \gset stale_
reset role;
-- Aged from outside the caller's own privileges: a user must not be able to
-- edit their ledger, which is why `complete` exists at all. This is the test
-- harness standing in for thirty minutes passing.
update public.ai_generations set created_at = now() - interval '30 minutes'
 where id = :'stale_id';
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

select 'reserve_abandoned_pending_stops_counting' as check,
  (public.captivate_count_generations(array['moment'], 60) = 0)::int as n;

-- …but one still in flight holds its place, or the lock would be pointless.
-- Each of these reserves in its own statement: the counter is `stable`, so
-- within one statement it reads the snapshot taken before the insert and would
-- report zero however the rule was written.
select id from public.captivate_reserve_generation('rewrite', 'light', 'running', null)
  \gset fresh_
select 'reserve_in_flight_pending_still_counts' as check,
  (public.captivate_count_generations(array['rewrite'], 60) = 1)::int as n;

-- A call that never reached the model spent nothing and made nothing, so it is
-- not charged. Billing it is charging the author for our own downtime.
select id from public.captivate_reserve_generation('speaker_notes', 'light', 'provider down', null)
  \gset dud_
select public.captivate_complete_generation(
  :'dud_id', 'failed', null, null, null,
  'the model could not be reached') \gset dud_settled_
select 'failed_without_spend_does_not_count' as check,
  (public.captivate_count_generations(array['speaker_notes'], 60) = 0)::int as n;

-- A near-miss did reach it, twice, and is charged. The provider records the
-- usage on the failure for exactly this reason.
select id from public.captivate_reserve_generation('visuals', 'light', 'truncated', null)
  \gset spent_
select public.captivate_complete_generation(
  :'spent_id', 'failed', 'test-model', 9000, 9000,
  'the answer was cut off') \gset spent_settled_
select 'failed_with_spend_counts' as check,
  (public.captivate_count_generations(array['visuals'], 60) = 1)::int as n;

-- ---- The ledger is not the caller's to rewrite --------------------------------
-- `complete` runs with the caller's own JWT, so nothing on the wire tells the
-- server settling a call apart from the author settling it themselves — and
-- `ai_generations` is selectable by its owner, so the pending row's id is one
-- query away. A zero-token failure is the single terminal state that does not
-- count, which turned the allowance into three requests: reserve, forge the
-- refund, keep the answer.
--
-- No check inside the function can tell the two callers apart, because they
-- hold the same credential. What can be said instead is that the server writes
-- the truth *last*: a settlement recording spend is final, and one recording
-- none may still be corrected. The forgery is superseded rather than refused.
select id from public.captivate_reserve_generation('flow', 'light', 'unlimited', null)
  \gset forge_
select 'ledger_forged_refund_is_accepted' as check,
  (public.captivate_complete_generation(
     :'forge_id', 'failed', null, 0, 0, 'nothing to see'))::int as n;
select 'ledger_server_truth_supersedes_forgery' as check,
  (public.captivate_complete_generation(
     :'forge_id', 'succeeded', 'test-model', 900, 5000, null))::int as n;
select 'ledger_forged_refund_does_not_free_allowance' as check,
  (public.captivate_count_generations(array['flow'], 60) = 1)::int as n;

-- …and once spend is recorded, it cannot be taken back off.
select 'ledger_settled_spend_is_final' as check,
  (not public.captivate_complete_generation(
     :'forge_id', 'failed', null, 0, 0, 'refund me'))::int as n;

-- The state that is neither: a near-miss the provider never reported usage for
-- records no spend and still counts, because only a *failed* call with no
-- tokens is skipped. A rule keyed on "recorded no spend" would leave this row
-- rewritable and hand the forgery back — after the server had already written
-- the truth. What may be rewritten is the non-counting state itself, nothing
-- wider.
select id from public.captivate_reserve_generation('map', 'draft', 'no usage', null)
  \gset nearmiss_
select 'ledger_nearmiss_without_usage_counts' as check,
  (public.captivate_complete_generation(
     :'nearmiss_id', 'invalid_output', 'test-model', null, null, 'unreadable')
   and public.captivate_count_generations(array['map'], 60) = 1)::int as n;
select 'ledger_counting_row_is_final_even_with_no_tokens' as check,
  (not public.captivate_complete_generation(
     :'nearmiss_id', 'failed', null, 0, 0, 'refund me'))::int as n;
select 'ledger_nearmiss_still_counts_after_forgery' as check,
  (public.captivate_count_generations(array['map'], 60) = 1)::int as n;
reset role;

-- None of the spend functions is reachable signed out. Each returns false or
-- null on a null `auth.uid()` anyway, so this is about surface rather than a
-- second gate: Supabase grants `anon` EXECUTE on new functions by default, and
-- an endpoint nobody may usefully call should not be published at all.
select 'ledger_anon_cannot_execute_' || p.proname as check,
       (not has_function_privilege('anon', p.oid, 'EXECUTE'))::int as n
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('captivate_complete_generation', 'captivate_settle_image_generation',
                     'captivate_count_generations', 'captivate_reserve_generation',
                     'captivate_reserve_image_generation')
 order by p.proname;

-- The share link is the counter-example, and must stay anonymous: revoking the
-- grant above one function too far would take every unauthenticated viewer
-- with it.
select 'ledger_anon_keeps_share_link' as check,
       has_function_privilege('anon', 'public.captivate_shared_presentation(uuid)', 'EXECUTE')::int as n;

-- Bob cannot complete Alice's reservation, and cannot see it either.
set role authenticated;
set "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
select 'bob_completes_alice_reservation' as check,
  (public.captivate_complete_generation(
     (select id from public.ai_generations
       where kind = 'scenes' and prompt = 'second'),
     'succeeded', 'stolen', 1, 1, null))::int as n;
reset role;

select 'alice_reservation_still_pending' as check,
  (select (status = 'pending')::int from public.ai_generations
    where kind = 'scenes' and prompt = 'second') as n;

-- ---- Image generation budget --------------------------------------------------
-- Text generation is bounded per user; images are bounded per user *and*
-- against a shared monthly budget, because they cost money rather than
-- goodwill. These probe the parts that make that a control rather than a
-- number: that the ceilings are checked before the spend, that the two
-- refusals are distinguishable, and that settling cannot hand budget back.
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

-- `\gset` silently skips a NULL column, leaving the variable unset and the
-- next query a syntax error, so both are coalesced to the empty string the
-- probes below compare against.
-- Under both ceilings: issued.
select coalesce(id::text, '') as id, coalesce(refusal, '') as refusal
  from public.captivate_reserve_image_generation('a picture', null) \gset first_
select 'image_reserve_within_budget' as check,
  (:'first_id' <> '' and :'first_refusal' = '')::int as n;

-- The ceilings are the deployment's, so they are moved rather than passed: a
-- test that wants to sit against one edits the table the function reads.
reset role;
update public.ai_image_limits set monthly_budget = 0.05;
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

-- Over the monthly budget: refused, and the refusal says which ceiling.
select coalesce(id::text, '') as id, coalesce(refusal, '') as refusal
  from public.captivate_reserve_image_generation('another', null) \gset budget_
select 'image_reserve_over_budget_refused' as check,
  (:'budget_id' = '' and :'budget_refusal' = 'budget')::int as n;

reset role;
update public.ai_image_limits set monthly_budget = 100.00, daily_max = 1;
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

-- Over the per-user daily cap: refused, and distinguishably so — one of these
-- is the presenter's own doing and the other is not.
select coalesce(id::text, '') as id, coalesce(refusal, '') as refusal
  from public.captivate_reserve_image_generation('third', null) \gset daily_
select 'image_reserve_over_daily_cap_refused' as check,
  (:'daily_id' = '' and :'daily_refusal' = 'daily')::int as n;

-- The refusal carries the ceiling that refused, so the message a person reads
-- cannot disagree with it.
select 'image_daily_refusal_names_the_ceiling' as check,
  (select (daily_max = 1)::int
     from public.captivate_reserve_image_generation('fourth', null)) as n;

reset role;
update public.ai_image_limits set daily_max = 25;
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

-- Settling records how the call went, once, derives the gateway from the
-- model the same way text settlement does (0029), and does not restate the
-- price.
select 'image_settle_own_pending' as check,
  (public.captivate_settle_image_generation(
     :'first_id'::uuid, 'succeeded', 'gpt-image-2', 4200, null))::int as n;
select 'image_settle_derives_direct_gateway' as check,
  (select (provider = 'openai')::int
     from public.ai_generations where id = :'first_id'::uuid) as n;
select 'image_settle_is_not_replayable' as check,
  (not public.captivate_settle_image_generation(
     :'first_id'::uuid, 'succeeded', 'test-image-model', 1, null))::int as n;
-- The estimate the reservation checked against the budget is the figure that
-- stands. Letting a settlement rewrite it let a caller zero their own cost and
-- free the shared monthly budget, or inflate it and exhaust it for everybody.
select 'image_settled_cost_is_the_reserved_estimate' as check,
  (select (cost_usd = 0.05 and duration_ms = 4200)::int
     from public.ai_generations where id = :'first_id'::uuid) as n;

-- The other branch: a `vendor/`-prefixed model id derives OpenRouter, same
-- as text settlement — the two functions share one convention, not two.
select id from public.captivate_reserve_image_generation('via openrouter', null) \gset router_
select 'image_settle_derives_openrouter_gateway' as check,
  (public.captivate_settle_image_generation(
     :'router_id'::uuid, 'succeeded', 'openai/gpt-image-2', 9000, null))::int as n;
select 'image_openrouter_gateway_recorded' as check,
  (select (provider = 'openrouter')::int
     from public.ai_generations where id = :'router_id'::uuid) as n;

-- Same malformed-model behaviour on the image path: settles, does not guess.
select id from public.captivate_reserve_image_generation('malformed model', null) \gset malformed_
select 'image_settle_rejects_malformed_model_gateway' as check,
  (public.captivate_settle_image_generation(:'malformed_id'::uuid, 'succeeded', 'vendor/', 100, null))::int as n;
select 'image_malformed_model_gateway_unset' as check,
  (select (status = 'succeeded' and model = 'vendor/' and provider is null)::int
     from public.ai_generations where id = :'malformed_id'::uuid) as n;
reset role;

-- Bob cannot settle Alice's reservation, which is what would let him zero its
-- cost and free up the shared budget.
set role authenticated;
set "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
select 'bob_settles_alice_image' as check,
  (public.captivate_settle_image_generation(
     :'first_id'::uuid, 'succeeded', 'stolen', 1, null))::int as n;
reset role;

select 'image_cost_survived_bob' as check,
  (select (cost_usd = 0.05)::int from public.ai_generations where id = :'first_id'::uuid) as n;

-- ---- The shared budget is not one caller's to exhaust ----------------------
-- The monthly sum is deliberately global: the ceiling belongs to the
-- deployment, not to the author. That made the estimate the most valuable
-- argument in the schema while the caller still supplied it — one request
-- naming a `p_estimate_usd` of 500 wrote 500 into the sum and refused every
-- other user with 'budget' for the rest of the month, without calling a model
-- or spending anything real.
--
-- There is no argument to name any more, so the probe is that Bob reserving as
-- hard as he can cannot refuse Alice.
set role authenticated;
set "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
-- Two statements on purpose. Reading the row back inside the same statement
-- that reserves it selects against a snapshot taken before the insert, so the
-- cost comes back null and the probe proves nothing.
select coalesce(id::text, '') as id, coalesce(refusal, '') as refusal
  from public.captivate_reserve_image_generation('bob', null) \gset bob_
select 'image_bob_reserves_at_the_deployment_price' as check,
  (select (cost_usd = 0.05)::int from public.ai_generations
     where id = nullif(:'bob_id', '')::uuid) as n;
reset role;

set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
select coalesce(id::text, '') as id, coalesce(refusal, '') as refusal
  from public.captivate_reserve_image_generation('alice after bob', null) \gset after_bob_
select 'image_bob_cannot_exhaust_the_month' as check,
  (:'after_bob_id' <> '' and :'after_bob_refusal' = '')::int as n;
reset role;

-- The ceilings themselves are not readable by a signed-in caller either.
-- Leaving them selectable would hand every user the numbers this table exists
-- to stop them choosing.
set role authenticated;
set "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
select 'image_limits_not_readable' as check,
  (select (count(*) = 0)::int from public.ai_image_limits) as n;
reset role;

-- ---- Shared-link assets ------------------------------------------------------
-- A shared deck's scene content can reference uploaded media. The RPC that
-- resolves it — and the storage read it depends on — must follow the same
-- token-gated shape as the deck itself: readable while shared, dead the
-- instant the link is revoked, and never reachable through someone else's
-- unshared deck.
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
-- Deliberately no `presentation_id`, because that is what the application
-- actually writes: the uploader never passed one, so every asset in the real
-- database has null there. The old probes set it by hand and so proved a join
-- the product could never satisfy — every uploaded image on a shared deck
-- returned 404 while this suite reported PASS.
insert into public.assets (id, storage_path, kind, mime_type, byte_size) values
  ('dddddddd-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111/asset1.png', 'image', 'image/png', 1024);
insert into storage.objects (bucket_id, name, owner) values
  ('assets', '11111111-1111-1111-1111-111111111111/asset1.png', '11111111-1111-1111-1111-111111111111');

-- What makes it shared is that a scene of a shared deck refers to it.
update public.scenes
   set content = jsonb_build_object(
     'version', 1,
     'elements', jsonb_build_array(jsonb_build_object(
       'type', 'image',
       'url', '/api/assets/dddddddd-0000-0000-0000-000000000001/content')))
 where id = 'aaaaaaaa-0000-0000-0000-00000000000b';

-- A backdrop is referenced by the presentation's journey, not by any scene.
-- 0016 could not see it, so a picture behind a shared show rendered for its
-- owner and 404ed for everyone who followed the link; 0030 looks there too.
insert into public.assets (id, storage_path, kind, mime_type, byte_size) values
  ('dddddddd-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111/backdrop.png', 'image', 'image/png', 1024);
insert into storage.objects (bucket_id, name, owner) values
  ('assets', '11111111-1111-1111-1111-111111111111/backdrop.png', '11111111-1111-1111-1111-111111111111');
update public.presentations
   set journey = journey || jsonb_build_object('backdrop', jsonb_build_object(
     'url', '/api/assets/dddddddd-0000-0000-0000-000000000003/content',
     'assetId', 'dddddddd-0000-0000-0000-000000000003'))
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';

reset role;

set role authenticated;
set "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';

select 'bob_sees_alice_folders'     as check, count(*) as n from public.folders;
select 'bob_sees_alice_assets'      as check, count(*) as n from public.assets;
select 'bob_sees_alice_recordings'  as check, count(*) as n from public.recordings;
-- Scoped to rows that are not Bob's, unlike its siblings above, because Bob
-- legitimately owns a reservation of his own by the time this runs. A bare
-- `count(*)` here would have read his own row as a leak — and, worse, would
-- have gone on passing for the wrong reason on any day he owned nothing.
select 'bob_sees_alice_generations' as check, count(*) as n
  from public.ai_generations
 where owner_id <> '22222222-2222-2222-2222-222222222222'::uuid;
select 'bob_sees_alice_profiles'    as check, count(*) as n from public.profiles
  where id = '11111111-1111-1111-1111-111111111111';

-- Direct reach by primary key, the shape RLS exists to stop.
select 'bob_idor_asset_path' as check, count(*) as n from public.assets
  where id = 'aaaaaaaa-0000-0000-0000-00000000a001';
select 'bob_idor_generation_prompt' as check, count(*) as n from public.ai_generations
  where id = 'aaaaaaaa-0000-0000-0000-00000000e001';

-- Writing into someone else's storage prefix must be refused. An asset row is
-- the record of an uploaded object; forging one is how you would claim a file
-- that is not yours.
do $$
begin
  insert into public.assets (owner_id, storage_path, kind, mime_type, byte_size)
  values ('11111111-1111-1111-1111-111111111111',
          '11111111-1111-1111-1111-111111111111/stolen.png', 'image', 'image/png', 1);
  raise exception 'FAIL: bob forged an asset owned by alice';
exception
  when insufficient_privilege then raise notice 'PASS: bob blocked from forging an asset owner';
end $$;

do $$
begin
  insert into public.folders (owner_id, name)
  values ('11111111-1111-1111-1111-111111111111', 'Bob forging alice folder');
  raise exception 'FAIL: bob forged a folder owned by alice';
exception
  when insufficient_privilege then raise notice 'PASS: bob blocked from forging a folder owner';
end $$;

-- Deleting another user's rows must affect nothing.
with d as (delete from public.assets
  where id = 'aaaaaaaa-0000-0000-0000-00000000a001' returning 1)
select 'bob_delete_alice_asset' as check, count(*) as n from d;
with d as (delete from public.recordings
  where id = 'aaaaaaaa-0000-0000-0000-00000000d001' returning 1)
select 'bob_delete_alice_recording' as check, count(*) as n from d;

-- The ai_generations ledger is append-only by design, and the rate limiter
-- counts exactly these rows. If a caller could edit or delete their own, they
-- could erase their spend and defeat it.
do $$
declare affected integer;
begin
  insert into public.ai_generations (id, kind, prompt)
  values ('bbbbbbbb-0000-0000-0000-00000000e001', 'scene', 'Bob own prompt');
  update public.ai_generations set prompt = 'tampered'
    where id = 'bbbbbbbb-0000-0000-0000-00000000e001';
  get diagnostics affected = row_count;
  if affected > 0 then
    raise exception 'FAIL: bob rewrote his own generation ledger (spend limit defeatable)';
  end if;
  raise notice 'PASS: generation ledger is append-only even for its owner';
end $$;

-- Bob's own asset and its object, inserted after the visibility counts
-- above so they cannot inflate them. They exist to prove that holding a
-- link to Alice's shared deck buys nothing on Bob's unshared one.
insert into public.assets (id, storage_path, kind, mime_type, byte_size) values
  ('dddddddd-0000-0000-0000-000000000002',
   '22222222-2222-2222-2222-222222222222/asset2.png', 'image', 'image/png', 1024);
insert into storage.objects (bucket_id, name, owner) values
  ('assets', '22222222-2222-2222-2222-222222222222/asset2.png', '22222222-2222-2222-2222-222222222222');
-- And a backdrop on Bob's unshared deck, which must resolve for nobody.
insert into public.assets (id, storage_path, kind, mime_type, byte_size) values
  ('dddddddd-0000-0000-0000-000000000004',
   '22222222-2222-2222-2222-222222222222/backdrop2.png', 'image', 'image/png', 1024);
update public.presentations
   set journey = journey || jsonb_build_object('backdrop', jsonb_build_object(
     'url', '/api/assets/dddddddd-0000-0000-0000-000000000004/content',
     'assetId', 'dddddddd-0000-0000-0000-000000000004'))
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
reset role;

-- Alice's rows survived all of it.
select 'alice_assets_intact' as check, count(*) as n from public.assets
  where id = 'aaaaaaaa-0000-0000-0000-00000000a001';
select 'alice_recordings_intact' as check, count(*) as n from public.recordings
  where id = 'aaaaaaaa-0000-0000-0000-00000000d001';


set role anon;

-- Alice's deck is shared (token '...002' from above): its asset resolves…
select 'shared_asset_resolves' as check,
  (exists (
     select 1 from public.captivate_shared_asset('dddddddd-0000-0000-0000-000000000001')
      where storage_path = '11111111-1111-1111-1111-111111111111/asset1.png'
  ))::int as n;
select 'shared_asset_storage_readable' as check,
  (count(*) = 1)::int as n from storage.objects
  where bucket_id = 'assets' and name = '11111111-1111-1111-1111-111111111111/asset1.png';

-- The backdrop, referenced only by the shared deck's journey, resolves too.
select 'shared_asset_backdrop_resolves' as check,
  (exists (
     select 1 from public.captivate_shared_asset('dddddddd-0000-0000-0000-000000000003')
      where storage_path = '11111111-1111-1111-1111-111111111111/backdrop.png'
  ))::int as n;
select 'shared_asset_backdrop_storage_readable' as check,
  (count(*) = 1)::int as n from storage.objects
  where bucket_id = 'assets' and name = '11111111-1111-1111-1111-111111111111/backdrop.png';
-- A backdrop on an unshared deck is nobody's.
select 'shared_asset_backdrop_unshared_dead' as check,
  (not exists (
     select 1 from public.captivate_shared_asset('dddddddd-0000-0000-0000-000000000004')
  ))::int as n;

-- …and Bob's deck is not shared at all, so his asset resolves nowhere and its
-- object is not readable — a link-holder for one deck gains nothing on another.
select 'shared_asset_unshared_deck_dead' as check,
  (not exists (
     select 1 from public.captivate_shared_asset('dddddddd-0000-0000-0000-000000000002')
  ))::int as n;
select 'shared_asset_unshared_storage_unreadable' as check,
  (count(*) = 0)::int as n from storage.objects
  where bucket_id = 'assets' and name = '22222222-2222-2222-2222-222222222222/asset2.png';
reset role;

-- A signed-in visitor is not the owner either. RLS on `assets` matches none of
-- Alice's rows for Bob, so if the content route only consulted the table for a
-- logged-in caller, every image on a shared deck would 404 for Bob and resolve
-- for a logged-out stranger. The token-gated resolver has to answer him too —
-- granting an account exactly what the link alone grants, and no more.
set role authenticated;
set "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
select 'shared_asset_signed_in_visitor_resolves' as check,
  (exists (
     select 1 from public.captivate_shared_asset('dddddddd-0000-0000-0000-000000000001')
      where storage_path = '11111111-1111-1111-1111-111111111111/asset1.png'
  ))::int as n;
select 'shared_asset_signed_in_visitor_storage_readable' as check,
  (count(*) = 1)::int as n from storage.objects
  where bucket_id = 'assets' and name = '11111111-1111-1111-1111-111111111111/asset1.png';
reset role;

-- Revoking kills asset access in the same instant it kills the deck.
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
update public.presentations set share_token = null
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;

set role anon;
select 'shared_asset_revoked_dead' as check,
  (not exists (
     select 1 from public.captivate_shared_asset('dddddddd-0000-0000-0000-000000000001')
  ))::int as n;
select 'shared_asset_revoked_storage_unreadable' as check,
  (count(*) = 0)::int as n from storage.objects
  where bucket_id = 'assets' and name = '11111111-1111-1111-1111-111111111111/asset1.png';
reset role;

set role authenticated;
set "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
select 'shared_asset_revoked_signed_in_dead' as check,
  (not exists (
     select 1 from public.captivate_shared_asset('dddddddd-0000-0000-0000-000000000001')
  ))::int as n;
select 'shared_asset_revoked_signed_in_storage_unreadable' as check,
  (count(*) = 0)::int as n from storage.objects
  where bucket_id = 'assets' and name = '11111111-1111-1111-1111-111111111111/asset1.png';
reset role;

-- ---------------------------------------------------------------------------
-- Billing: a user may read their own subscription and may never write one.
--
-- Granting yourself Pro has to be impossible, not merely unimplemented. There
-- is no insert, update or delete policy on `subscriptions` for any role, so
-- the writes below affect nothing rather than escalating.
-- ---------------------------------------------------------------------------
insert into public.subscriptions
  (user_id, stripe_subscription_id, status, price_id, billing_interval,
   current_period_end, updated_from_event_at)
values
  ('11111111-1111-1111-1111-111111111111', 'sub_alice', 'active', 'price_test',
   'month', now() + interval '30 days', now()),
  ('22222222-2222-2222-2222-222222222222', 'sub_bob', 'active', 'price_test',
   'month', now() + interval '30 days', now());

set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

select 'subscription_sees_only_own' as check,
  (count(*) = 1)::int as n from public.subscriptions;

select 'subscription_other_user_invisible' as check,
  (count(*) = 0)::int as n from public.subscriptions
  where user_id = '22222222-2222-2222-2222-222222222222';

-- No update policy exists, so this matches no rows.
update public.subscriptions
   set status = 'active', current_period_end = now() + interval '999 days';
reset role;

select 'subscription_not_self_writable' as check,
  (count(*) = 0)::int as n from public.subscriptions
  where current_period_end > now() + interval '900 days';

-- Nor may a user mint one for themselves. With no insert policy the write is
-- refused outright rather than matching zero rows, so the raise is caught here
-- to keep ON_ERROR_STOP from ending the run on the expected denial.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '11111111-1111-1111-1111-111111111111', true);
  begin
    insert into public.subscriptions
      (user_id, stripe_subscription_id, status, price_id, billing_interval,
       current_period_end, updated_from_event_at)
    values ('11111111-1111-1111-1111-111111111111', 'sub_forged', 'active',
            'price_test', 'year', now() + interval '900 days', now());
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;

select 'subscription_not_self_insertable' as check,
  (count(*) = 0)::int as n from public.subscriptions
  where stripe_subscription_id = 'sub_forged';

-- The event ledger has no policies at all: not even a read.
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
select 'stripe_events_opaque_to_users' as check,
  (count(*) = 0)::int as n from public.stripe_events;
reset role;

-- ---- Granted plans -------------------------------------------------------------
-- A grant is an entitlement handed out rather than bought. It has the same
-- security story as the billing tables and for the same reason: a user who can
-- write their own grant grants themselves the product, so the schema offers no
-- verb for it. It is readable by its holder alone, because the settings page
-- has to be able to say "granted, not billed" rather than implying a payment.
insert into public.plan_grants (user_id, plan, note)
values ('11111111-1111-1111-1111-111111111111', 'unlimited', 'Owner account.');

set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
select 'grant_sees_own' as check, (count(*) = 1)::int as n from public.plan_grants;
reset role;

set role authenticated;
set "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
select 'bob_sees_alice_grant' as check, count(*) as n from public.plan_grants;

do $$
begin
  begin
    insert into public.plan_grants (user_id, plan, note)
    values ('22222222-2222-2222-2222-222222222222', 'unlimited', 'self-granted');
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;

select 'grant_not_self_insertable' as check,
  (count(*) = 0)::int as n from public.plan_grants
  where user_id = '22222222-2222-2222-2222-222222222222';

-- Nor may the holder promote their own grant, which is the same hole by
-- another route.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '11111111-1111-1111-1111-111111111111', true);
  update public.plan_grants set plan = 'unlimited', expires_at = null
   where user_id = '11111111-1111-1111-1111-111111111111';
end $$;
reset role;

select 'grant_not_self_writable' as check,
  (count(*) = 1)::int as n from public.plan_grants
  where user_id = '11111111-1111-1111-1111-111111111111' and note = 'Owner account.';

-- ---- What plan the database thinks you are on ---------------------------------
-- `captivate_current_plan` is now the whole resolution: the reservation reads
-- it inside its own lock, and the settings page reads it through the
-- application. It used to live in TypeScript and be handed to the reservation
-- as a ceiling, which meant the rule was only applied to callers who chose to
-- go through the application at all.
--
-- An account with nothing at all is the floor.
insert into auth.users (id, email)
values ('33333333-3333-3333-3333-333333333333', 'nobody@example.com')
on conflict (id) do nothing;
set role authenticated;
set "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
select 'plan_default_is_free' as check,
  (public.captivate_current_plan() = 'free')::int as n;
reset role;

-- Bob's subscription is active and predates the stored tier, so it has none.
-- That resolves to Basic — the *lowest* paid tier — rather than to free (which
-- would cut off somebody who is paying) or to Pro (which would hand them the
-- top tier on a missing column).
set role authenticated;
set "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
select 'plan_active_without_stored_tier_is_basic' as check,
  (public.captivate_current_plan() = 'basic')::int as n;
reset role;

-- Alice holds an unlimited grant from the block above. A grant outranks a
-- subscription rather than merging with it: somebody with both gets the better
-- of the two, and the people a grant exists for must not depend on a
-- subscription they were never meant to have.
insert into public.subscriptions
  (user_id, stripe_subscription_id, status, price_id, plan, billing_interval, updated_from_event_at)
values ('11111111-1111-1111-1111-111111111111', 'sub_alice', 'active',
        'price_basic', 'basic', 'month', now())
on conflict (user_id) do update set status = 'active', plan = 'basic';

set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
select 'plan_grant_outranks_subscription' as check,
  (public.captivate_current_plan() = 'unlimited')::int as n;
reset role;

-- With the grant expired, the subscription decides — and it decides on the
-- stored tier, not on the price it was resolved from. That is what stops a
-- rotated price silently moving a paying customer to the lowest paid plan.
update public.plan_grants set expires_at = now() - interval '1 day'
 where user_id = '11111111-1111-1111-1111-111111111111';

set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
select 'plan_expired_grant_falls_through' as check,
  (public.captivate_current_plan() = 'basic')::int as n;
reset role;

update public.subscriptions set plan = 'pro'
 where user_id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
select 'plan_reads_the_stored_tier' as check,
  (public.captivate_current_plan() = 'pro')::int as n;
reset role;

-- A row written before the tier was stored. Basic, the *lowest* paid tier:
-- guessing upward hands somebody Pro for Basic's money.
update public.subscriptions set plan = null
 where user_id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
select 'plan_unknown_tier_guesses_downward' as check,
  (public.captivate_current_plan() = 'basic')::int as n;
reset role;

-- `past_due` is graced until the period genuinely ends: dunning is still
-- retrying the card, and cutting someone off mid-cycle over a temporary
-- decline is hostile. When dunning gives up Stripe moves the subscription to
-- `canceled`, which lands on free.
update public.subscriptions
   set status = 'past_due', plan = 'pro', current_period_end = now() + interval '3 days'
 where user_id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
select 'plan_past_due_is_graced' as check,
  (public.captivate_current_plan() = 'pro')::int as n;
reset role;

update public.subscriptions set current_period_end = now() - interval '1 day'
 where user_id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
select 'plan_past_due_expires' as check,
  (public.captivate_current_plan() = 'free')::int as n;
reset role;

update public.subscriptions set status = 'canceled', current_period_end = now() + interval '30 days'
 where user_id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
select 'plan_cancelled_is_free' as check,
  (public.captivate_current_plan() = 'free')::int as n;
reset role;

-- The ceilings are the deployment's, not any user's. A select policy here
-- would hand every user the numbers the table exists to stop them choosing —
-- the same reason `ai_image_limits` has none.
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
select 'plan_budgets_opaque_to_users' as check,
  (count(*) = 0)::int as n from public.plan_budgets;

-- And a user cannot raise their own. This is the hole the whole migration
-- exists to close: the ceiling used to be an argument to the reservation, and
-- PostgREST exposes that function to `authenticated`.
do $$
begin
  begin
    update public.plan_budgets set allowance_max = 999999 where plan = 'free';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;

select 'plan_budgets_not_user_writable' as check,
  (allowance_max = 10)::int as n from public.plan_budgets
  where plan = 'free' and budget_group = 'deck';

-- A caller cannot record expensive work against a cheap budget. Without the
-- kind/group check the reservation would let a deck generation count as a
-- `light` action and spend the largest allowance the plan has.
set role authenticated;
set "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
select 'reserve_rejects_kind_outside_group' as check,
  (refusal = 'misconfigured')::int as n
  from public.captivate_reserve_generation('scenes', 'light', 'p', null);
select 'reserve_rejects_unknown_group' as check,
  (refusal = 'misconfigured')::int as n
  from public.captivate_reserve_generation('scenes', 'nonsense', 'p', null);
reset role;

-- ---- What a text generation cost ----------------------------------------------
-- `cost_usd` was written only by image generation; every text row settled at
-- zero while the tokens sat beside it unpriced. Pricing a tier means knowing
-- what a presentation costs, so an allowance set without this was a guess.
set role authenticated;
set "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';

select id from public.captivate_reserve_generation('scenes', 'deck', 'cost', null) \gset cost_
select 'cost_recorded_for_successful_call' as check,
  (public.captivate_complete_generation(
     :'cost_id', 'succeeded', 'claude-sonnet-5', 100000, 20000, null))::int as n;
-- 100k in at $3/Mtok plus 20k out at $15/Mtok. Asserted as the arithmetic
-- rather than as a literal, so a rate change moves the expectation with it.
select 'cost_is_tokens_times_the_rate' as check,
  (cost_usd = round((100000::numeric / 1000000) * 3.00 + (20000::numeric / 1000000) * 15.00, 6))::int
    as n
  from public.ai_generations where id = :'cost_id';

-- A truncated or schema-invalid answer still cost money. Counting only
-- successes understates the bill by exactly the share of attempts that go
-- wrong, which is the share worth knowing about.
select id from public.captivate_reserve_generation('map', 'draft', 'cut off', null) \gset trunc_
-- Settled and read in separate statements: within one statement the read takes
-- the snapshot from before the update and reports the row as it was.
select public.captivate_complete_generation(
  :'trunc_id', 'failed', 'claude-sonnet-5', 120000, 8000, 'cut off') \gset trunc_settled_
select 'cost_recorded_for_failed_call_with_usage' as check,
  (cost_usd > 0)::int as n
  from public.ai_generations where id = :'trunc_id';

-- A model this deployment has no price for is left alone rather than costed at
-- a guess: made-up numbers in the evidence a pricing decision rests on are
-- worse than a visible gap.
select id from public.captivate_reserve_generation('rewrite', 'light', 'unknown', null) \gset unk_
select public.captivate_complete_generation(
  :'unk_id', 'succeeded', 'a-model-nobody-priced', 1000, 1000, null) \gset unk_settled_
-- The tokens are the caller's to report, and this is what prices them. A
-- negative count is a negative cost, and the sum of this column is what an
-- allowance gets argued from — a ledger somebody can subtract from is worse
-- than no ledger, because it still looks like evidence.
select id from public.captivate_reserve_generation('scenes', 'deck', 'negative', null) \gset neg_
select 'cost_negative_tokens_are_refused' as check,
  (public.captivate_complete_generation(
     :'neg_id', 'succeeded', 'claude-sonnet-5', -1000000, -1000000, null) = false)::int as n;
select 'cost_negative_tokens_wrote_nothing' as check,
  (status = 'pending' and coalesce(cost_usd, 0) = 0)::int as n
  from public.ai_generations where id = :'neg_id'::uuid;

select 'cost_unknown_model_is_not_invented' as check,
  (coalesce(cost_usd, 0) = 0)::int as n
  from public.ai_generations where id = :'unk_id';

-- The rates are the deployment's, not any user's. A user who could write here
-- would price their own usage at zero.
select 'cost_rates_opaque_to_users' as check,
  (count(*) = 0)::int as n from public.ai_model_rates;
do $$
begin
  begin
    update public.ai_model_rates set input_per_mtok = 0;
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;

select 'cost_rates_not_user_writable' as check,
  (input_per_mtok = 3.00)::int as n from public.ai_model_rates
  where model = 'claude-sonnet-5';

-- Nothing in a browser has any business pricing a generation, so the helper is
-- not published to either role.
select 'cost_' || r.rolname || '_cannot_execute_captivate_model_cost' as check,
  (not has_function_privilege(
     r.rolname,
     'public.captivate_model_cost(text, integer, integer, timestamptz)',
     'EXECUTE'))::int as n
  from (values ('anon'), ('authenticated')) as r(rolname);

-- ---- A top-up buys presentations, not a deck counter --------------------------
-- The defect this is the acceptance test for: a credit that replenished only
-- the deck pool would sell somebody ten presentations and refuse them at the
-- drawing pool with a balance still showing. Generating a presentation is a map
-- call, a scenes call and up to ten staged drawings, so a credit has to raise
-- every one of those and be spent once, when the deck is actually made.
insert into auth.users (id, email)
values ('44444444-4444-4444-4444-444444444444', 'topup@example.com')
on conflict (id) do nothing;

insert into public.subscriptions
  (user_id, stripe_subscription_id, status, price_id, plan, billing_interval, updated_from_event_at)
values ('44444444-4444-4444-4444-444444444444', 'sub_topup', 'active',
        'price_basic', 'basic', 'month', now())
on conflict (user_id) do nothing;

-- Basic's whole allowance, spent: 25 decks, 50 drafts, 250 drawings, 250 light.
-- Aged past the burst hour so only the 30-day allowance can refuse.
insert into public.ai_generations (owner_id, kind, prompt, status, created_at, output_tokens)
select '44444444-4444-4444-4444-444444444444', k.kind, 'spent', 'succeeded',
       now() - interval '5 hours', 100
from (values ('scenes', 25), ('map', 50), ('drawing', 250), ('moment', 250)) as k(kind, n),
     lateral generate_series(1, k.n);

set role authenticated;
set "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
select 'topup_every_pool_is_exhausted_first' as check,
  (count(*) = 4)::int as n
  from (values ('scenes', 'deck'), ('map', 'draft'), ('drawing', 'drawing'), ('moment', 'light'))
         as g(kind, grp),
       lateral public.captivate_reserve_generation(g.kind, g.grp, 'exhausted', null) r
 where r.refusal = 'allowance';
select 'topup_balance_is_zero_before_buying' as check,
  (public.captivate_credit_balance() = 0)::int as n;
reset role;

insert into public.generation_credits
  (user_id, presentations_granted,
   stripe_checkout_session_id, stripe_payment_intent_id, stripe_event_id, expires_at)
values ('44444444-4444-4444-4444-444444444444', 10,
        'cs_test_topup', 'pi_test_topup', 'evt_test_topup', now() + interval '30 days');

-- Ten complete presentations. The rows are aged between them because the burst
-- ceiling is a *rate* and a credit buys a *quantity*: ten presentations an hour
-- is not what was sold, and raising the rate limit with a purchase would turn
-- abuse protection into something buyable. This is the clock moving, not the
-- ceiling moving.
do $$
declare
  r record;
  v record;
  made int := 0;
  drew int := 0;
  drafted int := 0;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '44444444-4444-4444-4444-444444444444', true);

  for i in 1..10 loop
    select * into r from public.captivate_reserve_generation('scenes', 'deck', 'on credit', null);
    exit when r.id is null;
    made := made + 1;
    -- Settled, because the server settles. A reservation left pending is an
    -- *abandoned* one after fifteen minutes, and the allowance stops counting
    -- it — deliberately, since nothing was made. A credit follows the same
    -- rule, so a loop that reserved and walked away would give every credit
    -- back and prove the opposite of what it set out to.
    perform public.captivate_complete_generation(r.id, 'succeeded', 'claude-sonnet-5', 900, 1800, null);

    select * into v from public.captivate_reserve_generation('map', 'draft', 'on credit', null);
    exit when v.id is null;
    drafted := drafted + 1;
    perform public.captivate_complete_generation(v.id, 'succeeded', 'claude-sonnet-5', 400, 900, null);

    for d in 1..10 loop
      select * into v from public.captivate_reserve_generation('drawing', 'drawing', 'on credit', null);
      exit when v.id is null;
      drew := drew + 1;
      perform public.captivate_complete_generation(v.id, 'succeeded', 'claude-sonnet-5', 200, 400, null);
    end loop;

    -- An hour passes.
    --
    -- Done outside the caller's own privileges, like the abandoned-reservation
    -- probe above: a user may not edit their ledger, which is the whole point
    -- of `complete` existing. Written as the author it silently updates nothing
    -- and the loop stalls at the burst ceiling — which is what happened, and
    -- is a fair summary of why RLS is on.
    set local role postgres;
    update public.ai_generations
       set created_at = created_at - interval '2 hours'
     where owner_id = '44444444-4444-4444-4444-444444444444'
       and created_at > now() - interval '1 hour';
    set local role authenticated;
  end loop;

  create temporary table topup_result as
    select made as presentations, drafted as drafts, drew as drawings;
end $$;
reset role;

select 'topup_buys_ten_complete_presentations' as check,
  (presentations = 10 and drafts = 10 and drawings = 100)::int as n from topup_result;

set role authenticated;
set "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
select 'topup_balance_is_spent' as check,
  (public.captivate_credit_balance() = 0)::int as n;
select 'topup_eleventh_is_refused' as check,
  (id is null and refusal = 'allowance')::int as n
  from public.captivate_reserve_generation('scenes', 'deck', 'eleventh', null);
reset role;

-- ---- A credit is not spent on a call that never happened -----------------------
-- The allowance already behaves this way and nobody had to write it: a call
-- that never reached the model stops counting, so an author is not charged for
-- our downtime. A credit behaves the same way and for the same reason, and it
-- has to survive the forgery 0020 is about: the author settles their own
-- in-flight row as a refund and the server writes the truth a moment later.
insert into public.generation_credits
  (user_id, presentations_granted,
   stripe_checkout_session_id, stripe_event_id, expires_at)
values ('44444444-4444-4444-4444-444444444444', 3,
        'cs_test_refund', 'evt_test_refund', now() + interval '30 days');

set role authenticated;
set "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';

select id from public.captivate_reserve_generation('scenes', 'deck', 'downtime', null) \gset dead_
select 'credit_is_held_while_in_flight' as check,
  (public.captivate_credit_balance() = 2)::int as n;

-- The provider was unreachable: no tokens, nothing made, nothing owed. But the
-- credit is *not* handed back yet — the row is seconds old, and a fresh row
-- counts whatever its owner says about it, because its owner is who settles it.
select public.captivate_complete_generation(
  :'dead_id', 'failed', null, null, null, 'the model could not be reached') \gset dead_settled_
select 'credit_held_through_the_window_a_forgery_lives_in' as check,
  (public.captivate_credit_balance() = 2)::int as n;

-- …and the truthful settlement arriving afterwards leaves it spent, which is
-- the hole 0020 closed for the allowance and this closes for the balance.
select public.captivate_complete_generation(
  :'dead_id', 'succeeded', 'claude-sonnet-5', 1000, 2000, null) \gset dead_truth_
select 'credit_stays_spent_when_the_truth_arrives' as check,
  (public.captivate_credit_balance() = 2)::int as n;
reset role;

-- A genuine failure does get its credit back, once the window an author could
-- have forged inside has passed. Aged as postgres, because an author may not
-- edit their own ledger — which is the entire reason the window exists.
-- Only one live purchase at a time from here on: `captivate_credit_balance` is
-- an account total, so a probe that asserts a number has to be the only thing
-- contributing to it. Retired as the webhook role, which is who revokes.
update public.generation_credits set revoked_at = now(), revoked_reason = 'test setup'
 where user_id = '44444444-4444-4444-4444-444444444444' and revoked_at is null;

insert into public.generation_credits
  (user_id, presentations_granted,
   stripe_checkout_session_id, stripe_event_id, expires_at)
values ('44444444-4444-4444-4444-444444444444', 1,
        'cs_test_outage', 'evt_test_outage', now() + interval '30 days');

set role authenticated;
set "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
select id from public.captivate_reserve_generation('scenes', 'deck', 'outage', null) \gset outage_
select public.captivate_complete_generation(
  :'outage_id', 'failed', null, null, null, 'the model could not be reached') \gset outage_settled_
reset role;

update public.ai_generations set created_at = now() - interval '20 minutes'
 where id = :'outage_id'::uuid;

set role authenticated;
set "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
select 'credit_returned_after_a_real_outage' as check,
  (public.captivate_credit_balance() = 1)::int as n;

-- The balance is bought, not edited. No insert, no update, no reassignment:
-- an author who can write here mints the product.
--
-- Still inside the authenticated role above, deliberately. A `reset role` here
-- would run this as the harness superuser, RLS would be bypassed, and the probe
-- would pass on any row in the table rather than proving an owner can read
-- their own — which is exactly what it silently did for two commits.
select 'credit_sees_own_balance' as check,
  (count(*) >= 1)::int as n from public.generation_credits;
reset role;

set role authenticated;
set "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
select 'bob_sees_alice_credits' as check, count(*) as n from public.generation_credits;
select 'credit_balance_is_per_caller' as check,
  (public.captivate_credit_balance() = 0)::int as n;

do $$
begin
  begin
    insert into public.generation_credits
      (user_id, presentations_granted,
       stripe_checkout_session_id, stripe_event_id, expires_at)
    values ('22222222-2222-2222-2222-222222222222', 1000,
            'cs_self_minted', 'evt_self_minted', now() + interval '99 days');
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.generation_credits set presentations_granted = 1000;
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;

select 'credit_not_self_mintable' as check,
  (count(*) = 0)::int as n from public.generation_credits
  where stripe_checkout_session_id = 'cs_self_minted';
select 'credit_not_self_writable' as check,
  (count(*) = 0)::int as n from public.generation_credits
  where presentations_granted = 1000;

-- ---- A forged failure frees nothing, sequentially or in flight ---------------
-- Two shapes of the same attack, and the second is the one my first fix missed.
--
-- Sequential: spend the credit, forge a zero-token failure on the finished row,
-- and spend the returned credit again. Bounded to one extra presentation.
--
-- In flight: do not wait for anything. Reserve, immediately tell the database
-- the call failed with no tokens, reserve again — all inside the seconds a real
-- provider call takes. Every reservation is a real generation that costs real
-- money, so if a forged failure hands the credit straight back, one purchase
-- funds as many as the burst ceiling allows. Nothing has to be sequenced and
-- nothing has to settle.
--
-- Both are answered by the same rule: a fresh row counts whatever its owner
-- says about it, because its owner is who settles it.
-- Only one live purchase at a time from here on: `captivate_credit_balance` is
-- an account total, so a probe that asserts a number has to be the only thing
-- contributing to it. Retired as the webhook role, which is who revokes.
update public.generation_credits set revoked_at = now(), revoked_reason = 'test setup'
 where user_id = '44444444-4444-4444-4444-444444444444' and revoked_at is null;

insert into public.generation_credits
  (user_id, presentations_granted,
   stripe_checkout_session_id, stripe_event_id, expires_at)
values ('44444444-4444-4444-4444-444444444444', 1,
        'cs_test_launder', 'evt_test_launder', now() + interval '30 days');

do $$
declare
  a uuid;
  b uuid;
  c uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '44444444-4444-4444-4444-444444444444', true);

  -- The one purchase, spent.
  select id into a from public.captivate_reserve_generation('scenes', 'deck', 'bought', null);

  -- Forge a refund on it while it is still in flight, then try to spend again.
  perform public.captivate_complete_generation(a, 'failed', null, null, null, 'forged');
  select id into b from public.captivate_reserve_generation('scenes', 'deck', 'in flight', null);

  -- And again after the truth lands, which is the sequential shape.
  perform public.captivate_complete_generation(a, 'succeeded', 'claude-sonnet-5', 10, 20, null);
  select id into c from public.captivate_reserve_generation('scenes', 'deck', 'sequential', null);

  create temporary table launder_result as
    select a is not null as the_purchase_was_spendable,
           b is null     as in_flight_forgery_freed_nothing,
           c is null     as sequential_forgery_freed_nothing,
           public.captivate_credit_balance() as balance;
end $$;
reset role;

select 'credit_forgery_frees_nothing' as check,
  (the_purchase_was_spendable
   and in_flight_forgery_freed_nothing
   and sequential_forgery_freed_nothing
   and balance = 0)::int as n
  from launder_result;

-- ---- A bought presentation can still be finished after its credit expires ----
-- The guarantee is that one credit covers a whole presentation: the map, the
-- scenes, the drawings. Keying the auxiliary headroom on the *purchase* being
-- live broke that at the boundary — a deck admitted an hour before expiry
-- outlives its credit by minutes, and the drawings it needs were then refused
-- with the deck already made and the money already gone. The headroom follows
-- the admitted presentation instead.
do $$
declare
  v_deck uuid;
  v_drawing uuid;
begin
  set local role postgres;
  update public.generation_credits set revoked_at = now(), revoked_reason = 'test setup'
   where user_id = '44444444-4444-4444-4444-444444444444' and revoked_at is null;

  insert into public.generation_credits
    (user_id, presentations_granted,
     stripe_checkout_session_id, stripe_event_id, expires_at)
  values ('44444444-4444-4444-4444-444444444444', 1,
          'cs_test_boundary', 'evt_test_boundary', now() + interval '30 days');

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '44444444-4444-4444-4444-444444444444', true);
  select id into v_deck from public.captivate_reserve_generation('scenes', 'deck', 'bought', null);
  perform public.captivate_complete_generation(v_deck, 'succeeded', 'claude-sonnet-5', 10, 20, null);

  -- The purchase runs out a moment after the deck was made.
  set local role postgres;
  update public.generation_credits set expires_at = now() - interval '1 minute'
   where stripe_checkout_session_id = 'cs_test_boundary';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '44444444-4444-4444-4444-444444444444', true);
  select id into v_drawing
    from public.captivate_reserve_generation('drawing', 'drawing', 'illustrating it', null);

  create temporary table boundary_result as
    select v_deck is not null as deck_was_bought,
           v_drawing is not null as it_can_still_be_illustrated;
end $$;
reset role;

select 'credit_backed_deck_keeps_its_headroom_past_expiry' as check,
  (deck_was_bought and it_can_still_be_illustrated)::int as n from boundary_result;

-- ---- The plan's own allowance still renews while credits are spent ------------
-- A credit-backed presentation is not drawn from the plan, so it must not be
-- counted against the plan. Counting every deck together meant an author who
-- bought ten credits and spent them sat at 35 against an allowance of 25 — and
-- when their oldest base-allowance deck aged out of the rolling window, the slot
-- it freed was invisible. The count was still over, so a credit was looked for,
-- and there were none. A renewed allowance, refused, with nothing to buy that
-- would fix it.
do $$
declare
  r record;
begin
  -- One base-allowance deck falls out of the 30-day window. Done as postgres:
  -- an author may not edit their own ledger, which is why `complete` exists.
  set local role postgres;
  update public.ai_generations
     set created_at = now() - interval '31 days'
   where id = (select g.id from public.ai_generations g
                where g.owner_id = '44444444-4444-4444-4444-444444444444'
                  and g.kind = 'scenes'
                  and g.credit_id is null
                  and g.created_at > now() - interval '30 days'
                order by g.created_at
                limit 1);

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',
                     '44444444-4444-4444-4444-444444444444', true);
  select * into r from public.captivate_reserve_generation('scenes', 'deck', 'renewed', null);

  create temporary table renewal_result as
    select r.id is not null as admitted,
           (select g.credit_id is null from public.ai_generations g where g.id = r.id) as on_the_plan;
end $$;
reset role;

select 'allowance_renews_independently_of_credits' as check,
  (admitted and on_the_plan)::int as n from renewal_result;

-- Expired and revoked balances are not "left". A refund or a chargeback takes
-- the credits back; an expiry is the stated life the copy promised.
-- Only one live purchase at a time from here on: `captivate_credit_balance` is
-- an account total, so a probe that asserts a number has to be the only thing
-- contributing to it. Retired as the webhook role, which is who revokes.
update public.generation_credits set revoked_at = now(), revoked_reason = 'test setup'
 where user_id = '44444444-4444-4444-4444-444444444444' and revoked_at is null;

insert into public.generation_credits
  (user_id, presentations_granted,
   stripe_checkout_session_id, stripe_event_id, expires_at)
values ('44444444-4444-4444-4444-444444444444', 5,
        'cs_test_lifetime', 'evt_test_lifetime', now() + interval '30 days');

update public.generation_credits set expires_at = now() - interval '1 day'
 where stripe_checkout_session_id = 'cs_test_lifetime';
set role authenticated;
set "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
select 'credit_expired_is_not_spendable' as check,
  (public.captivate_credit_balance() = 0)::int as n;
select 'credit_expired_does_not_raise_the_ceiling' as check,
  (id is null and refusal = 'allowance')::int as n
  from public.captivate_reserve_generation('scenes', 'deck', 'after expiry', null);
reset role;

update public.generation_credits
   set expires_at = now() + interval '30 days',
       revoked_at = now(), revoked_reason = 'refund'
 where stripe_checkout_session_id = 'cs_test_lifetime';
set role authenticated;
set "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
select 'credit_revoked_is_not_spendable' as check,
  (public.captivate_credit_balance() = 0)::int as n;
select 'credit_revoked_does_not_raise_the_ceiling' as check,
  (id is null and refusal = 'allowance')::int as n
  from public.captivate_reserve_generation('scenes', 'deck', 'after refund', null);
reset role;

-- Nothing about a credit is reachable signed out. The balance function is not
-- published to `anon` at all, and the table's only policy is scoped to
-- `authenticated`, so a signed-out reader sees nothing whatever exists.
select 'credit_anon_cannot_execute_captivate_credit_balance' as check,
  (not has_function_privilege('anon', 'public.captivate_credit_balance()', 'EXECUTE'))::int as n;
set role anon;
select 'anon_sees_credits' as check, count(*) as n from public.generation_credits;
reset role;
