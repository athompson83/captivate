-- ---------------------------------------------------------------------------
-- Share links.
--
-- A presentation can carry one share token. While the token exists, anyone
-- holding the link can *view* the deck — nothing else. The token is a uuid
-- (122 random bits from gen_random_uuid), unguessable rather than merely
-- unlisted, and revoking is setting it null: the old link dies instantly.
--
-- Access for link-holders goes through exactly one function, and that function
-- is the load boundary. It returns only what an audience may see — never
-- speaker notes, never the owner's identity, never tags or folders — so a
-- future column added to these tables stays private until someone adds it
-- here deliberately. Anonymous users get no table grants at all: without the
-- token there is no query to make.
-- ---------------------------------------------------------------------------

alter table public.presentations
  add column if not exists share_token uuid unique default null;

comment on column public.presentations.share_token is
  'View-only link token. Null = not shared. Rotate by writing a new uuid.';

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
        'placement', c.placement
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
