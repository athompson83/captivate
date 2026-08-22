-- The narrative map.
--
-- A presentation stops being a bag of scenes with an outline thrown away after
-- generation. It becomes an argument: ordered *movements*, each holding ordered
-- *moments* that state what they are for before anything is rendered. Scene
-- generation reads this; it is the contract, not a picture of the result.
--
-- Two decisions worth recording:
--
-- 1. A movement is a `sections` row. Sections already carry ordering, a short
--    label, owner-scoped policies and every foreign key the scenes depend on,
--    and the movement rail is already derived from them. Renaming the table to
--    match the interface would be migration risk bought for nothing, so the
--    database keeps `sections` and the product says Movement.
--
-- 2. A moment is a new table. Nothing existing could serve as the canonical
--    pre-generation entity — the AI outline was transient and discarded once
--    scenes existed, which is exactly the problem this fixes.

/* Movements gain the one field they were missing. -------------------------- */

alter table public.sections
  add column if not exists purpose text not null default ''
    check (char_length(purpose) <= 600);

comment on column public.sections.purpose is
  'What this stretch of the argument accomplishes. A movement, in product terms.';

/* Moments ------------------------------------------------------------------ */

create table if not exists public.moments (
  id                 uuid primary key default gen_random_uuid(),
  presentation_id    uuid not null references public.presentations(id) on delete cascade,
  -- Null is a real state: a moment that has not been placed in a movement yet.
  -- `on delete set null` so deleting a movement never destroys the argument
  -- inside it; the moments survive and are reassigned.
  movement_id        uuid references public.sections(id) on delete set null,
  position           integer not null default 0,
  title              text not null default '' check (char_length(title) <= 160),
  role               text not null default 'claim' check (char_length(role) <= 32),
  purpose            text not null default '' check (char_length(purpose) <= 600),
  takeaway           text not null default '' check (char_length(takeaway) <= 600),
  estimated_seconds  integer not null default 0
                       check (estimated_seconds between 0 and 3600),
  -- References to assets and lecture notes that already exist. Stored as
  -- validated jsonb rather than a join table: an evidence reference is part of
  -- the moment's definition, is always read with it, and is never queried
  -- across presentations.
  evidence           jsonb not null default '[]'::jsonb,
  visual_intent      text not null default 'auto' check (char_length(visual_intent) <= 32),
  instructions       text not null default '' check (char_length(instructions) <= 1200),
  locked             boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists moments_presentation_idx
  on public.moments (presentation_id, position);
create index if not exists moments_movement_idx on public.moments (movement_id);

create trigger moments_touch
  before update on public.moments
  for each row execute function public.captivate_touch_updated_at();

alter table public.moments enable row level security;

-- Owner-scoped through the presentation, exactly like sections and scenes.
create policy "moments_select_own" on public.moments
  for select to authenticated using (public.captivate_owns_presentation(presentation_id));
create policy "moments_insert_own" on public.moments
  for insert to authenticated with check (public.captivate_owns_presentation(presentation_id));
create policy "moments_update_own" on public.moments
  for update to authenticated
  using (public.captivate_owns_presentation(presentation_id))
  with check (public.captivate_owns_presentation(presentation_id));
create policy "moments_delete_own" on public.moments
  for delete to authenticated using (public.captivate_owns_presentation(presentation_id));

/* Scenes remember where they came from -------------------------------------- */

-- `on delete set null`: deleting a moment must not delete the work generated
-- from it. The scene becomes unattached and the author decides what to do.
alter table public.scenes
  add column if not exists moment_id uuid references public.moments(id) on delete set null;

create index if not exists scenes_moment_idx on public.scenes (moment_id);

comment on column public.scenes.moment_id is
  'The narrative moment this scene was generated from. Null for hand-made scenes.';

/* Applying a whole map is one statement ------------------------------------- */

-- Accepting a narrative map rewrites every moment in a presentation. Doing it
-- row by row would leave the argument half-applied if anything failed midway,
-- and a half-applied argument is worse than either whole one.
--
-- SECURITY INVOKER, like the placement writer: the owner-scoped policy on
-- public.moments is exactly the check this needs, so it runs as the caller and
-- inherits it rather than re-implementing it.
create or replace function public.captivate_replace_moments(
  p_presentation_id uuid,
  p_moments jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  written integer;
begin
  -- Locked moments are the author's, not the generator's. They survive a
  -- replace untouched, and anything referencing them keeps working.
  delete from public.moments m
   where m.presentation_id = p_presentation_id
     and m.locked = false
     and m.id not in (
       select (elem->>'id')::uuid from jsonb_array_elements(p_moments) as elem
     );

  insert into public.moments (
    id, presentation_id, movement_id, position, title, role, purpose, takeaway,
    estimated_seconds, evidence, visual_intent, instructions, locked
  )
  select
    (elem->>'id')::uuid,
    p_presentation_id,
    nullif(elem->>'movementId', '')::uuid,
    coalesce((elem->>'position')::integer, 0),
    coalesce(elem->>'title', ''),
    coalesce(elem->>'role', 'claim'),
    coalesce(elem->>'purpose', ''),
    coalesce(elem->>'takeaway', ''),
    coalesce((elem->>'estimatedSeconds')::integer, 0),
    coalesce(elem->'evidence', '[]'::jsonb),
    coalesce(elem->>'visualIntent', 'auto'),
    coalesce(elem->>'instructions', ''),
    coalesce((elem->>'locked')::boolean, false)
  from jsonb_array_elements(p_moments) as elem
  on conflict (id) do update set
    movement_id       = excluded.movement_id,
    position          = excluded.position,
    title             = excluded.title,
    role              = excluded.role,
    purpose           = excluded.purpose,
    takeaway          = excluded.takeaway,
    estimated_seconds = excluded.estimated_seconds,
    evidence          = excluded.evidence,
    visual_intent     = excluded.visual_intent,
    instructions      = excluded.instructions,
    locked            = excluded.locked
  -- A locked moment is never overwritten, even by an explicit replace.
  where public.moments.locked = false;

  get diagnostics written = row_count;
  return written;
end;
$$;

revoke all on function public.captivate_replace_moments(uuid, jsonb) from public;
grant execute on function public.captivate_replace_moments(uuid, jsonb) to authenticated;
