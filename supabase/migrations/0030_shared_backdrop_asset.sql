-- ---------------------------------------------------------------------------
-- A shared deck's backdrop, resolved like its images.
--
-- 0016 authorises an asset for a share-link viewer by where it is *used*: a
-- scene of a currently-shared presentation refers to it. A presentation can
-- now carry one picture behind the whole show (`journey.backdrop`), and that
-- reference lives on the presentation row, not in any scene — so a backdrop
-- uploaded to the library rendered for the owner and answered 404 to everyone
-- who followed the share link. The shared viewer drew the frame for it and
-- the browser drew nothing.
--
-- Same rule, one more place to look: an asset is shared when a scene of a
-- shared presentation refers to it, or when a shared presentation's journey
-- names it as the backdrop. The journey is stored as JSONB, so the id is
-- matched as the value it actually is rather than by substring.
-- ---------------------------------------------------------------------------

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
          and p.journey #>> '{backdrop,assetId}' = p_asset_id::text
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
            and p.journey #>> '{backdrop,assetId}' = a.id::text
        )
      )
  );
$$;

revoke all on function public.captivate_asset_object_is_shared(text) from public;
grant execute on function public.captivate_asset_object_is_shared(text) to anon, authenticated;
