-- ---------------------------------------------------------------------------
-- The spend ledger is not the caller's to rewrite.
--
-- `captivate_complete_generation` and `captivate_settle_image_generation` are
-- called by the server with the *author's own* JWT, because that is the client
-- a route handler already has. Nothing on the wire distinguishes those calls
-- from the same RPC issued straight from a browser: both arrive at PostgREST as
-- `authenticated`, and `ai_generations` is selectable by its owner, so the id
-- of a pending reservation is one query away.
--
-- That turned two accounting refinements into ways of spending nothing:
--
--   * 0018 stopped charging an allowance for a call that never reached the
--     model, keyed on `failed` with no output tokens. An author could settle
--     their own in-flight reservation into exactly that state, keep the answer
--     the server was already generating, and repeat — the free plan's ten decks
--     a month became unbounded;
--   * an image settlement could write any `cost_usd` it liked. Zero freed the
--     deployment's shared monthly budget; a large one exhausted it for
--     everybody. The application never used the parameter for anything but
--     echoing back the estimate it had already reserved.
--
-- No check *inside* these functions can tell the server from the author: they
-- hold the same credential, so any rule one can satisfy the other can satisfy
-- too. What is true regardless is that the server writes the truth **last** —
-- it settles after the model has answered. So the rule is supersession rather
-- than refusal: a settlement that recorded spend is final, and one that
-- recorded none may still be corrected. A forged refund is overwritten by the
-- real result a moment later, and cannot be re-forged afterwards.
--
-- Residual, and deliberately not defended here: an author who forges the refund
-- and then aborts the request may leave the row uncharged, at the price of the
-- answer they were generating. That trade buys them nothing, so it is not worth
-- a service-role dependency the deployment guide lists as optional.
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

  update public.ai_generations
     set status         = p_status,
         model          = p_model,
         input_tokens   = p_input_tokens,
         output_tokens  = p_output_tokens,
         error_message  = left(p_error, 500),
         completed_at   = now()
   where id       = p_id
     and owner_id  = v_user
     -- Final once the row says the model delivered something: either tokens
     -- were billed, or the call is marked succeeded. Short of that the row
     -- has cost nobody anything yet, so correcting it is free — and that is
     -- the whole mechanism, because the server's write is the later one.
     and status   <> 'succeeded'
     and coalesce(output_tokens, 0) = 0;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- What an image settlement is allowed to touch.
--
-- The reservation already wrote the estimate, under the lock that checked it
-- against the monthly budget. Settling records how the call went — status,
-- model, duration — and no longer restates the price. `p_cost_usd` is gone
-- rather than ignored: a parameter that silently does nothing is worse than
-- one that isn't there.
-- ---------------------------------------------------------------------------

drop function if exists public.captivate_settle_image_generation(uuid, text, numeric, text, integer, text);

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

-- ---------------------------------------------------------------------------
-- Grants.
--
-- Every function here returns false or null when `auth.uid()` is null, so a
-- signed-out caller could never do anything with them — but Supabase grants
-- `anon` EXECUTE on new functions by default, and `revoke ... from public`
-- does not take that back, because it is a grant to the role rather than
-- through PUBLIC. Revoking it removes five signed-out entry points from the
-- exposed API surface that were only ever guarded from the inside.
--
-- The phone remote's channel gate is here for the same reason and one more:
-- `rls_isolation.test.sql` already asserts that `anon` "cannot even ask" for
-- it, and that assertion has been passing against a harness where the role
-- never held the grant to begin with. 0014 revoked it from PUBLIC, which was
-- never the grant that mattered. The harness now models Supabase's default
-- privileges, so the claim and the deployment finally agree.
--
-- The share-link functions are deliberately not in this list: `anon` calling
-- them is the entire point of a share link.
-- ---------------------------------------------------------------------------

revoke all on function public.captivate_complete_generation(uuid, text, text, integer, integer, text) from public, anon;
grant execute on function public.captivate_complete_generation(uuid, text, text, integer, integer, text) to authenticated;

revoke all on function public.captivate_settle_image_generation(uuid, text, text, integer, text) from public, anon;
grant execute on function public.captivate_settle_image_generation(uuid, text, text, integer, text) to authenticated;

revoke all on function public.captivate_count_generations(text[], integer) from public, anon;
grant execute on function public.captivate_count_generations(text[], integer) to authenticated;

revoke all on function public.captivate_reserve_generation(text, text[], text, uuid, integer, integer) from public, anon;
grant execute on function public.captivate_reserve_generation(text, text[], text, uuid, integer, integer) to authenticated;

revoke all on function public.captivate_reserve_image_generation(text, uuid, numeric, numeric, integer) from public, anon;
grant execute on function public.captivate_reserve_image_generation(text, uuid, numeric, numeric, integer) to authenticated;

revoke all on function public.captivate_remote_topic_open(text) from public, anon;
grant execute on function public.captivate_remote_topic_open(text) to authenticated;
