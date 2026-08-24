-- ---------------------------------------------------------------------------
-- A shared deck's images, resolved by what the deck actually references.
--
-- 0011 answered "is this asset shared?" with a join on
-- `assets.presentation_id`. That column is metadata about where an asset was
-- first uploaded, and it is null for every asset the app has ever created: the
-- uploader never passed a presentation id. So the join matched nothing, and
-- every uploaded image on a shared deck returned 404 — the exact failure 0011
-- was written to fix, still failing, because the test mocked the resolver's
-- return value instead of exercising the join.
--
-- Attribution is fixed on the write side too, but it cannot be the
-- authorisation rule. An asset reused from the library appears on several
-- decks and can only carry one id; the reference is `on delete set null`, so
-- hard-deleting any deck would silently kill image access on the others; and
-- an author who uploads a picture while editing deck A and later places it on
-- deck B would find it broken on the deck it is actually used in.
--
-- The right question is not where an asset came from but where it is *used*:
-- an asset is shared when a scene of a currently-shared presentation refers to
-- it. Scene content stores the reference as `/api/assets/<uuid>/content`, so
-- that is what these look for.
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
    and exists (
      select 1
      from public.scenes c
      join public.presentations p on p.id = c.presentation_id
      where p.share_token is not null
        and p.deleted_at is null
        -- A uuid is specific enough that a substring match on the scene body
        -- cannot collide with anything else in it.
        and c.content::text like '%' || p_asset_id::text || '%'
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
      and exists (
        select 1
        from public.scenes c
        join public.presentations p on p.id = c.presentation_id
        where p.share_token is not null
          and p.deleted_at is null
          and c.content::text like '%' || a.id::text || '%'
      )
  );
$$;

revoke all on function public.captivate_asset_object_is_shared(text) from public;
grant execute on function public.captivate_asset_object_is_shared(text) to anon, authenticated;
