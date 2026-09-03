-- ---------------------------------------------------------------------------
-- A ledger row names the gateway that served it.
--
-- The first image generation the deployment ever completed settled with
-- `model = 'gpt-image-2'`, and that was all the row could say about who was
-- paid for it. The unprefixed id is how the OpenAI gateway's default is
-- named — but `CAPTIVATE_IMAGE_MODEL` overrides the default independently of
-- the resolved provider, so the same value through OpenRouter records the
-- same string. The row was consistent with one answer and proof of neither,
-- and the only way to settle which balance had been charged was to read the
-- deployment's environment. A ledger that has to be cross-referenced against
-- configuration that can change is not evidence about the past.
--
-- So settlement now records the gateway alongside the model, for text and
-- image rows alike. It is a label, not a price: `cost_usd` still comes from
-- the reservation (images) or `ai_model_rates` keyed on the model id (text),
-- and the model id already differs by gateway where the price does — see
-- 0027. The column is constrained to the gateways the application can be
-- built against, so a typo cannot quietly become a fourth provider in a
-- report.
--
-- The old signatures are dropped rather than overloaded. Both settlement
-- calls are best-effort on the server and the parameter has a default, so a
-- deployment running the previous build settles exactly as it did before —
-- with the gateway unrecorded — until it is rebuilt. Nothing is backfilled:
-- rows settled before this migration have no honest answer, and writing the
-- current environment's provider onto them would be the cross-reference this
-- migration exists to stop.
-- ---------------------------------------------------------------------------

alter table public.ai_generations
  add column if not exists provider text
    check (provider in ('anthropic', 'openai', 'openrouter'));

comment on column public.ai_generations.provider is
  'Which gateway served the call, recorded at settlement. Null where the row settled before the column existed.';

-- ---------------------------------------------------------------------------
-- Text settlement: unchanged in every rule (see 0020 and 0023), plus the
-- gateway.
-- ---------------------------------------------------------------------------
drop function if exists public.captivate_complete_generation(uuid, text, text, integer, integer, text);

create function public.captivate_complete_generation(
  p_id            uuid,
  p_status        text,
  p_model         text,
  p_input_tokens  integer,
  p_output_tokens integer,
  p_error         text,
  p_provider      text default null
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
  -- Refused rather than nulled: a settlement naming a gateway this build does
  -- not know is a settlement from a build this schema does not know, and the
  -- row is better left for the retry than written half-true.
  if p_provider is not null and p_provider not in ('anthropic', 'openai', 'openrouter') then
    return false;
  end if;
  if coalesce(p_input_tokens, 0) < 0 or coalesce(p_output_tokens, 0) < 0 then
    return false;
  end if;

  update public.ai_generations g
     set status         = p_status,
         model          = p_model,
         provider       = p_provider,
         input_tokens   = p_input_tokens,
         output_tokens  = p_output_tokens,
         error_message  = left(p_error, 500),
         completed_at   = now(),
         cost_usd       = coalesce(
                            public.captivate_model_cost(
                              p_model, p_input_tokens, p_output_tokens, g.created_at),
                            g.cost_usd)
   where g.id       = p_id
     and g.owner_id = v_user
     and g.kind <> 'image'
     and (g.status = 'pending'
          or (g.status = 'failed' and coalesce(g.output_tokens, 0) = 0));

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.captivate_complete_generation(uuid, text, text, integer, integer, text, text) from public;
revoke all on function public.captivate_complete_generation(uuid, text, text, integer, integer, text, text) from anon;
grant execute on function public.captivate_complete_generation(uuid, text, text, integer, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Image settlement: unchanged in every rule (see 0020), plus the gateway.
-- ---------------------------------------------------------------------------
drop function if exists public.captivate_settle_image_generation(uuid, text, text, integer, text);

create function public.captivate_settle_image_generation(
  p_id            uuid,
  p_status        text,
  p_model         text,
  p_generation_ms integer,
  p_error         text,
  p_provider      text default null
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
  if p_provider is not null and p_provider not in ('anthropic', 'openai', 'openrouter') then
    return false;
  end if;

  update public.ai_generations
     set status        = p_status,
         model         = p_model,
         provider      = p_provider,
         error_message = left(p_error, 500),
         duration_ms   = p_generation_ms,
         completed_at  = now()
   where id       = p_id
     and owner_id  = v_user
     and status    = 'pending';

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.captivate_settle_image_generation(uuid, text, text, integer, text, text) from public;
revoke all on function public.captivate_settle_image_generation(uuid, text, text, integer, text, text) from anon;
grant execute on function public.captivate_settle_image_generation(uuid, text, text, integer, text, text) to authenticated;
