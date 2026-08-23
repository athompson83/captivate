-- How long the talk is supposed to be.
--
-- The narrative map plans time: every moment claims some, and the running total
-- is only meaningful against a number the author actually chose. That number
-- belongs to the presentation, not to the camera settings in `journey` — how
-- long a lecture runs is a fact about the lecture.
--
-- Zero means "no target set", which is the honest default: a presentation with
-- no stated length gets no duration warnings rather than warnings against a
-- length nobody asked for.

alter table public.presentations
  add column if not exists target_seconds integer not null default 0;

alter table public.presentations
  drop constraint if exists presentations_target_seconds_range;

alter table public.presentations
  add constraint presentations_target_seconds_range
  check (target_seconds >= 0 and target_seconds <= 14400);

comment on column public.presentations.target_seconds is
  'Planned running time in seconds. 0 = no target set; the map warns rather than blocks when it is exceeded.';
