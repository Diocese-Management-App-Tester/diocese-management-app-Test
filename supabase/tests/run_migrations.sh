#!/bin/bash
# Rebuild a local database from scratch with the shim + all migrations.
# Usage: PGHOST=/tmp PGPORT=5433 supabase/tests/run_migrations.sh [last_number]
set -e
cd "$(dirname "$0")/../.."
PSQL="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-5433} -U ${PGUSER:-postgres} -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists app;" >/dev/null
$PSQL -d postgres -c "create database app;" >/dev/null
$PSQL -d app -f supabase/tests/local_shim.sql >/dev/null
# optional limit: a legacy number (51) or a full version (20260922120000);
# timestamped files (YYYYMMDDHHMMSS_*) always sort after the legacy 00NN ones
LAST=${1:-99999999999999}
for f in supabase/migrations/*.sql; do
  b=$(basename "$f"); v=${b%%_*}; n=${b:0:4}
  [ "$v" = "0002" ] && continue          # bootstrap owner needs a real auth user
  [ $((10#$v)) -gt $((10#$LAST)) ] && break
  if [ "$n" = "0005" ]; then             # enum value must be added outside the file's transaction
    $PSQL -d app -c "alter type public.approval_status add value if not exists 'suspended';" >/dev/null 2>&1 || true
    sed "/alter type public.approval_status add value/d" "$f" > /tmp/_m.sql; src=/tmp/_m.sql
  else src="$f"; fi
  if ! out=$($PSQL -d app -f "$src" 2>&1); then echo "FAILED $b"; echo "$out" | grep -iv "^notice" | head -15; exit 1; fi
  echo "ok $b"
done
