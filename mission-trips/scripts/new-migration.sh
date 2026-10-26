#!/usr/bin/env bash
# Creates a migration from schema.prisma changes without an interactive prompt.
# Usage: scripts/new-migration.sh short_name
set -euo pipefail
name="${1:?usage: scripts/new-migration.sh short_name}"
dir="prisma/migrations/$(date -u +%Y%m%d%H%M%S)_${name}"
mkdir -p "$dir"
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > "$dir/migration.sql"
echo "Created $dir/migration.sql — review it, then run: npx prisma migrate deploy && npx prisma generate"
