-- A room of a movement's own.
--
-- The journey now carries, beside the one picture behind the whole show,
-- a picture per movement (`journey.rooms.<section id>.assetId`). 0030 taught
-- the shared-asset resolvers to look at the show's backdrop by its exact
-- path in the journey; a movement's room lives under a key that is the
-- movement's id, which no fixed path can name — but which the deck's own
-- sections do. So both resolvers look at the backdrop as before, and at a
-- room only under a key that is still a movement of that presentation: a
-- room whose movement was deleted is nobody's, and a link-holder who once
-- saw it cannot go on fetching it by its id (Codex, reviewing the PR, on a
-- first draft that matched the id anywhere in the journey).

create or replace function public.captivate_shared_asset(p_asset_id uuid)
returns table(storage_path text, mime_type text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.storage_path, a.mime_type
  from public.assets a
  where a.id = p_asset_id
    and (
      exists (
        select 1
        from public.scenes c
        join public.presentations p on p.id = c.presentation_id
        where p.share_token is not null
          and p.deleted_at is null
          and c.content::text like '%' || p_asset_id::text || '%'
      )
      or exists (
        select 1
        from public.presentations p
        where p.share_token is not null
          and p.deleted_at is null
          and (
            p.journey #>> '{backdrop,assetId}' = p_asset_id::text
            or exists (
              select 1
              from public.sections s
              where s.presentation_id = p.id
                and p.journey #>> array['rooms', s.id::text, 'assetId'] = p_asset_id::text
            )
          )
      )
    );
$$;

revoke all on function public.captivate_shared_asset(uuid) from public;
grant execute on function public.captivate_shared_asset(uuid) to anon, authenticated;

create or replace function public.captivate_asset_object_is_shared(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.assets a
    where a.storage_path = p_storage_path
      and (
        exists (
          select 1
          from public.scenes c
          join public.presentations p on p.id = c.presentation_id
          where p.share_token is not null
            and p.deleted_at is null
            and c.content::text like '%' || a.id::text || '%'
        )
        or exists (
          select 1
          from public.presentations p
          where p.share_token is not null
            and p.deleted_at is null
            and (
              p.journey #>> '{backdrop,assetId}' = a.id::text
              or exists (
                select 1
                from public.sections s
                where s.presentation_id = p.id
                  and p.journey #>> array['rooms', s.id::text, 'assetId'] = a.id::text
              )
            )
        )
      )
  );
$$;

revoke all on function public.captivate_asset_object_is_shared(text) from public;
grant execute on function public.captivate_asset_object_is_shared(text) to anon, authenticated;
