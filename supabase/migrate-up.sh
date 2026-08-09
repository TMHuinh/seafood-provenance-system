#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

source supabase/migration-lib.sh

ensure_database_running
ensure_migration_history

mapfile -d '' MIGRATION_FILES < <(
  find supabase/migrations -maxdepth 1 -type f -name '*.sql' -print0 | sort -z
)

APPLIED_COUNT=0

for MIGRATION_PATH in "${MIGRATION_FILES[@]}"; do
  MIGRATION_BASENAME="$(basename "$MIGRATION_PATH")"
  validate_migration_filename "$MIGRATION_BASENAME"
  MIGRATION_VERSION="$(migration_version_from_filename "$MIGRATION_BASENAME")"

  if migration_is_applied "$MIGRATION_VERSION"; then
    echo "skip $MIGRATION_BASENAME"
    continue
  fi

  require_migration_sections "$MIGRATION_PATH"
  echo "up   $MIGRATION_BASENAME"

  {
    extract_migration_section "$MIGRATION_PATH" up
    printf '\ninsert into app_migrations.schema_migrations (version, name) values ('\''%s'\'', '\''%s'\'');\n' \
      "$MIGRATION_VERSION" "$MIGRATION_BASENAME"
  } | run_psql_transaction

  APPLIED_COUNT=$((APPLIED_COUNT + 1))
done

if (( APPLIED_COUNT == 0 )); then
  echo "Database is already up to date."
else
  echo "Applied $APPLIED_COUNT migration(s)."
fi

print_migration_history
