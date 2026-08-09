#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 <<'SQL'
create schema if not exists app_migrations;
create table if not exists app_migrations.schema_migrations (
  version text primary key,
  name text not null,
  applied_at timestamptz not null default now()
);
SQL

for migration_path in /migrations/*.sql; do
  [ -f "$migration_path" ] || continue
  filename=$(basename "$migration_path")
  version=$(printf '%s\n' "$filename" | cut -d_ -f1,2)

  if ! printf '%s\n' "$filename" | grep -Eq '^[0-9]{8}_[0-9]{3}_[A-Za-z0-9_-]+\.sql$'; then
    echo "Invalid migration filename: $filename" >&2
    echo "Expected: <DDMMYYYY>_<3-digit-sequence>_<name>.sql" >&2
    exit 1
  fi

  applied=$(psql -At -v ON_ERROR_STOP=1 \
    -c "select exists(select 1 from app_migrations.schema_migrations where version = '$version');")
  if [ "$applied" = "t" ]; then
    echo "skip $filename"
    continue
  fi

  grep -Eq '^[[:space:]]*--[[:space:]]+migrate:up[[:space:]]*$' "$migration_path" || exit 1
  grep -Eq '^[[:space:]]*--[[:space:]]+migrate:down[[:space:]]*$' "$migration_path" || exit 1

  echo "up   $filename"
  {
    awk '
      /^[[:space:]]*--[[:space:]]+migrate:up[[:space:]]*$/ { section="up"; next }
      /^[[:space:]]*--[[:space:]]+migrate:down[[:space:]]*$/ { section="down"; next }
      section == "up" { print }
    ' "$migration_path"
    printf "\ninsert into app_migrations.schema_migrations (version, name) values ('%s', '%s');\n" "$version" "$filename"
  } | psql -v ON_ERROR_STOP=1 --single-transaction
done

echo "Database migrations are up to date."
