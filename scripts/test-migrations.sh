#!/usr/bin/env bash
# Applies all migrations to a throwaway local PostgreSQL cluster (with a stub of
# Supabase's auth schema) and runs the RLS test suite.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-55432}"
cleanup() { "$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
RUNAS=()
if [ "$(id -u)" = "0" ]; then chown -R postgres "$TMP"; RUNAS=(runuser -u postgres --); fi
"${RUNAS[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP" -l "$TMP/log" start >/dev/null
PSQL=("${RUNAS[@]}" "$PGBIN/psql" -h "$TMP" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$ROOT/supabase/tests/auth_stub.sql"
"${PSQL[@]}" -c "create extension if not exists pgcrypto;"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f") as app_owner"
  "${PSQL[@]}" -U app_owner -d postgres -f "$f"
done
"${PSQL[@]}" -U app_owner -d postgres -f "$ROOT/supabase/seed.sql" >/dev/null
"${PSQL[@]}" -c "truncate public.clients, public.sources cascade;" 2>/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/tests/rls_test.sql"
