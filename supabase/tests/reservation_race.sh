#!/usr/bin/env bash
# Fires N genuinely simultaneous reservations at a limit of one and counts the
# tickets issued. Exactly one may come back.
#
# This is the only property of `captivate_reserve_generation` that cannot be
# shown from a single connection, and it is the property the function exists
# for: the old limiter counted rows and then let the request through, so
# concurrent callers all read the same count and all spent. A serial test
# passes against that bug, and so does a naive `psql &` loop — process startup
# staggers the workers far enough apart that they never overlap. So the workers
# park on a shared advisory lock the controller holds exclusively, and all
# enter the function in the same instant when it is released.
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="${CAPTIVATE_TEST_DB:-cap_test}"
CONCURRENCY="${CAPTIVATE_RACE_CONCURRENCY:-24}"
# Any user with an auth.users row; the fixture's Alice.
USER_ID='11111111-1111-1111-1111-111111111111'
KIND="race_$$"
BARRIER=910311

tmp=$(mktemp -d)
controller_fifo="$tmp/controller"
mkfifo "$controller_fifo"
cleanup() { exec 9>&- 2>/dev/null || true; rm -rf "$tmp"; }
trap cleanup EXIT

# The controller holds the barrier exclusively until every worker is queued.
psql -q -t -A -d "$DB" -f "$controller_fifo" > /dev/null 2>&1 &
exec 9> "$controller_fifo"
echo "select pg_advisory_lock(${BARRIER});" >&9

for i in $(seq 1 "$CONCURRENCY"); do
  psql -q -t -A -d "$DB" > "$tmp/out.$i" 2>/dev/null <<SQL &
set role authenticated;
set "request.jwt.claim.sub" = '${USER_ID}';
select pg_advisory_lock_shared(${BARRIER});
select public.captivate_reserve_generation('${KIND}', array['${KIND}'], 'race', null, 60, 1);
SQL
done

# Wait for every worker to reach the barrier, then release them together.
# Bounded: a worker that never arrives is a broken test, not a reason to hang
# a CI job until the runner is killed.
waited=0
until [ "$(psql -q -t -A -d "$DB" -c "select count(*) from pg_locks where locktype = 'advisory' and objid = ${BARRIER} and not granted;")" -ge "$((CONCURRENCY - 1))" ]; do
  waited=$((waited + 1))
  if [ "$waited" -gt 600 ]; then
    echo "RESERVATION RACE FAILED: workers never reached the barrier"
    exit 1
  fi
  sleep 0.1
done
echo "select pg_advisory_unlock(${BARRIER});" >&9
exec 9>&-
wait

issued=$(cat "$tmp"/out.* | grep -c '^[0-9a-f]\{8\}-' || true)
rows=$(psql -q -t -A -d "$DB" -c "select count(*) from public.ai_generations where kind = '${KIND}';")

echo "concurrency=${CONCURRENCY} tickets_issued=${issued} rows_written=${rows}"
if [ "$issued" != "1" ] || [ "$rows" != "1" ]; then
  echo "RESERVATION RACE FAILED: a limit of one issued ${issued} tickets and wrote ${rows} rows"
  exit 1
fi
echo "RESERVATION RACE PASSED"
