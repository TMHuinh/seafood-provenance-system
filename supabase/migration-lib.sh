#!/usr/bin/env bash

DB_CONTAINER="${SUPABASE_DB_CONTAINER:-seafood-supabase-db}"

ensure_database_running() {
  if [[ "$(docker inspect --format '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || true)" != "true" ]]; then
    echo "Error: local Supabase database container is not running: $DB_CONTAINER" >&2
    exit 1
  fi
}

run_psql() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres "$@"
}

run_psql_transaction() {
  docker exec -i "$DB_CONTAINER" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction
}

ensure_migration_history() {
  run_psql -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
create schema if not exists app_migrations;
create table if not exists app_migrations.schema_migrations (
  version text primary key,
  name text not null,
  applied_at timestamptz not null default now()
);
SQL
}

validate_migration_filename() {
  local filename="$1"

  if [[ ! "$filename" =~ ^[0-9]{14}_[A-Za-z0-9_-]+\.sql$ ]]; then
    echo "Error: invalid migration filename: $filename" >&2
    echo "Expected: <14-digit-timestamp>_<name>.sql" >&2
    exit 1
  fi
}

require_migration_sections() {
  local migration_path="$1"

  if ! grep -Eq '^[[:space:]]*--[[:space:]]+migrate:up[[:space:]]*$' "$migration_path"; then
    echo "Error: missing '-- migrate:up' in $migration_path" >&2
    exit 1
  fi

  if ! grep -Eq '^[[:space:]]*--[[:space:]]+migrate:down[[:space:]]*$' "$migration_path"; then
    echo "Error: missing '-- migrate:down' in $migration_path" >&2
    exit 1
  fi
}

extract_migration_section() {
  local migration_path="$1"
  local requested_section="$2"

  awk -v requested="$requested_section" '
    /^[[:space:]]*--[[:space:]]+migrate:up[[:space:]]*$/ {
      section = "up"
      next
    }
    /^[[:space:]]*--[[:space:]]+migrate:down[[:space:]]*$/ {
      section = "down"
      next
    }
    section == requested { print }
  ' "$migration_path"
}

migration_is_applied() {
  local version="$1"
  local result

  if [[ ! "$version" =~ ^[0-9]{14}$ ]]; then
    echo "Error: invalid migration version: $version" >&2
    exit 1
  fi

  result="$(run_psql -At \
    -c "select exists(select 1 from app_migrations.schema_migrations where version = '$version');")"
  [[ "$result" == "t" ]]
}

latest_migration_record() {
  run_psql -At -F '|' \
    -c 'select version, name from app_migrations.schema_migrations order by version desc limit 1;'
}

print_migration_history() {
  echo
  echo "Applied migrations:"
  run_psql -P pager=off \
    -c 'select version, name, applied_at from app_migrations.schema_migrations order by version;'
}
