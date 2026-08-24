-- Whether a scene is part of the argument or an aside reached from it.
--
-- A hotspot dives from a main scene into a detail scene: the aside that answers
-- "what does that actually look like?" without derailing the run of the talk.
-- Detail scenes are only reachable through that dive, so they must not appear
-- in the running order — next/prev skip them, the movement rail does not count
-- them, and the scene jumper does not list them.
--
-- 'main' is the default, and every existing row takes it. A scene stored before
-- hotspots existed is part of its deck's running order by definition; defaulting
-- the other way would empty out every deck in the database.

alter table public.scenes
  add column if not exists flow_role text not null default 'main';

alter table public.scenes
  drop constraint if exists scenes_flow_role_valid;

alter table public.scenes
  add constraint scenes_flow_role_valid
  check (flow_role in ('main', 'detail'));

-- The running order is read on every presentation load and filtered by role;
-- the presentation_id index alone leaves that filter to a scan of the deck.
create index if not exists scenes_presentation_flow_role_idx
  on public.scenes (presentation_id, flow_role);

-- A share link must walk the same running order the room walked. The resolver
-- from 0010 predates detail scenes, so it handed the viewer an array with no
-- way to tell an aside from a beat of the argument — and the viewer, counting
-- array positions, walked a reader straight into asides nobody in the room
-- ever saw in sequence. Adding the column to the payload is the whole fix; the
-- function is otherwise unchanged, and still returns nothing private.
create or replace function public.captivate_shared_presentation(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'presentation', jsonb_build_object(
      'id',          p.id,
      'title',       p.title,
      'description', p.description,
      'themeId',     p.theme_id,
      'aspectRatio', p.aspect_ratio,
      'journey',     p.journey
    ),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',       s.id,
        'title',    s.title,
        'label',    s.label,
        'position', s.position
      ) order by s.position)
      from public.sections s
      where s.presentation_id = p.id
    ), '[]'::jsonb),
    'scenes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',        c.id,
        'sectionId', c.section_id,
        'position',  c.position,
        'title',     c.title,
        'content',   c.content,
        'placement', c.placement,
        'flowRole',  c.flow_role
      ) order by c.position)
      from public.scenes c
      where c.presentation_id = p.id
    ), '[]'::jsonb)
  )
  from public.presentations p
  where p.share_token = p_token
    and p.deleted_at is null;
$$;

revoke all on function public.captivate_shared_presentation(uuid) from public;
grant execute on function public.captivate_shared_presentation(uuid) to anon, authenticated;
