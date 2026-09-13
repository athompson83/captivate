-- A room of a movement's own.
--
-- The journey now carries, beside the one picture behind the whole show,
-- a picture per movement (`journey.rooms.<section id>.assetId`). 0030 taught
-- the shared-asset resolvers to look at the show's backdrop by its exact
-- path in the journey; a movement's room lives under a key that is the
-- movement's id, which no fixed path can name. The journey is JSONB, and a
-- uuid is specific enough that a substring match on the whole of it cannot
-- collide with anything else in it — which is already how a scene's
-- references are found — so both resolvers look at the journey the way they
-- look at a scene: for the id, anywhere in it. This covers the show's
-- backdrop too, so the fixed path goes.

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
          and p.journey::text like '%' || p_asset_id::text || '%'
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
            and p.journey::text like '%' || a.id::text || '%'
        )
      )
  );
$$;

revoke all on function public.captivate_asset_object_is_shared(text) from public;
grant execute on function public.captivate_asset_object_is_shared(text) to anon, authenticated;
