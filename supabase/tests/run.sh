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
# Every migration, in filename order — not only 0001_captivate_core.sql. A
# harness that stopped at 0001 would let every RLS probe below "pass" while
# silently testing a schema years out of date; supabase/tests/rls_isolation
# .test.sql's migration-coverage checks exist to catch exactly that if this
# loop is ever narrowed back down to a single file.
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
if echo "$out" | grep -E "bob_sees_alice|bob_idor|bob_delete_alice" | grep -qvE "\|\s+0\s*$"; then
  echo "RLS LEAK DETECTED"; exit 1
fi
echo "RLS TESTS PASSED"
