#!/bin/sh
# Runs inside a temporary postgres:17-alpine container with no external network.
set -eu
export PGHOST=/tmp PGUSER=postgres PGDATABASE=seafood_org_test
pgdata=$(mktemp -d)
initdb -D "$pgdata" --auth=trust >/dev/null
pg_ctl -D "$pgdata" -o '-k /tmp -h ""' -l "$pgdata/log" -w start >/dev/null
PGDATABASE=postgres createdb seafood_org_test
psql -Xq -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
SQL

cd /repo/supabase
for migration in migrations/*.sql; do
  echo "Apply $migration"
  sed '/^-- migrate:down/,$d' "$migration" | psql -Xq -v ON_ERROR_STOP=1
done
if [ "$#" -eq 0 ]; then
  set -- tests/*.sql
fi
for test in "$@"; do
  case "$test" in tests/*.sql) ;; *) echo "Invalid test path: $test" >&2; exit 1 ;; esac
  psql -Xq -v ON_ERROR_STOP=1 -f "$test"
  echo "PASS $test"
done
sh tests/check-concurrent-household.sh
