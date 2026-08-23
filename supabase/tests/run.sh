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

# Every migration, in name order — the same way production applies them. A
# migration that only works because an earlier test run left state behind
# would be caught here, and so would one the stub cannot represent.
for migration in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$migration"
done

out=$(psql -q -d "$DB" -f supabase/tests/rls_isolation.test.sql 2>&1)
echo "$out"

if echo "$out" | grep -q "FAIL"; then echo "RLS TESTS FAILED"; exit 1; fi
if echo "$out" | grep -q "^psql.*ERROR"; then echo "RLS TESTS ERRORED"; exit 1; fi
# Every cross-user visibility probe must return zero rows.
if echo "$out" | grep -E "bob_sees_alice|bob_idor|bob_delete_alice|anon_sees" | grep -qvE "\|\s+0\s*$"; then
  echo "RLS LEAK DETECTED"; exit 1
fi
# Every share-link assertion must hold (1 = the stated property was observed).
if echo "$out" | grep -E "shared_link_" | grep -qvE "\|\s+1\s*$"; then
  echo "SHARE LINK TESTS FAILED"; exit 1
fi
# Same for the assets a shared deck can reference.
if echo "$out" | grep -E "shared_asset_" | grep -qvE "\|\s+1\s*$"; then
  echo "SHARED ASSET TESTS FAILED"; exit 1
fi
echo "RLS TESTS PASSED"
