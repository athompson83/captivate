#!/usr/bin/env bash
# Applies the Captivate migrations to a throwaway local Postgres database and
# asserts that row level security actually isolates two users from each other.
#
# Requires a running Postgres reachable via the PG* environment variables.
#   PGHOST=/tmp PGPORT=55432 PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="${CAPTIVATE_TEST_DB:-cap_test}"
psql -q -d postgres -c "drop database if exists ${DB};" -c "create database ${DB};"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/_supabase_stub.sql
# Every migration, in filename order — the same way production applies them,
# and not only 0001_captivate_core.sql. A harness that stopped at 0001 would
# let every RLS probe below "pass" while silently testing a schema years out
# of date; rls_isolation.test.sql's migration-coverage checks exist to catch
# exactly that if this loop is ever narrowed back down. Applying the whole set
# in order also catches a migration that only works because an earlier run
# left state behind, and one the stub cannot represent.
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done

# `|| true` because the test file sets ON_ERROR_STOP, so a raised FAIL exits
# psql non-zero — and under `set -e` that would abort this script at the
# assignment, before the output is ever printed. A failing RLS probe would
# then surface in CI as a bare exit code with nothing to read, which is how a
# real failure gets mistaken for infrastructure flake. Print first, judge after.
out=$(psql -q -d "$DB" -f supabase/tests/rls_isolation.test.sql 2>&1) || true
echo "$out"

if echo "$out" | grep -q "FAIL"; then echo "RLS TESTS FAILED"; exit 1; fi
if echo "$out" | grep -q "^psql.*ERROR"; then echo "RLS TESTS ERRORED"; exit 1; fi
# The fixtures must actually exist. Every probe above asserts that Bob sees
# zero rows — which is also exactly what happens if Alice's inserts silently
# failed and there was never anything to see. Without this the whole suite can
# report PASS while proving nothing at all.
if echo "$out" | grep -E "alice_[a-z_]*intact" | grep -qE "\|\s+0\s*$"; then
  echo "FIXTURES MISSING: alice's rows were not created, so the isolation probes proved nothing"
  exit 1
fi

# Every cross-user visibility probe must return zero rows.
if echo "$out" | grep -E "bob_sees_alice|bob_idor|bob_delete_alice|anon_sees|bob_completes|bob_settles" | grep -qvE "\|\s+0\s*$"; then
  echo "RLS LEAK DETECTED"; exit 1
fi
# The image budget. `bob_settles_alice_image` must be 0 and is covered by the
# cross-user rule above; every other image_* probe states a property that holds.
if echo "$out" | grep -E "image_" | grep -vE "bob_settles" | grep -qvE "\|\s+1\s*$"; then
  echo "IMAGE BUDGET TESTS FAILED"; exit 1
fi

# The reservation ticket: every probe states a property that must hold.
# `bob_completes_alice_reservation` is the exception and is covered by the
# cross-user rule above — it must come back 0.
if echo "$out" | grep -E "reserve_|complete_|alice_reservation" | grep -vE "bob_completes" | grep -qvE "\|\s+1\s*$"; then
  echo "AI RESERVATION TESTS FAILED"; exit 1
fi

# Every share-link assertion must hold (1 = the stated property was observed).
if echo "$out" | grep -E "shared_link_" | grep -qvE "\|\s+1\s*$"; then
  echo "SHARE LINK TESTS FAILED"; exit 1
fi
# Same for the assets a shared deck can reference.
if echo "$out" | grep -E "shared_asset_" | grep -qvE "\|\s+1\s*$"; then
  echo "SHARED ASSET TESTS FAILED"; exit 1
fi
# The one property no single-connection probe can show: that the reservation
# limit holds when the callers arrive together, which is the case it exists for.
"$(dirname "$0")/reservation_race.sh"

echo "RLS TESTS PASSED"
