-- Minimal stand-in for the parts of Supabase that the migrations touch.
--
-- run.sh applies every file in supabase/migrations/, not only 0001, so this
-- stub has to cover whatever any of them reference — currently `auth` (0001
-- onward) and `storage` (0002_storage.sql's buckets/object policies). Extend
-- it, don't work around it, if a future migration needs another schema this
-- doesn't yet stand in for.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
end $$;

-- storage.buckets / storage.objects, enough for 0002_storage.sql's bucket
-- rows and per-bucket object policies to apply. Not a faithful reproduction
-- of Supabase Storage — just the shape those statements actually touch.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid
);
alter table storage.objects enable row level security;
-- Returns the folder components without the filename, which is what real
-- Supabase Storage does. A stub that returned the whole split would still
-- satisfy a `(foldername(name))[1] = uid` policy by luck, and would quietly
-- disagree with production for any policy that looked past the first element.
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1];
$$;

-- ---------------------------------------------------------------------------
-- realtime — enough of Supabase's Realtime schema to exercise the policies
-- that gate the phone remote's channel.
--
-- `realtime.messages` is the table Realtime checks RLS against on every join
-- and every publish of a private channel, and `realtime.topic()` is how a
-- policy reads the topic name being joined. Stubbing them means the remote
-- channel's authorisation rule is tested the same way every other policy is,
-- rather than being the one security boundary nobody runs.
-- ---------------------------------------------------------------------------
create schema if not exists realtime;

create table if not exists realtime.messages (
  id         uuid primary key default gen_random_uuid(),
  topic      text not null,
  extension  text not null default 'broadcast',
  payload    jsonb,
  inserted_at timestamptz not null default now()
);

grant usage on schema realtime to anon, authenticated;
grant select, insert on realtime.messages to anon, authenticated;

-- Realtime sets the topic per connection; here it is a session setting the
-- probes assign before attempting a join or a publish.
create or replace function realtime.topic() returns text
language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '');
$$;
