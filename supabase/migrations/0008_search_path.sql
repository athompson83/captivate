-- ---------------------------------------------------------------------------
-- Pin the one function that did not pin its search_path.
--
-- `captivate_touch_updated_at` fires on updates to profiles, folders,
-- presentations, sections, scenes, lecture_notes, recordings and moments, and
-- it resolved `now()` through whatever search_path the session happened to
-- have. Every other function in this schema pins it; this one was missed.
--
-- On a project where a role retains CREATE on a schema that sits ahead of
-- pg_catalog, a shadowing `now()` would then run in the trigger, under the
-- privileges of whichever user next updated any row. Nothing else changes: the
-- body is the same, and `create or replace` keeps every trigger attached to it.
-- ---------------------------------------------------------------------------

create or replace function public.captivate_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
