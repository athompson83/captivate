-- ---------------------------------------------------------------------------
-- What actually counts against an allowance.
--
-- The limiter counted every `ai_generations` row in the window, which charged
-- an author for two things they never received:
--
--   * a reservation abandoned by a killed function. `/api/ai/map` ran with a
--     60-second ceiling while the model call was given three minutes, so the
--     platform killed the function mid-generation; the row stayed `pending`
--     forever, because `complete` is the only thing that settles one and it
--     never ran. A Free account is sold ten decks in thirty days, and each
--     such 504 took one of them away for the full thirty;
--   * a call that never reached the model at all — a provider outage, an
--     overload, a refused reservation. No tokens were spent and nothing was
--     delivered, so billing it to an allowance is charging the author for our
--     own downtime.
--
-- A near-miss or a truncated answer still counts: those really do bill two
-- full model calls, which is why the provider now records their usage on the
-- failure rather than throwing it away.
--
-- One function, so the reservation that enforces the limit, the pre-filter
-- that produces the error message, and the number the settings page shows can
-- never disagree about what was used.
-- ---------------------------------------------------------------------------

create or replace function public.captivate_count_generations(
  p_count_kinds    text[],
  p_window_minutes integer
) returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
    from public.ai_generations g
   where g.owner_id = auth.uid()
     and auth.uid() is not null
     and g.kind = any(p_count_kinds)
     and g.created_at >= now() - make_interval(mins => p_window_minutes)
     -- In flight holds its place. Abandoned does not: no route may run longer
     -- than the platform's own five-minute ceiling, so a reservation still
     -- pending after fifteen minutes is never coming back.
     and (g.status <> 'pending' or g.created_at >= now() - interval '15 minutes')
     -- Nothing reached the model, so nothing was spent and nothing was made.
     and not (g.status = 'failed' and coalesce(g.output_tokens, 0) = 0);
$$;

revoke all on function public.captivate_count_generations(text[], integer) from public;
grant execute on function public.captivate_count_generations(text[], integer) to authenticated;

-- The reservation counts the same way, inside the same locked transaction.
create or replace function public.captivate_reserve_generation(
  p_kind            text,
  p_count_kinds     text[],
  p_prompt          text,
  p_presentation_id uuid,
  p_window_minutes  integer,
  p_max             integer
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_presentation uuid := p_presentation_id;
  v_used integer;
  v_id uuid;
begin
  -- Fail closed. No identity, no reservation, and so no spend.
  if v_user is null then
    return null;
  end if;
  if p_max <= 0 or p_window_minutes <= 0 then
    return null;
  end if;

  -- Serialise this user's reservations for the rest of the transaction. Two
  -- concurrent calls would otherwise both read a count below the limit and
  -- both insert; this is the whole point of the function.
  perform pg_advisory_xact_lock(hashtext('captivate_ai:' || v_user::text));

  -- The function runs as definer, so RLS is not there to catch a caller who
  -- names a deck that is not theirs. Attribute the row to no deck rather than
  -- to someone else's.
  if v_presentation is not null and not public.captivate_owns_presentation(v_presentation) then
    v_presentation := null;
  end if;

  v_used := public.captivate_count_generations(p_count_kinds, p_window_minutes);

  if v_used >= p_max then
    return null;
  end if;

  insert into public.ai_generations (owner_id, presentation_id, kind, prompt, status)
  values (v_user, v_presentation, p_kind, left(coalesce(p_prompt, ''), 4000), 'pending')
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.captivate_reserve_generation(text, text[], text, uuid, integer, integer) from public;
grant execute on function public.captivate_reserve_generation(text, text[], text, uuid, integer, integer) to authenticated;
