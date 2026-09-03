-- ---------------------------------------------------------------------------
-- Provider is derived from the model, not accepted as a parameter.
--
-- 0028 added `ai_generations.provider` and let a settlement name it directly
-- through a `p_provider` argument. That repeated the caller-forgery pattern
-- 0020 already accepts for `model` and token counts — but with a difference
-- 0020's own reasoning does not cover. Forging `model` or the token counts
-- costs the forger something: a cheap fake model prices the row near zero,
-- which is exactly the "loses the answer they were generating" trade 0020
-- calls acceptable. Forging `provider` alone costs the forger nothing. It
-- does not touch `cost_usd`, so a caller could label an OpenRouter call
-- `anthropic`, or the reverse, purely to corrupt the one column this
-- deployment added specifically so a human could read off which balance was
-- charged — the exact question the first production image row could not
-- answer. An audit trail that costs nothing to falsify is not evidence.
--
-- The fix is not a new credential — this deployment has none that
-- distinguishes the Next.js server from the browser calling on the caller's
-- own JWT, and 0020 already explains why: both arrive at PostgREST as
-- `authenticated`. Instead, `provider` stops being an independent value: it
-- is computed here from `p_model`, under the naming convention this codebase
-- already documents and depends on (0027, and `DEFAULT_MODEL` /
-- `DEFAULT_IMAGE_MODEL` in `src/lib/ai/provider.ts` and
-- `src/lib/ai/visual-sourcing.ts`) — an OpenRouter model id carries a
-- `vendor/model` shape; a direct call to Anthropic or OpenAI does not. A
-- caller can still forge `model`, exactly as before and exactly as 0020
-- accepts, but can no longer pick a `provider` disconnected from it: claiming
-- `anthropic` now requires supplying an unprefixed model id, at whatever cost
-- forging `model` already carried. Nothing new is trusted; one
-- previously-independent lie is retired.
--
-- Deriving from *any* string containing a slash was the first draft, and a
-- review caught what it missed: `p_model = '/'`, `'vendor/'`, `'/model'` and
-- `'a/b/c'` all satisfy "contains a slash" without being a real gateway id,
-- and would have labelled an obviously-garbage row `openrouter` anyway — an
-- honest-looking lie is cheaper to catch than a plausible one, but it is
-- still a lie the schema let through. `v_gateway_shape` matches only what
-- this codebase actually calls a model by: letters, digits, `.`, `_`, `-`,
-- optionally one `vendor/model` split, with no empty segment on either side.
-- A `p_model` that fails it settles as everything else did — status, tokens,
-- cost — and simply leaves `provider` null, the same as a row this migration
-- cannot honestly answer for.
-- ---------------------------------------------------------------------------

alter table public.ai_generations
  add column if not exists provider text
    check (provider in ('anthropic', 'openai', 'openrouter'));

comment on column public.ai_generations.provider is
  'Which gateway served the call, derived from the settled model id. Null where the model is unrecorded or unrecognised.';

-- ---------------------------------------------------------------------------
-- Text settlement: unchanged in every rule (see 0020 and 0023), plus the
-- gateway, derived rather than accepted.
-- ---------------------------------------------------------------------------
drop function if exists public.captivate_complete_generation(uuid, text, text, integer, integer, text, text);

create function public.captivate_complete_generation(
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
  -- One vendor/model split at most, neither side empty. Matches
  -- `claude-sonnet-5` and `anthropic/claude-sonnet-5`; rejects `/`,
  -- `vendor/`, `/model` and `a/b/c`.
  v_gateway_shape constant text := '^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)?$';
  v_provider text;
begin
  if v_user is null then
    return false;
  end if;
  if p_status is null or p_status not in ('succeeded', 'failed', 'invalid_output') then
    return false;
  end if;
  if coalesce(p_input_tokens, 0) < 0 or coalesce(p_output_tokens, 0) < 0 then
    return false;
  end if;

  v_provider := case
    when p_model is null then null
    when p_model !~ v_gateway_shape then null
    when p_model like '%/%' then 'openrouter'
    else 'anthropic'
  end;

  update public.ai_generations g
     set status         = p_status,
         model          = p_model,
         provider       = v_provider,
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

revoke all on function public.captivate_complete_generation(uuid, text, text, integer, integer, text) from public;
revoke all on function public.captivate_complete_generation(uuid, text, text, integer, integer, text) from anon;
grant execute on function public.captivate_complete_generation(uuid, text, text, integer, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Image settlement: unchanged in every rule (see 0020), plus the gateway,
-- derived rather than accepted.
-- ---------------------------------------------------------------------------
drop function if exists public.captivate_settle_image_generation(uuid, text, text, integer, text, text);

create function public.captivate_settle_image_generation(
  p_id            uuid,
  p_status        text,
  p_model         text,
  p_generation_ms integer,
  p_error         text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_rows integer;
  v_gateway_shape constant text := '^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)?$';
  v_provider text;
begin
  if v_user is null then
    return false;
  end if;
  if p_status is null or p_status not in ('succeeded', 'failed', 'invalid_output') then
    return false;
  end if;

  -- Unprefixed is OpenAI direct (`gpt-image-2`); a `vendor/model` shape is
  -- OpenRouter (`openai/gpt-image-2`) — see `DEFAULT_IMAGE_MODEL`.
  v_provider := case
    when p_model is null then null
    when p_model !~ v_gateway_shape then null
    when p_model like '%/%' then 'openrouter'
    else 'openai'
  end;

  update public.ai_generations
     set status        = p_status,
         model         = p_model,
         provider      = v_provider,
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

revoke all on function public.captivate_settle_image_generation(uuid, text, text, integer, text) from public;
revoke all on function public.captivate_settle_image_generation(uuid, text, text, integer, text) from anon;
grant execute on function public.captivate_settle_image_generation(uuid, text, text, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill, only where the answer is actually known.
--
-- Every settled row that has never had a `provider` — every row `ai_generations`
-- has ever held, not only the ones `0028` settled, since the column did not
-- exist before it — gets one now if its `model` is both recorded and shaped
-- like a real gateway id under the same rule settlement now enforces. A model
-- that fails that shape is left null rather than guessed at, for the same
-- reason a settlement leaves it null: the model column was never validated at
-- write time, so a historical value that predates this rule has no honest
-- provider to derive.
-- ---------------------------------------------------------------------------
update public.ai_generations
   set provider = case
     when model like '%/%' then 'openrouter'
     when kind = 'image' then 'openai'
     else 'anthropic'
   end
 where model is not null
   and model ~ '^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)?$'
   and provider is null;
