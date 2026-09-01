-- ---------------------------------------------------------------------------
-- What a presentation actually costs.
--
-- `ai_generations` has recorded `model`, `input_tokens` and `output_tokens`
-- since the ledger was built, and `cost_usd` beside them — and for every text
-- call that column has been zero. Only image generation ever wrote it, because
-- images have a per-call price and text has a per-token one that nothing
-- converted.
--
-- The consequence is not academic. Pricing a tier means knowing what a
-- presentation costs, and the only honest answer available was "we have the
-- tokens somewhere". An allowance set without that is a guess, and a guess in
-- the wrong direction is a plan sold below what it costs to serve.
--
-- So the rates live in the database next to the ledger, effective-dated,
-- because a provider's prices change and a row settled in March must keep the
-- cost it actually incurred rather than being silently repriced by an update.
-- ---------------------------------------------------------------------------

create table if not exists public.ai_model_rates (
  model           text        not null,
  -- The instant this price came into force. A row is costed at the newest rate
  -- whose `effective_from` is at or before the moment the call was made.
  effective_from  timestamptz not null,
  input_per_mtok  numeric(10, 4) not null check (input_per_mtok >= 0),
  output_per_mtok numeric(10, 4) not null check (output_per_mtok >= 0),
  note            text        not null default '',
  primary key (model, effective_from)
);

-- No policies, on the same grounds as `ai_image_limits` and `plan_budgets`:
-- these are the deployment's numbers, not any user's, and the definer function
-- below is the only thing that needs to read them. A caller who could write
-- here could price their own usage at zero.
alter table public.ai_model_rates enable row level security;

-- List prices per million tokens, in USD, as published for the models this
-- deployment can be configured to use. `CAPTIVATE_AI_MODEL` overrides which
-- one is called; an override naming a model absent from this table costs
-- nothing rather than guessing, and `text_generation_cost` has a test that
-- fails when a token-bearing row settles at zero — so the gap surfaces as a
-- failing test rather than as a quietly free presentation.
insert into public.ai_model_rates (model, effective_from, input_per_mtok, output_per_mtok, note)
values
  ('claude-opus-5',           '2026-01-01', 5.00, 25.00, 'List price at the time of writing.'),
  ('claude-sonnet-5',         '2026-01-01', 3.00, 15.00, 'List price at the time of writing.'),
  ('claude-haiku-4-5-20251001', '2026-01-01', 1.00,  5.00, 'List price at the time of writing.')
on conflict (model, effective_from) do nothing;

-- ---------------------------------------------------------------------------
-- The rate in force when a call was made.
--
-- Immutable and rate-only, so it can be used inside the settlement without
-- widening what that function is allowed to touch. Null when the model is not
-- one this deployment has a price for — the caller then writes no cost rather
-- than a made-up one.
-- ---------------------------------------------------------------------------
create or replace function public.captivate_model_cost(
  p_model         text,
  p_input_tokens  integer,
  p_output_tokens integer,
  p_at            timestamptz
) returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select round(
           (coalesce(p_input_tokens, 0)::numeric  / 1000000) * r.input_per_mtok +
           (coalesce(p_output_tokens, 0)::numeric / 1000000) * r.output_per_mtok,
           6)
    from public.ai_model_rates r
   where r.model = p_model
     and r.effective_from <= coalesce(p_at, now())
   order by r.effective_from desc
   limit 1;
$$;

-- Not published to anybody. It reads a table users cannot see, and nothing in
-- the browser has any business pricing a generation.
revoke all on function public.captivate_model_cost(text, integer, integer, timestamptz) from public;
revoke all on function public.captivate_model_cost(text, integer, integer, timestamptz) from anon;
revoke all on function public.captivate_model_cost(text, integer, integer, timestamptz) from authenticated;

-- ---------------------------------------------------------------------------
-- Settling a text generation now records what it cost.
--
-- Every arm of it, not just the successful one. A truncated answer, an output
-- that failed its schema, a corrective retry — the provider reports usage on
-- all of them and the money is spent whether or not the author got anything,
-- so a cost model that counted only successes would understate the real bill
-- by exactly the share of attempts that go wrong, which is the share worth
-- knowing about.
--
-- Image rows are untouched. `captivate_settle_image_generation` owns their
-- cost, which is a per-call price reserved *before* the call against a shared
-- budget — a different mechanism with a different failure mode, and 0021 spent
-- a migration making sure the caller cannot choose it.
--
-- The tokens still arrive from the caller, who holds the author's own JWT. That
-- is unchanged and is not a new exposure: `cost_usd` on a text row is compared
-- against no budget — the shared monthly sum is filtered to `kind = 'image'` —
-- so an inflated figure buys nothing and is bounded to one write per call by
-- the supersession rule below.
-- ---------------------------------------------------------------------------
create or replace function public.captivate_complete_generation(
  p_id            uuid,
  p_status        text,
  p_model         text,
  p_input_tokens  integer,
  p_output_tokens integer,
  p_error         text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_rows integer;
begin
  if v_user is null then
    return false;
  end if;
  if p_status is null or p_status not in ('succeeded', 'failed', 'invalid_output') then
    return false;
  end if;

  update public.ai_generations g
     set status         = p_status,
         model          = p_model,
         input_tokens   = p_input_tokens,
         output_tokens  = p_output_tokens,
         error_message  = left(p_error, 500),
         completed_at   = now(),
         -- Priced at the rate in force when the call was made, so a later
         -- change to a provider's list price does not reprice history.
         -- Coalesced to the existing value: an unknown model leaves the cost
         -- exactly as it was rather than zeroing it.
         cost_usd       = coalesce(
                            public.captivate_model_cost(
                              p_model, p_input_tokens, p_output_tokens, g.created_at),
                            g.cost_usd)
   where g.id       = p_id
     and g.owner_id = v_user
     -- Images price themselves, before the call, against a shared budget.
     and g.kind <> 'image'
     -- Rewritable exactly while the row is not counting against anybody:
     -- still in flight, or sitting in the one terminal state the counter
     -- skips. Every state that does count is final, so the only settlement a
     -- later call can overwrite is the one that claims nothing was owed —
     -- which is the forgery, and the server's write is the later call.
     --
     -- Naming the non-counting state rather than "recorded no spend" matters:
     -- an `invalid_output` with no usage records no spend and still counts, so
     -- the looser rule left it rewritable and the refund forgeable a second
     -- time, after the server had already written the truth.
     and (g.status = 'pending'
          or (g.status = 'failed' and coalesce(g.output_tokens, 0) = 0));

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.captivate_complete_generation(uuid, text, text, integer, integer, text) from public;
revoke all on function public.captivate_complete_generation(uuid, text, text, integer, integer, text) from anon;
grant execute on function public.captivate_complete_generation(uuid, text, text, integer, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill, only where the answer is actually known.
--
-- A settled text row that recorded a model this deployment has a price for and
-- some tokens can be costed now. Everything else is left at zero, because a
-- row whose model was never recorded has no honest price and inventing one
-- would put made-up numbers into the evidence the pricing decision rests on.
-- ---------------------------------------------------------------------------
update public.ai_generations g
   set cost_usd = public.captivate_model_cost(
                    g.model, g.input_tokens, g.output_tokens, g.created_at)
 where g.kind <> 'image'
   and g.model is not null
   and coalesce(g.cost_usd, 0) = 0
   and coalesce(g.input_tokens, 0) + coalesce(g.output_tokens, 0) > 0
   and public.captivate_model_cost(
         g.model, g.input_tokens, g.output_tokens, g.created_at) is not null;
