\set ON_ERROR_STOP on
-- Grant the table privileges Supabase normally grants; RLS is the actual gate.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

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
