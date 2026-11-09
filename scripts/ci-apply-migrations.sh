#!/bin/sh
set -e

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-55325}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-mega_auction_test}"

echo "=== Applying CI Database Bootstrap ==="
psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -f scripts/ci-db-bootstrap.sql

MIGRATION_FILES=$(git ls-files 'supabase/migrations/*.sql' | sort -V)
TOTAL_MIGRATIONS=$(echo "$MIGRATION_FILES" | wc -l | tr -d ' ')

if [ "$TOTAL_MIGRATIONS" -eq 0 ]; then
  echo "::error::No migration files found in supabase/migrations/!"
  exit 1
fi

echo "=== Applying $TOTAL_MIGRATIONS Canonical Migrations in Version Order ==="
COUNT=0
for file in $MIGRATION_FILES; do
  if [ ! -s "$file" ]; then
    echo "::error::Canonical migration is empty or missing: $file"
    exit 1
  fi
  COUNT=$((COUNT + 1))
  echo "[$COUNT/$TOTAL_MIGRATIONS] Applying $file..."
  psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -f "$file" > /dev/null
done

echo "=== All $COUNT Canonical Migrations Applied Successfully ==="
