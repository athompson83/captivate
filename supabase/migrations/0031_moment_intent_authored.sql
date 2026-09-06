-- Whether the author chose a moment's visual intent, or the model proposed it.
--
-- Composition reads the two differently, and had been reading them as one. A
-- model answers "statement" when it has no opinion — 152 of the 343 moments
-- generated before this migration — and that was vetoing the role's own
-- composition, so an `application` beat never became a call to action and an
-- `evidence` beat never became a number. An author who opens the picker and
-- chooses "One statement" means it.
--
-- Existing rows default to false, which is the truth about them: every moment
-- stored before today had its intent proposed by a model. Nothing is
-- backfilled, because there is no record of which ones an author later edited
-- and inventing one would be worse than the default.
alter table public.moments
  add column if not exists intent_authored boolean not null default false;

comment on column public.moments.intent_authored is
  'True where the author chose visual_intent; false where a model proposed it.';
