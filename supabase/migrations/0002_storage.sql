-- ============================================================================
-- Captivate — storage buckets and object policies
--
-- All three buckets are PRIVATE. The browser never gets a public object URL;
-- it gets a short-lived signed URL minted server-side after an ownership check.
--
-- Object paths are always `<user_id>/<uuid>.<ext>`. The first path segment is
-- the authoritative owner, which is what the policies below enforce. A user
-- therefore cannot write into another user's prefix even with a forged body.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'assets', 'assets', false,
    52428800, -- 50 MB
    array[
      'image/png','image/jpeg','image/webp','image/gif','image/avif','image/svg+xml',
      'audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/webm',
      'video/mp4','video/webm','video/quicktime'
    ]
  ),
  (
    'recordings', 'recordings', false,
    2147483648, -- 2 GB
    array['video/webm','video/mp4','video/x-matroska','audio/webm','audio/mp4']
  ),
  (
    'thumbnails', 'thumbnails', false,
    2097152, -- 2 MB
    array['image/png','image/jpeg','image/webp']
  )
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Object policies. `storage.foldername(name)[1]` is the leading path segment.
-- ---------------------------------------------------------------------------
do $$
declare
  b text;
begin
  foreach b in array array['assets', 'recordings', 'thumbnails'] loop
    execute format($f$
      drop policy if exists %I on storage.objects;
      create policy %I on storage.objects
        for select to authenticated
        using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text);
    $f$, b || '_read_own', b || '_read_own', b);

    execute format($f$
      drop policy if exists %I on storage.objects;
      create policy %I on storage.objects
        for insert to authenticated
        with check (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text);
    $f$, b || '_insert_own', b || '_insert_own', b);

    execute format($f$
      drop policy if exists %I on storage.objects;
      create policy %I on storage.objects
        for update to authenticated
        using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)
        with check (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text);
    $f$, b || '_update_own', b || '_update_own', b, b);

    execute format($f$
      drop policy if exists %I on storage.objects;
      create policy %I on storage.objects
        for delete to authenticated
        using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text);
    $f$, b || '_delete_own', b || '_delete_own', b);
  end loop;
end $$;
