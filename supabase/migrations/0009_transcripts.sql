-- Transcript cues for recordings.
--
-- Stored as [{ startMs, endMs, text }], the same shape the recorder produces
-- and the player consumes; WebVTT is derived from it on demand rather than
-- stored, so there is exactly one source of truth for the words.
--
-- Additive: existing rows read as an empty transcript.

alter table public.recordings
  add column if not exists transcript jsonb not null default '[]'::jsonb;

comment on column public.recordings.transcript is
  'Subtitle cues [{startMs,endMs,text}] captured live during recording.';
