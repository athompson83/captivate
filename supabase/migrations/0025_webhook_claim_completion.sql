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

-- Rows already in the table keep a null `completed_at`, and that is the point.
--
-- The first draft of this migration backfilled them to `received_at`, on the
-- reasoning that under the old rule reaching the insert at all meant the
-- handler went on to finish. It did not: the old rule deleted the claim on the
-- way out of a failure, so a legacy row can also be an attempt whose mutation
-- *and* whose cleanup delete both failed — the exact correlated failure this
-- column exists to fix. Marking those complete would make the fix skip the
-- only rows that need it, and a Stripe retry would go on returning a duplicate
-- 200 over a customer who paid and was never credited.
--
-- Leaving them unfinished costs a re-process on a retried legacy event, which
-- is safe: every mutation behind the claim is idempotent in its own right, and
-- Stripe stops retrying after a few days, so the window in which this can
-- happen at all closes on its own. Redoing idempotent work is the cheaper
-- mistake than never doing it.
