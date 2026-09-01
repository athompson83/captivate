-- ---------------------------------------------------------------------------
-- What the application requires the database to have.
--
-- Twice now a migration has existed in this repository and not in production,
-- and both times it looked like a code bug: `captivate_reserve_generation` was
-- missing, so every AI call failed closed ("the AI didn't work"), and later
-- `captivate_reserve_image_generation` and every provenance column were
-- missing, so image generation and stock search would have done the same.
--
-- Nothing caught either. The build was green; the unit suite was green; the
-- RLS suite was green *because* it applies every migration to a scratch
-- database first. Every check ran against a database that was not the one
-- serving users.
--
-- This asserts the objects themselves rather than the migration ledger's
-- names, because the names do not survive the trip: Supabase records `0001` as
-- two rows, `0004` as two more, and `0008_search_path` as
-- `captivate_harden_functions`. Matching those by name produces false alarms,
-- and a check that cries wolf is worse than no check at all.
--
-- Each entry names the feature that breaks without it, because the question
-- being answered at deploy time is "what will users find broken", not "which
-- file is missing".
--
--   SUPABASE_DB_URL=postgres://... npm run migrations:check
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
\pset footer off

create temporary table required (
  kind    text not null,
  ident   text not null,
  feature text not null
);

insert into required (kind, ident, feature) values
  -- Core document
  ('table',    'public.presentations',                 'everything'),
  ('table',    'public.scenes',                        'everything'),
  ('table',    'public.sections',                      'movements'),
  ('table',    'public.assets',                        'images and video'),
  ('table',    'public.lecture_notes',                 'lecture notes'),
  ('table',    'public.recordings',                    'recording'),
  ('table',    'public.moments',                       'the narrative map'),
  ('table',    'public.ai_generations',                'AI spend accounting'),
  ('table',    'public.ai_image_limits',               'the ceilings the reservation reads'),
  ('table',    'public.presentation_sessions',         'the phone remote'),

  -- Columns a feature reads or writes by name
  ('column',   'public.presentations.target_seconds',  'rehearsal targets'),
  ('column',   'public.presentations.share_token',     'share links'),
  ('column',   'public.sections.label',                'movement names on stage'),
  ('column',   'public.sections.purpose',              'the narrative map'),
  ('column',   'public.scenes.moment_id',              'the narrative map'),
  ('column',   'public.scenes.flow_role',              'asides and hotspots'),
  ('column',   'public.recordings.transcript',         'subtitles'),
  ('column',   'public.assets.source',                 'stock search and image generation'),
  ('column',   'public.assets.provider',               'photographer credit'),
  ('column',   'public.assets.creator_name',           'photographer credit'),
  ('column',   'public.assets.license_ref',            'photographer credit'),
  ('column',   'public.assets.prompt',                 'generated-image provenance'),
  ('column',   'public.assets.model',                  'generated-image provenance'),
  ('column',   'public.ai_generations.cost_usd',       'the image budget ceiling'),
  ('column',   'public.ai_generations.duration_ms',    'provider latency review'),

  -- Functions, with their argument lists: a signature change is as breaking
  -- as an absence, and PostgREST resolves `rpc/<name>` by signature.
  ('function', 'public.captivate_owns_presentation(uuid)',                        'every ownership check'),
  ('function', 'public.captivate_shared_presentation(uuid)',                      'share links'),
  ('function', 'public.captivate_shared_asset(uuid)',                             'images on a shared deck'),
  ('function', 'public.captivate_asset_object_is_shared(text)',                   'storage for a shared deck'),
  ('function', 'public.captivate_replace_moments(uuid,jsonb)',                    'the narrative map'),
  ('function', 'public.captivate_set_scene_placements(uuid,jsonb)',               'the world canvas'),
  ('function', 'public.captivate_reserve_generation(text,text[],text,uuid,integer,integer)', 'every AI call'),
  ('function', 'public.captivate_complete_generation(uuid,text,text,integer,integer,text)',  'AI spend accounting'),
  ('function', 'public.captivate_reserve_image_generation(text,uuid)', 'image generation'),
  ('function', 'public.captivate_settle_image_generation(uuid,text,text,integer,text)', 'the image budget'),
  ('function', 'public.captivate_remote_topic_open(text)',                         'the phone remote');

with checked as (
  select r.*,
         case r.kind
           when 'table' then to_regclass(r.ident) is not null
           when 'column' then exists (
             select 1 from information_schema.columns c
              where c.table_schema = split_part(r.ident, '.', 1)
                and c.table_name   = split_part(r.ident, '.', 2)
                and c.column_name  = split_part(r.ident, '.', 3))
           when 'function' then to_regprocedure(r.ident) is not null
         end as present
    from required r
)
select case when present then 'ok      ' else 'MISSING ' end || kind || ' ' || ident ||
       case when present then '' else '   → breaks: ' || feature end
  from checked
 order by present, kind, ident;

-- Every owner-scoped table must still have RLS on. A table that lost it is a
-- tenant-isolation failure, not a missing feature, so it is checked here too.
select 'MISSING row level security on public.' || c.relname || '   → breaks: tenant isolation'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and c.relname in ('presentations','scenes','sections','assets','lecture_notes',
                     'recordings','moments','ai_generations','presentation_sessions','profiles')
   and not c.relrowsecurity;
