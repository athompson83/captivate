-- ---------------------------------------------------------------------------
-- The two lookup helpers 0022 and 0024 added, with their search_path pinned.
--
-- Neither can actually be redirected: both are `immutable` SQL over a literal
-- `case`, they name no relation and call nothing, and they run as invoker. So
-- this closes no live hole. It is here because the repository's rule is that a
-- helper in this schema pins its search_path, and because Supabase's linter
-- flags every function that does not — which means the two of them sit in the
-- security advisor forever, next to findings that do matter, teaching whoever
-- reads it next that warnings there are noise.
--
-- `create or replace` rather than a `drop`: the signatures are unchanged, so
-- there is no second overload to leave behind, and replacing keeps the grants
-- 0022 and 0024 set rather than silently resetting them to Supabase's
-- defaults — which include `anon`.
-- ---------------------------------------------------------------------------
create or replace function public.captivate_budget_kinds(p_group text)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_group
    when 'deck'    then array['scenes', 'presentation']
    when 'draft'   then array['map', 'scene']
    when 'drawing' then array['drawing']
    when 'light'   then array['moment', 'rewrite', 'speaker_notes', 'visuals', 'flow']
  end;
$$;

create or replace function public.captivate_per_presentation(p_group text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_group
    when 'deck'    then 1
    when 'draft'   then 2
    when 'drawing' then 10
    when 'light'   then 10
  end;
$$;

-- Restated rather than assumed. A `create or replace` keeps existing grants,
-- but stating them here means this file is still correct if it is ever applied
-- to a database where the earlier migration's revokes did not take.
revoke all on function public.captivate_budget_kinds(text) from public;
revoke all on function public.captivate_budget_kinds(text) from anon;
grant execute on function public.captivate_budget_kinds(text) to authenticated;

revoke all on function public.captivate_per_presentation(text) from public;
revoke all on function public.captivate_per_presentation(text) from anon;
grant execute on function public.captivate_per_presentation(text) to authenticated;
