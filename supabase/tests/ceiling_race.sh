#!/usr/bin/env bash
# Lowers the image ceilings while reservations are already queued, and asserts
# that the reservations honour the new number rather than the old one.
#
# The reservation reads `ai_image_limits` and then decides. Whether those two
# things are one decision or two is decided by where the budget lock sits: read
# the ceilings before taking it and a queue of callers each holds the numbers
# from before an operator lowered them, then enters the critical section one by
# one and is admitted against a budget that no longer exists. Lowering a budget
# has to bind the requests already in flight — that is the moment a spending
# safeguard is for — so this is not a nicety about ordering, and no serial test
# can see it. The workers below are genuinely inside the function and genuinely
# waiting on the lock at the instant the update commits.
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="${CAPTIVATE_TEST_DB:-cap_test}"
CONCURRENCY="${CAPTIVATE_RACE_CONCURRENCY:-8}"
USER_ID='11111111-1111-1111-1111-111111111111'
BARRIER=910312

# Headroom in both directions: a stale read admits every worker, and the budget
# the operator commits refuses every worker whatever the month already holds.
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c \
  "update public.ai_image_limits set cost_usd = 0.01, monthly_budget = 1000000, daily_max = 1000000;"
before=$(psql -q -t -A -d "$DB" -c "select count(*) from public.ai_generations where kind = 'image';")

tmp=$(mktemp -d)
barrier_fifo="$tmp/barrier"
operator_fifo="$tmp/operator"
mkfifo "$barrier_fifo" "$operator_fifo"
cleanup() { exec 8>&- 9>&- 2>/dev/null || true; rm -rf "$tmp"; }
trap cleanup EXIT

# Two controllers. One holds the starting barrier; the other holds the budget
# lock the function itself takes, so that every worker is stopped inside the
# critical section rather than merely started.
psql -q -t -A -d "$DB" -f "$barrier_fifo" > /dev/null 2>&1 &
exec 9> "$barrier_fifo"
echo "select pg_advisory_lock(${BARRIER});" >&9

psql -q -t -A -d "$DB" -f "$operator_fifo" > "$tmp/operator.out" 2>&1 &
exec 8> "$operator_fifo"
echo "begin; select pg_advisory_xact_lock(hashtext('captivate_image_budget'));" >&8
# The lock has to be held before any worker enters the function, or a worker
# passes straight through and the test proves nothing about either ordering.
waited=0
until [ "$(psql -q -t -A -d "$DB" -c "select count(*) from pg_locks where locktype = 'advisory' and objid <> ${BARRIER} and granted;")" -ge 1 ]; do
  waited=$((waited + 1))
  if [ "$waited" -gt 300 ]; then echo "CEILING RACE FAILED: the operator never took the budget lock"; exit 1; fi
  sleep 0.1
done

for i in $(seq 1 "$CONCURRENCY"); do
  psql -q -t -A -d "$DB" > "$tmp/out.$i" 2>/dev/null <<SQL &
set role authenticated;
set "request.jwt.claim.sub" = '${USER_ID}';
select pg_advisory_lock_shared(${BARRIER});
select * from public.captivate_reserve_image_generation('ceiling race', null::uuid);
SQL
done

waited=0
until [ "$(psql -q -t -A -d "$DB" -c "select count(*) from pg_locks where locktype = 'advisory' and objid = ${BARRIER} and not granted;")" -ge "$((CONCURRENCY - 1))" ]; do
  waited=$((waited + 1))
  if [ "$waited" -gt 600 ]; then echo "CEILING RACE FAILED: workers never reached the barrier"; exit 1; fi
  sleep 0.1
done
echo "select pg_advisory_unlock(${BARRIER});" >&9
exec 9>&-

# Every worker now queued on the budget lock is a request in flight. Waiting for
# all of them is what makes the assertion below about the fix rather than about
# who happened to win a scheduler race.
waited=0
until [ "$(psql -q -t -A -d "$DB" -c "select count(*) from pg_locks where locktype = 'advisory' and objid <> ${BARRIER} and not granted;")" -ge "$CONCURRENCY" ]; do
  waited=$((waited + 1))
  if [ "$waited" -gt 600 ]; then
    echo "CEILING RACE FAILED: only $(psql -q -t -A -d "$DB" -c "select count(*) from pg_locks where locktype='advisory' and objid <> ${BARRIER} and not granted;") of ${CONCURRENCY} workers reached the budget lock"
    exit 1
  fi
  sleep 0.1
done

echo "update public.ai_image_limits set monthly_budget = 0; commit;" >&8
exec 8>&-
wait

issued=$(cat "$tmp"/out.* | grep -c '^[0-9a-f]\{8\}-' || true)
refused=$(cat "$tmp"/out.* | grep -c '^|budget|' || true)
after=$(psql -q -t -A -d "$DB" -c "select count(*) from public.ai_generations where kind = 'image';")
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c \
  "update public.ai_image_limits set cost_usd = 0.05, monthly_budget = 100.00, daily_max = 25;" > /dev/null

echo "queued=${CONCURRENCY} tickets_issued=${issued} refused_budget=${refused} rows_written=$((after - before))"
if [ "$issued" != "0" ] || [ "$refused" != "$CONCURRENCY" ] || [ "$((after - before))" != "0" ]; then
  echo "CEILING RACE FAILED: a budget lowered to 0 still admitted ${issued} of ${CONCURRENCY} queued reservations"
  exit 1
fi
echo "CEILING RACE PASSED"
