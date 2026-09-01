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

-- Two reservations against a limit of two: both issued.
select 'reserve_within_limit' as check,
  (public.captivate_reserve_generation('probe', array['probe'], 'first', null, 60, 2)
     is not null)::int as n;
select 'reserve_second_within_limit' as check,
  (public.captivate_reserve_generation('probe', array['probe'], 'second', null, 60, 2)
     is not null)::int as n;

-- The third is refused, and refused *before* anything is spent — the point of
-- reserving rather than recording.
select 'reserve_beyond_limit_refused' as check,
  (public.captivate_reserve_generation('probe', array['probe'], 'third', null, 60, 2)
     is null)::int as n;

-- Naming someone else's deck attributes the row to no deck rather than to
-- theirs: the function runs as definer, so RLS is not there to catch it.
select public.captivate_reserve_generation(
  'probe_other', array['probe_other'], 'foreign-deck',
  'bbbbbbbb-0000-0000-0000-000000000001', 60, 5) \gset foreign_
select 'reserve_foreign_deck_unattributed' as check,
  (presentation_id is null)::int as n
  from public.ai_generations where id = :'foreign_captivate_reserve_generation';

-- …and naming its own owner's deck is attributed normally, so the check above
-- is about ownership rather than the parameter being ignored.
select public.captivate_reserve_generation(
  'probe_other', array['probe_other'], 'own-deck',
  'aaaaaaaa-0000-0000-0000-000000000001', 60, 5) \gset own_
select 'reserve_own_deck_attributed' as check,
  (presentation_id = 'aaaaaaaa-0000-0000-0000-000000000001')::int as n
  from public.ai_generations where id = :'own_captivate_reserve_generation';

-- Completing moves pending to terminal, once.
select 'complete_own_pending' as check,
  (public.captivate_complete_generation(
     (select id from public.ai_generations
       where kind = 'probe' and prompt = 'first'),
     'succeeded', 'test-model', 10, 20, null))::int as n;
select 'complete_is_not_replayable' as check,
  (not public.captivate_complete_generation(
     (select id from public.ai_generations
       where kind = 'probe' and prompt = 'first'),
     'succeeded', 'test-model', 10, 20, null))::int as n;

-- And it cannot rewind a row to pending, which is how you would stop it
-- counting against you.
select 'complete_cannot_reopen' as check,
  (not public.captivate_complete_generation(
     (select id from public.ai_generations
       where kind = 'probe' and prompt = 'second'),
     'pending', null, null, null, null))::int as n;

-- A completed row still counts, so the limit holds after the work is done.
select 'reserve_still_refused_after_completing' as check,
  (public.captivate_reserve_generation('probe', array['probe'], 'fourth', null, 60, 2)
     is null)::int as n;

-- ---- What a reservation is allowed to cost the caller --------------------------
-- Two things were being charged to an allowance that were never delivered.
--
-- A reservation abandoned by a killed function: `/api/ai/map` ran with a
-- 60-second ceiling while the model call was given three minutes, so the
-- platform killed the function mid-generation and nothing ever settled the
-- row. It stayed pending, and on the free plan — ten decks in thirty days —
-- each such 504 took one of them away for the full thirty days.
select public.captivate_reserve_generation('stale', array['stale'], 'abandoned', null, 60, 5)
  \gset stale_
reset role;
-- Aged from outside the caller's own privileges: a user must not be able to
-- edit their ledger, which is why `complete` exists at all. This is the test
-- harness standing in for thirty minutes passing.
update public.ai_generations set created_at = now() - interval '30 minutes'
 where id = :'stale_captivate_reserve_generation';
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

select 'reserve_abandoned_pending_stops_counting' as check,
  (public.captivate_count_generations(array['stale'], 60) = 0)::int as n;

-- …but one still in flight holds its place, or the lock would be pointless.
-- Each of these reserves in its own statement: the counter is `stable`, so
-- within one statement it reads the snapshot taken before the insert and would
-- report zero however the rule was written.
select public.captivate_reserve_generation('fresh', array['fresh'], 'running', null, 60, 5)
  \gset fresh_
select 'reserve_in_flight_pending_still_counts' as check,
  (public.captivate_count_generations(array['fresh'], 60) = 1)::int as n;

-- A call that never reached the model spent nothing and made nothing, so it is
-- not charged. Billing it is charging the author for our own downtime.
select public.captivate_reserve_generation('dud', array['dud'], 'provider down', null, 60, 5)
  \gset dud_
select public.captivate_complete_generation(
  :'dud_captivate_reserve_generation', 'failed', null, null, null,
  'the model could not be reached') \gset dud_settled_
select 'failed_without_spend_does_not_count' as check,
  (public.captivate_count_generations(array['dud'], 60) = 0)::int as n;

-- A near-miss did reach it, twice, and is charged. The provider records the
-- usage on the failure for exactly this reason.
select public.captivate_reserve_generation('spent', array['spent'], 'truncated', null, 60, 5)
  \gset spent_
select public.captivate_complete_generation(
  :'spent_captivate_reserve_generation', 'failed', 'test-model', 9000, 9000,
  'the answer was cut off') \gset spent_settled_
select 'failed_with_spend_counts' as check,
  (public.captivate_count_generations(array['spent'], 60) = 1)::int as n;

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
select public.captivate_reserve_generation('forge', array['forge'], 'unlimited', null, 60, 5)
  \gset forge_
select 'ledger_forged_refund_is_accepted' as check,
  (public.captivate_complete_generation(
     :'forge_captivate_reserve_generation', 'failed', null, 0, 0, 'nothing to see'))::int as n;
select 'ledger_server_truth_supersedes_forgery' as check,
  (public.captivate_complete_generation(
     :'forge_captivate_reserve_generation', 'succeeded', 'test-model', 900, 5000, null))::int as n;
select 'ledger_forged_refund_does_not_free_allowance' as check,
  (public.captivate_count_generations(array['forge'], 60) = 1)::int as n;

-- …and once spend is recorded, it cannot be taken back off.
select 'ledger_settled_spend_is_final' as check,
  (not public.captivate_complete_generation(
     :'forge_captivate_reserve_generation', 'failed', null, 0, 0, 'refund me'))::int as n;

-- The state that is neither: a near-miss the provider never reported usage for
-- records no spend and still counts, because only a *failed* call with no
-- tokens is skipped. A rule keyed on "recorded no spend" would leave this row
-- rewritable and hand the forgery back — after the server had already written
-- the truth. What may be rewritten is the non-counting state itself, nothing
-- wider.
select public.captivate_reserve_generation('nearmiss', array['nearmiss'], 'no usage', null, 60, 5)
  \gset nearmiss_
select 'ledger_nearmiss_without_usage_counts' as check,
  (public.captivate_complete_generation(
     :'nearmiss_captivate_reserve_generation', 'invalid_output', 'test-model', null, null, 'unreadable')
   and public.captivate_count_generations(array['nearmiss'], 60) = 1)::int as n;
select 'ledger_counting_row_is_final_even_with_no_tokens' as check,
  (not public.captivate_complete_generation(
     :'nearmiss_captivate_reserve_generation', 'failed', null, 0, 0, 'refund me'))::int as n;
select 'ledger_nearmiss_still_counts_after_forgery' as check,
  (public.captivate_count_generations(array['nearmiss'], 60) = 1)::int as n;
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
       where kind = 'probe' and prompt = 'second'),
     'succeeded', 'stolen', 1, 1, null))::int as n;
reset role;

select 'alice_reservation_still_pending' as check,
  (select (status = 'pending')::int from public.ai_generations
    where kind = 'probe' and prompt = 'second') as n;

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

-- Settling records how the call went, once — and does not restate the price.
select 'image_settle_own_pending' as check,
  (public.captivate_settle_image_generation(
     :'first_id'::uuid, 'succeeded', 'test-image-model', 4200, null))::int as n;
select 'image_settle_is_not_replayable' as check,
  (not public.captivate_settle_image_generation(
     :'first_id'::uuid, 'succeeded', 'test-image-model', 1, null))::int as n;
-- The estimate the reservation checked against the budget is the figure that
-- stands. Letting a settlement rewrite it let a caller zero their own cost and
-- free the shared monthly budget, or inflate it and exhaust it for everybody.
select 'image_settled_cost_is_the_reserved_estimate' as check,
  (select (cost_usd = 0.05 and duration_ms = 4200)::int
     from public.ai_generations where id = :'first_id'::uuid) as n;
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
