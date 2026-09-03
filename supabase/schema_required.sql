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
  ('column',   'public.ai_generations.provider',       'which gateway a ledger row was paid to'),

  -- Functions, with their argument lists: a signature change is as breaking
  -- as an absence, and PostgREST resolves `rpc/<name>` by signature.
  ('function', 'public.captivate_owns_presentation(uuid)',                        'every ownership check'),
  ('function', 'public.captivate_shared_presentation(uuid)',                      'share links'),
  ('function', 'public.captivate_shared_asset(uuid)',                             'images on a shared deck'),
  ('function', 'public.captivate_asset_object_is_shared(text)',                   'storage for a shared deck'),
  ('function', 'public.captivate_replace_moments(uuid,jsonb)',                    'the narrative map'),
  ('function', 'public.captivate_set_scene_placements(uuid,jsonb)',               'the world canvas'),
  -- Four arguments, not six. The window and the ceiling were arguments until
  -- 0022, and that is precisely why they had to go: PostgREST resolves
  -- `rpc/<name>` by signature, so a caller could name its own ceiling. If the
  -- six-argument form ever reappears here, something has re-opened it.
  ('function', 'public.captivate_reserve_generation(text,text,text,uuid)',        'every AI call'),
  ('function', 'public.captivate_current_plan()',                                 'every AI call'),
  ('function', 'public.captivate_budget_kinds(text)',                             'every AI call'),
  ('function', 'public.captivate_per_presentation(text)',                         'top-up credits'),
  ('function', 'public.captivate_credit_spent(uuid)',                             'top-up credits'),
  ('function', 'public.captivate_credit_balance()',                               'the credit balance in settings'),
  ('function', 'public.captivate_complete_generation(uuid,text,text,integer,integer,text)', 'AI spend accounting'),
  ('function', 'public.captivate_reserve_image_generation(text,uuid)', 'image generation'),
  ('function', 'public.captivate_settle_image_generation(uuid,text,text,integer,text)', 'the image budget'),
  ('function', 'public.captivate_remote_topic_open(text)',                         'the phone remote'),
  ('table',    'public.plan_budgets',                                             'every AI call'),
  ('table',    'public.generation_credits',                                       'top-up credits'),
  ('table',    'public.ai_model_rates',                                           'what a generation cost'),
  ('column',   'public.subscriptions.plan',                                       'which tier a subscription grants'),
  -- Without it every webhook collision reads as a finished duplicate, so a
  -- delivery whose work failed is answered 200 and never retried.
  ('column',   'public.stripe_events.completed_at',                               'retrying a webhook whose work failed');

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
                     'recordings','moments','ai_generations','presentation_sessions','profiles',
                     -- Bought presentations. Owner-scoped like the rest, and the
                     -- one whose loss would let anybody read what anybody else
                     -- paid for.
                     'generation_credits')
   and not c.relrowsecurity;

-- `generation_credits` is readable by its owner and writable by nobody: the
-- balance is bought, not edited. An insert policy would let an author mint the
-- product outright and an update policy would let them refill it, so the check
-- is not "has a policy" but "has exactly the one".
--
-- And "owner-only" is a claim about *who* and *which rows*, not only about
-- which verb. A single policy reading `for select to public using (true)`
-- satisfies "exactly one, and it is a SELECT" while handing every signed-in
-- caller every customer's purchase history, so the roles and the predicate are
-- checked too — the predicate by looking for the owner comparison in it rather
-- than by matching an exact string, because Postgres normalises what it stores
-- and an equality test on the text would fail on a correct policy written with
-- the operands the other way round.
select 'MISSING owner-only select on public.generation_credits' ||
       '   → breaks: a credit balance nobody can read, or one anybody can read'
 where (select count(*) from pg_policies
         where schemaname = 'public' and tablename = 'generation_credits') <> 1
    or not exists (select 1 from pg_policies
                    where schemaname = 'public'
                      and tablename = 'generation_credits'
                      and cmd = 'SELECT'
                      -- Not `public`, and not a role list that includes it.
                      and roles = '{authenticated}'::name[]
                      and qual is not null
                      and qual like '%auth.uid()%'
                      and qual like '%user_id%');

-- Two tables belong to the deployment rather than to any user, and their
-- protection is the *absence* of a policy: RLS on with nothing granting access,
-- so only a definer function and the service role can reach them. Checking that
-- they exist is not enough — `ai_image_limits` holds the price and the ceilings
-- the reservation reads, so a policy added to it hands every signed-in caller
-- the numbers `0021` exists to stop them choosing, and a deployment missing RLS
-- on it would still certify as complete.
select 'MISSING row level security on public.' || c.relname ||
       '   → breaks: the deployment-owned ceilings are readable'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and c.relname in ('ai_image_limits','stripe_events',
                     -- What every plan allows, and what a model costs. Both are
                     -- read by definer functions and by nothing else: a policy
                     -- on `plan_budgets` hands every caller the ceilings 0022
                     -- exists to stop them choosing, and one on `ai_model_rates`
                     -- lets them price their own usage at zero.
                     'plan_budgets','ai_model_rates')
   and not c.relrowsecurity;

select 'MISSING policy-free access control on public.' || tablename ||
       '   → breaks: ' || policyname || ' exposes a deployment-owned table'
  from pg_policies
 where schemaname = 'public'
   and tablename in ('ai_image_limits','stripe_events','plan_budgets','ai_model_rates');

-- Some things must be *absent*, and presence is not the same question as
-- absence when Postgres allows overloading. `0021` drops the reservation's old
-- five-argument form deliberately: leaving it callable would leave the hole
-- open, because it still takes the price and both ceilings from the caller.
-- Asserting only that the two-argument form exists would certify a database
-- carrying both — which is exactly what a `create or replace` with fewer
-- arguments produces, and what a half-applied migration leaves behind.
-- Identified by type signature, like every other function in this file, and
-- not by the text of its arguments: parameter *names* are part of that text, so
-- comparing it would flag a correct two-argument function whose parameters were
-- renamed — reporting the one function that must exist as the one that must
-- not, while the required-objects check above passes it in the same run.
select 'FORBIDDEN function public.' || p.proname ||
       '(' || pg_get_function_identity_arguments(p.oid) || ')' ||
       '   → keeps: a caller-priced reservation against the shared budget'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'captivate_reserve_image_generation'
   and p.oid is distinct from
       to_regprocedure('public.captivate_reserve_image_generation(text,uuid)');

-- The same question about the text reservation, and the same answer. `0022`
-- drops the six-argument form because it took its window and its ceiling as
-- arguments — and PostgREST resolves `rpc/<name>` by signature, so as long as
-- that form is callable an authenticated caller can name its own limits no
-- matter what the four-argument one enforces. Requiring the new signature does
-- not reject a database that still carries the old one beside it, which a
-- half-applied migration is exactly how you get.
select 'FORBIDDEN function public.' || p.proname ||
       '(' || pg_get_function_identity_arguments(p.oid) || ')' ||
       '   → keeps: a reservation whose ceiling the caller chooses'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'captivate_reserve_generation'
   and p.oid is distinct from
       to_regprocedure('public.captivate_reserve_generation(text,text,text,uuid)');
