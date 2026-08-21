-- Movements.
--
-- A section stops being filing and becomes the shape of the argument: `label`
-- is the one-word name for what this part of it does — OPEN, FRAME, PRESSURE,
-- DECIDE — and it is shown to the audience during a presentation, so the room
-- always knows which movement it is in and how many are left.
--
-- Additive and defaulted. An empty label falls back to the section's title at
-- render time, so every presentation that already has sections gains a working
-- movement rail without being migrated.
alter table public.sections
  add column if not exists label text not null default ''
    check (char_length(label) <= 24);

comment on column public.sections.label is
  'Short movement name shown to the audience. Empty falls back to the title.';

-- Camera behaviour gains two audience-facing switches. Existing rows keep the
-- journey object they already store; both read as their defaults when absent.
alter table public.presentations
  alter column journey set default
    '{"arrangement":"flow","travel":"fly","pace":1.1,"establishSections":true,"showPath":true,"depth":0.55,"showMovements":true,"signpostNext":true}'::jsonb;
