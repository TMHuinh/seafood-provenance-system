#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

source supabase/migration-lib.sh

MIGRATION_FILE=""

while getopts ":f:" OPTION; do
  case "$OPTION" in
    f) MIGRATION_FILE="$OPTARG" ;;
    :)
      echo "Error: option -$OPTARG requires a migration filename." >&2
      exit 1
      ;;
    \?)
      echo "Usage: ./supabase/migrate-down.sh [-f migration-file.sql]" >&2
      exit 1
      ;;
  esac
done

shift $((OPTIND - 1))

if [[ $# -ne 0 ]]; then
  echo "Usage: ./supabase/migrate-down.sh [-f migration-file.sql]" >&2
  exit 1
fi

ensure_database_running
ensure_migration_history

if [[ -n "$MIGRATION_FILE" ]]; then
  MIGRATION_BASENAME="$(basename "$MIGRATION_FILE")"

  if [[ "$MIGRATION_BASENAME" != *.sql ]]; then
    MIGRATION_BASENAME="${MIGRATION_BASENAME}.sql"
  fi

  validate_migration_filename "$MIGRATION_BASENAME"
  MIGRATION_VERSION="${MIGRATION_BASENAME%%_*}"
else
  MIGRATION_RECORD="$(latest_migration_record)"

  if [[ -z "$MIGRATION_RECORD" ]]; then
    echo "No applied migration is available to roll back."
    exit 0
  fi

  MIGRATION_VERSION="${MIGRATION_RECORD%%|*}"
  MIGRATION_BASENAME="${MIGRATION_RECORD#*|}"
fi

MIGRATION_PATH="supabase/migrations/$MIGRATION_BASENAME"

if [[ ! -f "$MIGRATION_PATH" ]]; then
  echo "Error: migration file not found: $MIGRATION_PATH" >&2
  exit 1
fi

if ! migration_is_applied "$MIGRATION_VERSION"; then
  echo "Error: migration is not currently applied: $MIGRATION_BASENAME" >&2
  exit 1
fi

require_migration_sections "$MIGRATION_PATH"

echo "down $MIGRATION_BASENAME"
echo "WARNING: this executes only the selected migration's down section."
echo "Newer migrations remain applied and may depend on it."
read -r -p "Continue? [y/N] " CONFIRMATION

if [[ ! "$CONFIRMATION" =~ ^[Yy]$ ]]; then
  echo "Rollback cancelled."
  exit 0
fi

{
  extract_migration_section "$MIGRATION_PATH" down
  printf '\ndelete from app_migrations.schema_migrations where version = '\''%s'\'';\n' \
    "$MIGRATION_VERSION"
} | run_psql_transaction

echo "Rolled back $MIGRATION_BASENAME."
print_migration_history
