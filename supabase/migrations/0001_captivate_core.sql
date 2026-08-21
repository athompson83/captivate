-- ============================================================================
-- Captivate — core schema
--
-- Every user-owned table is protected by RLS keyed on auth.uid(). Ownership is
-- never taken from the client: `owner_id` defaults to auth.uid() and the WITH
-- CHECK clauses reject any insert or update that would attribute a row to a
-- different user.
--
-- Child rows (sections, scenes) do not carry their own owner. They are reached
-- through presentations, and their policies delegate to a single SECURITY
-- DEFINER helper so the ownership rule is written down exactly once.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.captivate_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text        not null default '',
  avatar_url   text,
  -- UI preference only; has no security meaning.
  theme_pref   text        not null default 'system'
                 check (theme_pref in ('system', 'light', 'dark')),
  onboarded_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.captivate_touch_updated_at();

-- Create the profile row as soon as the auth user exists so the rest of the
-- app can assume it is present.
create or replace function public.captivate_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists captivate_on_auth_user_created on auth.users;
create trigger captivate_on_auth_user_created
  after insert on auth.users
  for each row execute function public.captivate_handle_new_user();

-- ---------------------------------------------------------------------------
-- folders
-- ---------------------------------------------------------------------------
create table if not exists public.folders (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  color      text not null default 'neutral'
               check (color in ('neutral','gold','orchid','teal','rose','blue','green')),
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists folders_owner_idx on public.folders (owner_id, position);

create trigger folders_touch
  before update on public.folders
  for each row execute function public.captivate_touch_updated_at();

-- ---------------------------------------------------------------------------
-- presentations
-- ---------------------------------------------------------------------------
create table if not exists public.presentations (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  folder_id       uuid references public.folders(id) on delete set null,
  title           text not null default 'Untitled presentation'
                    check (char_length(title) <= 240),
  description     text not null default '' check (char_length(description) <= 2000),
  theme_id        text not null default 'midnight' check (char_length(theme_id) <= 64),
  theme_overrides jsonb,
  aspect_ratio    text not null default '16:9' check (aspect_ratio in ('16:9','16:10','4:3')),
  tags            text[] not null default '{}',
  is_favorite     boolean not null default false,
  thumbnail_url   text,
  schema_version  integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_opened_at  timestamptz,
  -- Soft delete: "Recently deleted" is recoverable for 30 days.
  deleted_at      timestamptz
);

create index if not exists presentations_owner_updated_idx
  on public.presentations (owner_id, updated_at desc) where deleted_at is null;
create index if not exists presentations_owner_opened_idx
  on public.presentations (owner_id, last_opened_at desc nulls last) where deleted_at is null;
create index if not exists presentations_folder_idx
  on public.presentations (folder_id) where deleted_at is null;
create index if not exists presentations_favorite_idx
  on public.presentations (owner_id) where is_favorite and deleted_at is null;
create index if not exists presentations_tags_idx on public.presentations using gin (tags);
create index if not exists presentations_search_idx on public.presentations
  using gin (to_tsvector('english', title || ' ' || description));

create trigger presentations_touch
  before update on public.presentations
  for each row execute function public.captivate_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Ownership helper.
--
-- SECURITY DEFINER so that child-table policies can check the parent without
-- requiring the caller to also hold a SELECT policy on presentations at the
-- moment the check runs. search_path is pinned to defeat search_path attacks.
-- ---------------------------------------------------------------------------
create or replace function public.captivate_owns_presentation(p_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.presentations p
    where p.id = p_id and p.owner_id = auth.uid()
  );
$$;

revoke all on function public.captivate_owns_presentation(uuid) from public;
grant execute on function public.captivate_owns_presentation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- sections
-- ---------------------------------------------------------------------------
create table if not exists public.sections (
  id              uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  title           text not null default 'Untitled section' check (char_length(title) <= 240),
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists sections_presentation_idx
  on public.sections (presentation_id, position);

create trigger sections_touch
  before update on public.sections
  for each row execute function public.captivate_touch_updated_at();

-- ---------------------------------------------------------------------------
-- scenes
--
-- `content` holds the validated scene body (elements, layout, background,
-- transition). It is JSONB rather than a row-per-element table because the
-- editor saves whole scenes atomically and a drag must not fan out into N row
-- updates. Validity is enforced by Zod at every write boundary and the payload
-- carries its own `version` field for forward migration.
-- ---------------------------------------------------------------------------
create table if not exists public.scenes (
  id               uuid primary key default gen_random_uuid(),
  presentation_id  uuid not null references public.presentations(id) on delete cascade,
  section_id       uuid references public.sections(id) on delete set null,
  position         integer not null default 0,
  title            text not null default '' check (char_length(title) <= 240),
  content          jsonb not null default '{"version":1,"layout":"custom","background":{"kind":"theme"},"elements":[],"transition":{"type":"fade","duration":0.6,"direction":"left"},"themeOverride":null}'::jsonb,
  speaker_notes    text not null default '' check (char_length(speaker_notes) <= 20000),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 7200),
  schema_version   integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists scenes_presentation_idx
  on public.scenes (presentation_id, position);
create index if not exists scenes_section_idx on public.scenes (section_id);

create trigger scenes_touch
  before update on public.scenes
  for each row execute function public.captivate_touch_updated_at();

-- Keep the parent presentation's updated_at honest so "Recent" ordering and
-- the dashboard reflect real editing activity, not just title renames.
create or replace function public.captivate_touch_presentation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.presentations
     set updated_at = now()
   where id = coalesce(new.presentation_id, old.presentation_id);
  return null;
end;
$$;

create trigger scenes_touch_parent
  after insert or update or delete on public.scenes
  for each row execute function public.captivate_touch_presentation();

create trigger sections_touch_parent
  after insert or update or delete on public.sections
  for each row execute function public.captivate_touch_presentation();

-- ---------------------------------------------------------------------------
-- lecture_notes
--
-- Deliberately separate from scenes.speaker_notes. Speaker notes are the short
-- prompts a presenter glances at; lecture notes are the long-form research and
-- teaching material behind a deck, and they outlive any particular scene.
-- ---------------------------------------------------------------------------
create table if not exists public.lecture_notes (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  presentation_id uuid references public.presentations(id) on delete cascade,
  section_id      uuid references public.sections(id) on delete set null,
  scene_id        uuid references public.scenes(id) on delete set null,
  title           text not null default 'Untitled note' check (char_length(title) <= 240),
  body            text not null default '' check (char_length(body) <= 500000),
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists lecture_notes_owner_idx
  on public.lecture_notes (owner_id, updated_at desc);
create index if not exists lecture_notes_presentation_idx
  on public.lecture_notes (presentation_id, position);
create index if not exists lecture_notes_scene_idx on public.lecture_notes (scene_id);
create index if not exists lecture_notes_search_idx on public.lecture_notes
  using gin (to_tsvector('english', title || ' ' || body));

create trigger lecture_notes_touch
  before update on public.lecture_notes
  for each row execute function public.captivate_touch_updated_at();

-- ---------------------------------------------------------------------------
-- assets
-- ---------------------------------------------------------------------------
create table if not exists public.assets (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  presentation_id   uuid references public.presentations(id) on delete set null,
  storage_path      text not null,
  kind              text not null check (kind in ('image','video','audio','file')),
  mime_type         text not null,
  byte_size         bigint not null check (byte_size >= 0),
  width             integer,
  height            integer,
  duration_seconds  numeric,
  alt_text          text not null default '' check (char_length(alt_text) <= 600),
  original_filename text not null default '',
  created_at        timestamptz not null default now()
);

create unique index if not exists assets_storage_path_key on public.assets (storage_path);
create index if not exists assets_owner_idx on public.assets (owner_id, created_at desc);
create index if not exists assets_presentation_idx on public.assets (presentation_id);

-- ---------------------------------------------------------------------------
-- recordings
-- ---------------------------------------------------------------------------
create table if not exists public.recordings (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  presentation_id  uuid references public.presentations(id) on delete set null,
  title            text not null default 'Untitled recording' check (char_length(title) <= 240),
  storage_path     text,
  mime_type        text not null default 'video/webm',
  byte_size        bigint not null default 0 check (byte_size >= 0),
  duration_seconds numeric not null default 0,
  status           text not null default 'recording'
                     check (status in ('recording','uploading','ready','failed','local_only')),
  has_camera       boolean not null default false,
  has_microphone   boolean not null default false,
  -- [{ sceneId, sceneIndex, atMs }] — drives chapter markers during playback.
  scene_timeline   jsonb not null default '[]'::jsonb,
  error_message    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists recordings_owner_idx on public.recordings (owner_id, created_at desc);
create index if not exists recordings_presentation_idx on public.recordings (presentation_id);

create trigger recordings_touch
  before update on public.recordings
  for each row execute function public.captivate_touch_updated_at();

-- ---------------------------------------------------------------------------
-- ai_generations — audit + cost visibility for every model call
-- ---------------------------------------------------------------------------
create table if not exists public.ai_generations (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  presentation_id uuid references public.presentations(id) on delete set null,
  kind            text not null,
  prompt          text not null default '',
  status          text not null default 'pending'
                    check (status in ('pending','succeeded','failed','invalid_output')),
  model           text,
  input_tokens    integer,
  output_tokens   integer,
  error_message   text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists ai_generations_owner_idx
  on public.ai_generations (owner_id, created_at desc);

-- ============================================================================
-- Row level security
-- ============================================================================
alter table public.profiles       enable row level security;
alter table public.folders        enable row level security;
alter table public.presentations  enable row level security;
alter table public.sections       enable row level security;
alter table public.scenes         enable row level security;
alter table public.lecture_notes  enable row level security;
alter table public.assets         enable row level security;
alter table public.recordings     enable row level security;
alter table public.ai_generations enable row level security;

-- profiles ------------------------------------------------------------------
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- folders -------------------------------------------------------------------
create policy "folders_select_own" on public.folders
  for select to authenticated using (owner_id = auth.uid());
create policy "folders_insert_own" on public.folders
  for insert to authenticated with check (owner_id = auth.uid());
create policy "folders_update_own" on public.folders
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "folders_delete_own" on public.folders
  for delete to authenticated using (owner_id = auth.uid());

-- presentations -------------------------------------------------------------
create policy "presentations_select_own" on public.presentations
  for select to authenticated using (owner_id = auth.uid());
create policy "presentations_insert_own" on public.presentations
  for insert to authenticated with check (owner_id = auth.uid());
create policy "presentations_update_own" on public.presentations
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "presentations_delete_own" on public.presentations
  for delete to authenticated using (owner_id = auth.uid());

-- sections ------------------------------------------------------------------
create policy "sections_select_own" on public.sections
  for select to authenticated using (public.captivate_owns_presentation(presentation_id));
create policy "sections_insert_own" on public.sections
  for insert to authenticated with check (public.captivate_owns_presentation(presentation_id));
create policy "sections_update_own" on public.sections
  for update to authenticated
  using (public.captivate_owns_presentation(presentation_id))
  with check (public.captivate_owns_presentation(presentation_id));
create policy "sections_delete_own" on public.sections
  for delete to authenticated using (public.captivate_owns_presentation(presentation_id));

-- scenes --------------------------------------------------------------------
create policy "scenes_select_own" on public.scenes
  for select to authenticated using (public.captivate_owns_presentation(presentation_id));
create policy "scenes_insert_own" on public.scenes
  for insert to authenticated with check (public.captivate_owns_presentation(presentation_id));
create policy "scenes_update_own" on public.scenes
  for update to authenticated
  using (public.captivate_owns_presentation(presentation_id))
  with check (public.captivate_owns_presentation(presentation_id));
create policy "scenes_delete_own" on public.scenes
  for delete to authenticated using (public.captivate_owns_presentation(presentation_id));

-- lecture_notes -------------------------------------------------------------
create policy "lecture_notes_select_own" on public.lecture_notes
  for select to authenticated using (owner_id = auth.uid());
create policy "lecture_notes_insert_own" on public.lecture_notes
  for insert to authenticated with check (
    owner_id = auth.uid()
    and (presentation_id is null or public.captivate_owns_presentation(presentation_id))
  );
create policy "lecture_notes_update_own" on public.lecture_notes
  for update to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and (presentation_id is null or public.captivate_owns_presentation(presentation_id))
  );
create policy "lecture_notes_delete_own" on public.lecture_notes
  for delete to authenticated using (owner_id = auth.uid());

-- assets --------------------------------------------------------------------
create policy "assets_select_own" on public.assets
  for select to authenticated using (owner_id = auth.uid());
create policy "assets_insert_own" on public.assets
  for insert to authenticated with check (owner_id = auth.uid());
create policy "assets_update_own" on public.assets
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "assets_delete_own" on public.assets
  for delete to authenticated using (owner_id = auth.uid());

-- recordings ----------------------------------------------------------------
create policy "recordings_select_own" on public.recordings
  for select to authenticated using (owner_id = auth.uid());
create policy "recordings_insert_own" on public.recordings
  for insert to authenticated with check (owner_id = auth.uid());
create policy "recordings_update_own" on public.recordings
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "recordings_delete_own" on public.recordings
  for delete to authenticated using (owner_id = auth.uid());

-- ai_generations ------------------------------------------------------------
-- Rows are written by the server on the user's behalf; the client may read its
-- own history but never fabricate or alter records.
create policy "ai_generations_select_own" on public.ai_generations
  for select to authenticated using (owner_id = auth.uid());
