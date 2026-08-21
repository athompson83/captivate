-- A new presentation should not start out looking like a slide strip.
--
-- The default arrangement becomes `flow`: a serpentine that fills a page, so
-- pulling back shows a composition rather than a ribbon of slides, and it
-- still reads in an obvious order. `reel` remains one click away in the editor.
--
-- Only the column default changes. Presentations that already store an explicit
-- arrangement keep it, which is every presentation created so far.
alter table public.presentations
  alter column journey set default
    '{"arrangement":"flow","travel":"fly","pace":1.1,"establishSections":true,"showPath":true,"depth":0.55}'::jsonb;
