-- Captivate: the world canvas.
--
-- A presentation stops being an ordered list of slides and becomes a single
-- unbounded canvas that a camera moves across. Two additive columns carry it:
-- where each scene sits in the world, and how the camera should behave.
--
-- Both are nullable / defaulted, so every existing presentation keeps working:
-- a scene with no placement is positioned by the deck's arrangement at read
-- time, which reproduces the previous left-to-right behaviour exactly.

alter table public.scenes
  add column if not exists placement jsonb;

comment on column public.scenes.placement is
  'World placement {x, y, scale, rotation} in stage units. Null = derive from position.';

alter table public.presentations
  add column if not exists journey jsonb not null default
    '{"arrangement":"reel","travel":"fly","pace":1.1,"establishSections":true,"showPath":true,"depth":0.55}'::jsonb;

comment on column public.presentations.journey is
  'Camera behaviour for this presentation: arrangement, travel style, pace.';

-- Placement is read for every scene of a presentation on every present and
-- every map render, and written in bulk when an arrangement is applied. No
-- index is needed beyond the existing (presentation_id, position).

-- RLS: both columns live on tables that already have owner-scoped policies
-- covering all four verbs, and column-level grants are not used, so the new
-- columns inherit that protection. Nothing further to add here — but this note
-- exists because "adding a table means adding its policies in the same
-- migration", and the reason this migration adds none should be explicit.

-- Applying an arrangement rewrites the placement of every scene in a deck.
-- Doing that as one statement rather than N round trips keeps a 60-scene
-- presentation responsive, and keeps the whole rearrangement atomic: a partial
-- apply would leave scenes scattered between two layouts.
--
-- SECURITY INVOKER, deliberately. The owner-scoped RLS policy on public.scenes
-- is exactly the check this needs, so the function runs as the caller and
-- inherits it. A SECURITY DEFINER function here would have to re-implement
-- that check by hand, and would be a privilege-escalation bug the first time
-- someone got the re-implementation wrong.
create or replace function public.captivate_set_scene_placements(
  p_presentation_id uuid,
  p_placements jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated integer;
begin
  update public.scenes s
     set placement = e.placement
    from (
      select (elem->>'id')::uuid as id,
             elem->'placement'   as placement
        from jsonb_array_elements(p_placements) as elem
    ) e
   where s.id = e.id
     and s.presentation_id = p_presentation_id;

  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function public.captivate_set_scene_placements(uuid, jsonb) from public;
grant execute on function public.captivate_set_scene_placements(uuid, jsonb) to authenticated;

-- New scenes no longer carry a per-scene transition: the camera move between
-- scenes is the transition now, and it is configured once for the whole
-- presentation. Stored content that still has the old key parses fine — the
-- schema simply drops it.
alter table public.scenes
  alter column content set default
    '{"version":1,"layout":"custom","background":{"kind":"theme"},"elements":[],"themeOverride":null}'::jsonb;
