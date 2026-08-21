# Database

Postgres, on Supabase. Nine tables in `public`, all with row-level security.

---

## Tables

### `profiles`

One row per auth user, created automatically by a trigger on `auth.users` so the
rest of the app can assume it exists. Holds display name, avatar and an
interface theme preference (which has no security meaning).

### `folders`

Owner-scoped grouping for presentations. Deleting a folder never deletes its
contents — `presentations.folder_id` is `ON DELETE SET NULL`.

### `presentations`

The deck header: title, description, theme id, aspect ratio, tags, favourite
flag, `schema_version`, and `deleted_at` for soft delete.

Indexed for the queries the dashboard actually runs: `(owner_id, updated_at
desc)` and `(owner_id, last_opened_at desc)` as partial indexes excluding
deleted rows, a partial index for favourites, a GIN index on `tags`, and a GIN
full-text index on `title || description`.

### `sections`

Ordered grouping of scenes within a deck. Deleting a section keeps its scenes —
they simply become unsectioned (`ON DELETE SET NULL`).

### `scenes`

Position, title, `content` (JSONB), `speaker_notes`, `duration_seconds` and
`schema_version`.

`content` holds the validated scene body: layout, background, elements,
camera behaviour. See [ARCHITECTURE.md](ARCHITECTURE.md#why-scenes-are-jsonb) for why
this is JSONB rather than a `scene_elements` table.

A trigger touches the parent presentation's `updated_at` on any scene or section
change, so "Recent" reflects real editing rather than only title renames.

### `lecture_notes`

Deliberately separate from `scenes.speaker_notes`. Speaker notes are the short
prompts a presenter glances at mid-sentence; lecture notes are the long-form
research and teaching material behind a deck, and they outlive any particular
scene. A note may attach to a presentation, a section, a scene, or nothing.
Bodies allow up to 500,000 characters and are full-text indexed.

### `assets`

Metadata for uploaded media. The file itself lives in the `assets` storage
bucket; `storage_path` is unique. Records dimensions and duration so the editor
can place media at the right aspect ratio rather than guessing.

### `recordings`

Metadata for captures. `status` distinguishes `uploading`, `ready`, `failed` and
`local_only` — the last is a recording that exists only on the device that made
it, which the library says plainly rather than showing an entry that plays
nothing. `scene_timeline` is `[{ sceneId, sceneIndex, atMs }]` and becomes
chapter markers during playback.

### `ai_generations`

An audit row per model call: kind, prompt, status, model, token counts and any
error. It is what makes cost visible, and it is also the rate limiter's counter.

---

## Movements

Migration `0005_movements.sql` adds `sections.label` — a short movement name,
shown to the audience during a presentation. Additive and defaulted to the empty
string, which falls back to the section's own title at render time, so every
presentation that already has sections gains a working movement rail without
being migrated.

## The world canvas

Migration `0003_journey.sql` adds two columns:

- `scenes.placement` — nullable `jsonb` holding `{x, y, scale, rotation}` in
  stage units. Null means "derive from the presentation's arrangement", which is
  what keeps every deck created before the column existed working unchanged.
- `presentations.journey` — `jsonb`, not null, defaulted. Arrangement, travel
  style, pace, and whether sections are established before the camera dives in.

Both live on tables that already carry owner-scoped policies covering all four
verbs, and no column-level grants are used, so they inherit that protection.

Applying an arrangement rewrites every scene in a deck, so it goes through
`captivate_set_scene_placements(uuid, jsonb)` — one statement rather than sixty
round trips, and atomic, because a half-applied layout leaves a presentation
scattered between two arrangements.

That function is **`SECURITY INVOKER`**, unlike the ownership helpers. The
owner-scoped RLS policy on `public.scenes` is exactly the check it needs, so it
runs as the caller and inherits it. A `SECURITY DEFINER` function here would
have to re-implement that check by hand, and would become a privilege-escalation
bug the first time somebody got the re-implementation wrong.

## Row-level security

Every table has RLS enabled. Two shapes:

**Owner-scoped** (`profiles`, `folders`, `presentations`, `lecture_notes`,
`assets`, `recordings`, `ai_generations`) compare `owner_id = auth.uid()`, with
`WITH CHECK` on writes so ownership cannot be forged.

**Delegated** (`sections`, `scenes`) call `captivate_owns_presentation(uuid)`, a
`SECURITY DEFINER` function with a pinned `search_path`. Writing the rule once
means it cannot drift between four policies on two tables.

`ai_generations` has no UPDATE or DELETE policy: an audit record is immutable
from a client.

`owner_id` defaults to `auth.uid()` on every owner-scoped table, so the common
case needs no client input at all.

---

## Storage

| Bucket       | Public | Limit | Types                |
| ------------ | ------ | ----- | -------------------- |
| `assets`     | No     | 50 MB | Images, audio, video |
| `recordings` | No     | 2 GB  | WebM, MP4, Matroska  |
| `thumbnails` | No     | 2 MB  | PNG, JPEG, WebP      |

Object keys are always `<user_id>/<uuid>.<ext>`. Policies compare
`(storage.foldername(name))[1]` to `auth.uid()`, so the leading path segment is
the authoritative owner and a client cannot write into someone else's prefix.

---

## Migrations

Append-only, applied in filename order.

| File                      | Contents                                  |
| ------------------------- | ----------------------------------------- |
| `0001_captivate_core.sql` | Tables, indexes, triggers, functions, RLS |
| `0002_storage.sql`        | Buckets and object policies               |

Everything is idempotent (`create table if not exists`, `drop policy if
exists`), so re-running is safe.

### Testing

`supabase/tests/run.sh` applies the migrations to a throwaway local database —
with a small stub standing in for `auth.users` and `auth.uid()` — creates two
users, and asserts isolation in both directions. It exits non-zero on any leak,
so it belongs in CI.

The same probes were also run against the live project through PostgREST with
two real JWTs, which exercises the actual production path rather than a
simulation of it.

---

## Schema versioning

`presentations.schema_version` and `scenes.schema_version` are integers, and the
JSONB payload carries its own `version` field.

`parseSceneContent` never throws. If stored content fails validation it salvages
whatever individual elements are still valid and returns the rest as an empty
scene, flagging the scene as recovered — the editor then shows a banner naming
the affected scenes. One corrupt scene must never make a forty-scene deck
unopenable.

A future migration would read `version`, transform, and write back with the new
value. Nothing in the current schema forecloses that.
