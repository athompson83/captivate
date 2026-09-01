-- ---------------------------------------------------------------------------
-- Prices for the models reachable through OpenRouter.
--
-- `captivate_complete_generation` costs a settled row by looking its model up
-- in `ai_model_rates`, and a model with no row costs nothing — deliberately,
-- because inventing a price would put made-up numbers into the evidence the
-- allowances are argued from. The consequence is that adding a gateway without
-- adding its prices leaves the ledger full of zeroes again, which is the exact
-- state `0023` was written to end.
--
-- These are separate rows rather than aliases of the Anthropic ones. The model
-- string recorded on a generation is the id the gateway was called with, and
-- `anthropic/claude-sonnet-5` genuinely costs less than `claude-sonnet-5` does
-- direct — $2/$10 per million tokens against $3/$15 at list. Two ids, two
-- prices, and a row that says which one was actually paid.
--
-- Effective-dated like everything in this table, so a repricing is a new row
-- and history keeps the cost it incurred.
-- ---------------------------------------------------------------------------
insert into public.ai_model_rates (model, effective_from, input_per_mtok, output_per_mtok, note)
values
  ('anthropic/claude-sonnet-5',  '2026-09-01',  2.00, 10.00, 'OpenRouter list price, 2026-09-01.'),
  ('anthropic/claude-opus-5',    '2026-09-01',  5.00, 25.00, 'OpenRouter list price, 2026-09-01.'),
  ('anthropic/claude-haiku-4.5', '2026-09-01',  1.00,  5.00, 'OpenRouter list price, 2026-09-01.'),
  ('openai/gpt-5.2',             '2026-09-01',  1.75, 14.00, 'OpenRouter list price, 2026-09-01.'),
  ('google/gemini-3.7-flash',    '2026-09-01',  0.75,  3.75, 'OpenRouter list price, 2026-09-01.'),
  ('deepseek/deepseek-v3.2',     '2026-09-01',  0.27,  0.40, 'OpenRouter list price, 2026-09-01.')
on conflict (model, effective_from) do update
  set input_per_mtok  = excluded.input_per_mtok,
      output_per_mtok = excluded.output_per_mtok,
      note            = excluded.note;
