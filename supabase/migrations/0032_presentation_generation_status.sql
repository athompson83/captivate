-- Where a deck's generation got to, so it can say so after the author leaves.
--
-- Writing a deck is one request that may run for five minutes; a phone locks
-- long before that. The work survives — Vercel's request cancellation is
-- opt-in and this project does not enable it, so the function finishes whether
-- or not anyone is still listening. What did not survive was the author's
-- ability to find out, and on 2026-09-06 production collected two
-- presentations with the same title a minute apart, each with sixteen moments
-- and sixteen placeholder scenes. That is "I could not tell what happened, so
-- I pressed it again" written down.
--
-- `generating` is a claim about the future and expires: see
-- `src/lib/data/generation-state.ts`, which reads a stale claim as stalled
-- rather than busy. The timestamp is what makes that possible, so the two
-- columns are only meaningful together.
--
-- Every existing row defaults to `ready`, which is the truth about them: they
-- are finished, however they finished.
alter table public.presentations
  add column if not exists generation_status text not null default 'ready';

alter table public.presentations
  add column if not exists generation_started_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'presentations_generation_status_check'
  ) then
    alter table public.presentations
      add constraint presentations_generation_status_check
      check (generation_status in ('ready', 'generating', 'partial', 'failed'));
  end if;
end $$;

comment on column public.presentations.generation_status is
  'ready | generating | partial | failed. `generating` expires — see generation-state.ts.';
