#!/usr/bin/env bash
# Fires N genuinely simultaneous reservations at a ceiling with one place left
# and counts the tickets issued. Exactly one may come back — for *each* of the
# two ceilings a plan has.
#
# This is the only property of `captivate_reserve_generation` that cannot be
# shown from a single connection, and it is the property the function exists
# for: the old limiter counted rows and then let the request through, so
# concurrent callers all read the same count and all spent. A serial test
# passes against that bug, and so does a naive `psql &` loop — process startup
# staggers the workers far enough apart that they never overlap. So the workers
# park on a shared advisory lock the controller holds exclusively, and all
# enter the function in the same instant when it is released.
#
# Both ceilings are raced, because for a while only one of them was inside the
# lock. The hourly burst ceiling was checked by the application before calling
# this function — a read anybody can simply decline to perform, and one that
# two simultaneous callers both pass. Racing only the 30-day allowance would
# have gone on passing throughout.
#
# The ceilings are no longer arguments, so the race is set up by *spending*: a
# user is left with exactly one place under the ceiling being tested, and the
# other ceiling is given room so it cannot be the thing that refuses.
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="${CAPTIVATE_TEST_DB:-cap_test}"
CONCURRENCY="${CAPTIVATE_RACE_CONCURRENCY:-24}"
BARRIER=910311

# A user of its own, on the free plan: ten decks in 30 days, three in an hour.
USER_ID='33333333-3333-3333-3333-333333333333'
psql -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null <<SQL
insert into auth.users (id, email) values ('${USER_ID}', 'race@example.com') on conflict do nothing;
delete from public.subscriptions where user_id = '${USER_ID}';
delete from public.plan_grants where user_id = '${USER_ID}';
SQL

# Leaves exactly one place under the named ceiling.
#
#   burst     — two decks inside the hour, so the hourly three has one left and
#               the 30-day ten has eight.
#   allowance — nine decks five hours ago, so the 30-day ten has one left and
#               the hourly three is untouched.
setup() {
  local mode="$1" count age
  if [ "$mode" = "burst" ]; then count=2; age='1 minute'; else count=9; age='5 hours'; fi
  psql -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null <<SQL
delete from public.ai_generations where owner_id = '${USER_ID}';
insert into public.ai_generations (owner_id, kind, prompt, status, created_at, output_tokens)
select '${USER_ID}', 'scenes', 'race', 'succeeded', now() - interval '${age}', 100
from generate_series(1, ${count});
SQL
}

race() {
  local mode="$1"
  setup "$mode"
  local before
  before=$(psql -q -t -A -d "$DB" -c "select count(*) from public.ai_generations where owner_id = '${USER_ID}';")

  local tmp
  tmp=$(mktemp -d)
  local fifo="$tmp/controller"
  mkfifo "$fifo"

  # The controller holds the barrier exclusively until every worker is queued.
  psql -q -t -A -d "$DB" -f "$fifo" > /dev/null 2>&1 &
  exec 9> "$fifo"
  echo "select pg_advisory_lock(${BARRIER});" >&9

  local i
  for i in $(seq 1 "$CONCURRENCY"); do
    psql -q -t -A -d "$DB" > "$tmp/out.$i" 2>/dev/null <<SQL &
set role authenticated;
set "request.jwt.claim.sub" = '${USER_ID}';
select pg_advisory_lock_shared(${BARRIER});
select * from public.captivate_reserve_generation('scenes', 'deck', 'race', null::uuid);
SQL
  done

  # Wait for every worker to reach the barrier, then release them together.
  # Bounded: a worker that never arrives is a broken test, not a reason to hang
  # a CI job until the runner is killed.
  local waited=0
  until [ "$(psql -q -t -A -d "$DB" -c "select count(*) from pg_locks where locktype = 'advisory' and objid = ${BARRIER} and not granted;")" -ge "$((CONCURRENCY - 1))" ]; do
    waited=$((waited + 1))
    if [ "$waited" -gt 600 ]; then
      echo "RESERVATION RACE FAILED (${mode}): workers never reached the barrier"
      exec 9>&- 2>/dev/null || true; rm -rf "$tmp"; exit 1
    fi
    sleep 0.1
  done
  echo "select pg_advisory_unlock(${BARRIER});" >&9
  exec 9>&-
  wait

  local issued refused after
  issued=$(cat "$tmp"/out.* | grep -c '^[0-9a-f]\{8\}-' || true)
  refused=$(cat "$tmp"/out.* | grep -c "|${mode}|" || true)
  after=$(psql -q -t -A -d "$DB" -c "select count(*) from public.ai_generations where owner_id = '${USER_ID}';")
  rm -rf "$tmp"

  echo "${mode}: concurrency=${CONCURRENCY} tickets_issued=${issued} refused_${mode}=${refused} rows_written=$((after - before))"
  if [ "$issued" != "1" ] || [ "$((after - before))" != "1" ]; then
    echo "RESERVATION RACE FAILED (${mode}): one place left issued ${issued} tickets and wrote $((after - before)) rows"
    exit 1
  fi
  # Everybody who lost must have lost to the ceiling under test, not to the
  # other one — otherwise the setup, not the lock, is what held the line.
  if [ "$refused" != "$((CONCURRENCY - 1))" ]; then
    echo "RESERVATION RACE FAILED (${mode}): ${refused} of $((CONCURRENCY - 1)) losers cited the ${mode} ceiling"
    exit 1
  fi
}

race burst
race allowance
psql -q -d "$DB" -c "delete from public.ai_generations where owner_id = '${USER_ID}';" > /dev/null
echo "RESERVATION RACE PASSED"
