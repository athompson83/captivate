-- Attach a template deck's scenes to the beats they are.
--
-- Creating a presentation from a template that declares a `shape` wrote two
-- unrelated sets of rows: moments with fresh ids, and scenes with `moment_id`
-- null. The narrative map then described an argument connected to nothing —
-- editing a moment changed no scene, and generating scenes from that map
-- appended a second parallel deck beside the first, because every moment
-- looked like a moment that had never had a scene.
--
-- The creation path pairs them now (`src/lib/narrative/pair-template.ts`).
-- This repairs the decks that were made before it did, under exactly the same
-- rule: within a movement, the nth scene is the nth beat.
--
-- Deliberately narrow. Only presentations where moments exist and *no* scene
-- is linked at all are touched, so a deck whose author has already connected
-- part of its map is left entirely alone; and only scenes filed into a
-- movement, because a beat's position means nothing outside one. Surplus on
-- either side stays unpaired, which is correct: extra scenes are extra
-- material, and a beat with no scene is what a generation is for.

with unlinked as (
  select p.id
  from public.presentations p
  where exists (select 1 from public.moments m where m.presentation_id = p.id)
    and not exists (
      select 1 from public.scenes s
      where s.presentation_id = p.id and s.moment_id is not null
    )
),
ranked_scenes as (
  select
    s.id,
    s.presentation_id,
    s.section_id,
    row_number() over (
      partition by s.presentation_id, s.section_id order by s.position
    ) - 1 as slot
  from public.scenes s
  join unlinked u on u.id = s.presentation_id
  where s.section_id is not null
)
update public.scenes s
set moment_id = m.id
from ranked_scenes rs
join public.moments m
  on m.presentation_id = rs.presentation_id
 and m.movement_id = rs.section_id
 and m.position = rs.slot
where s.id = rs.id;
