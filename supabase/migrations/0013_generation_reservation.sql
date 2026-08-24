-- ---------------------------------------------------------------------------
-- Reserve before spending.
--
-- The AI rate limiter counted the caller's `ai_generations` rows and then let
-- the request through; the row itself was written after the model answered.
-- Everything between those two moments — the whole model call, seconds of it —
-- is a window in which the count does not move. A user one call below the
-- limit could fire fifty requests at once, have all fifty read the same count,
-- and spend all fifty. The limit bounded sequential use and nothing else, which
-- is not what a spend control is for.
--
-- The fix is to make counting and incrementing one operation. `reserve` counts
-- and inserts a pending row in the same transaction, under a per-user advisory
-- lock so two reservations cannot interleave, and returns null rather than a
-- ticket when the limit is reached — before anything is spent.
--
-- `complete` exists because the table deliberately has no UPDATE policy: a
-- caller must not be able to edit their own ledger, since the limiter counts
-- exactly those rows and editing them is how you would erase your spend. This
-- function is the one narrow exception, and it cannot be used for that: it
-- moves a row from pending to a terminal status and no other way, only for the
-- caller's own row, only once, and it never touches `kind`, `prompt`,
-- `owner_id` or `created_at`. A completed row still counts.
-- ---------------------------------------------------------------------------

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

  select count(*) into v_used
    from public.ai_generations g
   where g.owner_id = v_user
     and g.kind = any(p_count_kinds)
     and g.created_at >= now() - make_interval(mins => p_window_minutes);

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
  -- Pending is not a terminal status; allowing it back would let a caller
  -- park a row and re-complete it later with a different outcome.
  if p_status is null or p_status not in ('succeeded', 'failed', 'invalid_output') then
    return false;
  end if;

  update public.ai_generations
     set status         = p_status,
         model          = p_model,
         input_tokens   = p_input_tokens,
         output_tokens  = p_output_tokens,
         error_message  = left(p_error, 500),
         completed_at   = now()
   where id       = p_id
     and owner_id = v_user
     and status   = 'pending';

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.captivate_complete_generation(uuid, text, text, integer, integer, text) from public;
grant execute on function public.captivate_complete_generation(uuid, text, text, integer, integer, text) to authenticated;
