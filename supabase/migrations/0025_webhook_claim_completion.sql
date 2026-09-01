-- ---------------------------------------------------------------------------
-- A webhook claim that says whether the work was actually done.
--
-- `stripe_events` is the idempotency key for the whole billing integration: the
-- handler inserts the event id before doing anything, and a duplicate delivery
-- that collides with it returns 200 having changed nothing. Claiming first is
-- what makes a retry safe.
--
-- It is also what makes a *failed* attempt unsafe, and the first fix for that
-- was not good enough. The handler deleted its claim on the way out of a
-- failure so Stripe's retry would find nothing and re-process — but the delete
-- and the mutation talk to the same database, so the outage that failed the
-- credit insert is likely to fail the delete beside it. The handler still
-- answers 500, Stripe retries, the retry finds the claim that could not be
-- released, and returns a duplicate 200. A customer charged, and no credits,
-- permanently.
--
-- So the claim records whether it finished. A collision is only a duplicate if
-- the row it collided with was completed; a collision with an unfinished claim
-- is a previous attempt that died, and is re-processed. Every mutation behind
-- it is idempotent in its own right — the credit grant collides on the
-- Checkout Session id, the subscription is an upsert keyed by user, the
-- revocation is filtered to rows not already revoked — so processing twice is
-- safe where processing zero times is not.
-- ---------------------------------------------------------------------------
alter table public.stripe_events
  add column if not exists completed_at timestamptz;

comment on column public.stripe_events.completed_at is
  'When the handler finished this event. Null means a claim whose work did not complete, which a retry is allowed to redo — the duplicate short-circuit applies only to completed claims.';

-- Everything already in the table was processed under the old rule, where
-- reaching the insert at all meant the handler went on to finish. Marking them
-- complete keeps their retries short-circuiting exactly as they do today.
update public.stripe_events
   set completed_at = received_at
 where completed_at is null;
