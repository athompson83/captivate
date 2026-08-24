-- Whether a scene is part of the argument or an aside reached from it.
--
-- A hotspot dives from a main scene into a detail scene: the aside that answers
-- "what does that actually look like?" without derailing the run of the talk.
-- Detail scenes are only reachable through that dive, so they must not appear
-- in the running order — next/prev skip them, the movement rail does not count
-- them, and the scene jumper does not list them.
--
-- 'main' is the default, and every existing row takes it. A scene stored before
-- hotspots existed is part of its deck's running order by definition; defaulting
-- the other way would empty out every deck in the database.

alter table public.scenes
  add column if not exists flow_role text not null default 'main';

alter table public.scenes
  drop constraint if exists scenes_flow_role_valid;

alter table public.scenes
  add constraint scenes_flow_role_valid
  check (flow_role in ('main', 'detail'));

-- The running order is read on every presentation load and filtered by role;
-- the presentation_id index alone leaves that filter to a scan of the deck.
create index if not exists scenes_presentation_flow_role_idx
  on public.scenes (presentation_id, flow_role);
