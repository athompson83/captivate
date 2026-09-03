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
-- `vendor/` prefix; a direct call to Anthropic or OpenAI does not. A caller
-- can still forge `model`, exactly as before and exactly as 0020 accepts, but
-- can no longer pick a `provider` disconnected from it: claiming `anthropic`
-- now requires supplying an unprefixed model id, at whatever cost forging
-- `model` already carried. Nothing new is trusted; one previously-independent
-- lie is retired.
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
  -- OpenRouter is the only gateway this application calls whose model ids
  -- carry a `vendor/` prefix; a direct call to Anthropic never does. See
  -- 0027's own comment on the same convention.
  v_provider text := case
    when p_model is null then null
    when p_model like '%/%' then 'openrouter'
    else 'anthropic'
  end;
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
  -- Unprefixed is OpenAI direct (`gpt-image-2`); a `vendor/` prefix is
  -- OpenRouter (`openai/gpt-image-2`) — see `DEFAULT_IMAGE_MODEL`.
  v_provider text := case
    when p_model is null then null
    when p_model like '%/%' then 'openrouter'
    else 'openai'
  end;
begin
  if v_user is null then
    return false;
  end if;
  if p_status is null or p_status not in ('succeeded', 'failed', 'invalid_output') then
    return false;
  end if;

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
-- The handful of rows 0028 settled with a caller-independent, honest
-- `p_provider` (this deployment's own server, before this migration existed)
-- can be re-derived from their own `model` the same way new rows now are —
-- that is not the cross-reference 0028's comment warned against, because it
-- reads the row's own recorded model rather than the current environment.
-- Rows with no model recorded are left null, as before.
-- ---------------------------------------------------------------------------
update public.ai_generations
   set provider = case
     when model like '%/%' then 'openrouter'
     when kind = 'image' then 'openai'
     else 'anthropic'
   end
 where model is not null
   and provider is null;
