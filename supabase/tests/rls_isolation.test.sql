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

-- ---- Shared-link assets ------------------------------------------------------
-- A shared deck's scene content can reference uploaded media. The RPC that
-- resolves it — and the storage read it depends on — must follow the same
-- token-gated shape as the deck itself: readable while shared, dead the
-- instant the link is revoked, and never reachable through someone else's
-- unshared deck.
set role authenticated;
set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
insert into public.assets (id, presentation_id, storage_path, kind, mime_type, byte_size) values
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111/asset1.png', 'image', 'image/png', 1024);
insert into storage.objects (bucket_id, name, owner) values
  ('assets', '11111111-1111-1111-1111-111111111111/asset1.png', '11111111-1111-1111-1111-111111111111');

reset role;

set role authenticated;
set "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';

select 'bob_sees_alice_folders'     as check, count(*) as n from public.folders;
select 'bob_sees_alice_assets'      as check, count(*) as n from public.assets;
select 'bob_sees_alice_recordings'  as check, count(*) as n from public.recordings;
select 'bob_sees_alice_generations' as check, count(*) as n from public.ai_generations;
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
insert into public.assets (id, presentation_id, storage_path, kind, mime_type, byte_size) values
  ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
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
