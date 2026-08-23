\set ON_ERROR_STOP on
-- Grant the table privileges Supabase normally grants; RLS is the actual gate.
-- anon gets the same select grants it holds on a real Supabase project: every
-- policy is scoped `to authenticated`, so those grants must still yield
-- nothing — which is exactly what the anon probes below assert.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on schema public to anon;
grant select on all tables in schema public to anon;

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
