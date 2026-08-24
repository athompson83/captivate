-- ---------------------------------------------------------------------------
-- Shared-link assets.
--
-- `captivate_shared_presentation` (0010) hands a link-holder scene content
-- that can reference uploaded images, video and audio via
-- `/api/assets/<id>/content`. That route resolved the asset row and signed
-- its storage object using the *authenticated* client — so a link-holder,
-- who has no session, got a 404 for every uploaded asset even though the
-- deck itself resolved fine. Text-only decks were unaffected; anything with
-- a picture was not.
--
-- The fix follows the same shape as the deck itself: one function is the
-- load boundary, gated on "this asset's presentation is currently shared" —
-- nothing else about the asset (owner id, other decks it may appear on) is
-- exposed, and revoking the share kills asset access in the same instant it
-- kills the deck.
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
  join public.presentations p on p.id = a.presentation_id
  where a.id = p_asset_id
    and p.share_token is not null
    and p.deleted_at is null;
$$;

revoke all on function public.captivate_shared_asset(uuid) from public;
grant execute on function public.captivate_shared_asset(uuid) to anon, authenticated;

-- The function above only tells the server *which* object to sign; minting
-- the signed URL still goes through Storage's own RLS on `storage.objects`.
-- Without a policy there an anon caller could resolve the path and still get
-- nothing back. A plain USING clause runs as the querying role, though, and
-- anon has no policy granting it rows on `assets`/`presentations` directly
-- (deliberately — that RLS is what makes the load-boundary functions the
-- only door) — so this check has to run as a second SECURITY DEFINER
-- function too, the same way the first one does.
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
    join public.presentations p on p.id = a.presentation_id
    where a.storage_path = p_storage_path
      and p.share_token is not null
      and p.deleted_at is null
  );
$$;

revoke all on function public.captivate_asset_object_is_shared(text) from public;
grant execute on function public.captivate_asset_object_is_shared(text) to anon, authenticated;

drop policy if exists assets_read_shared on storage.objects;
create policy assets_read_shared on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'assets' and public.captivate_asset_object_is_shared(storage.objects.name));
