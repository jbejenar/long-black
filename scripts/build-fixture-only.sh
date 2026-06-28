#!/usr/bin/env bash
set -euo pipefail

# build-fixture-only.sh — long-black dev loop: seed → flatten → verify → regression.
# Target: <30s, no download, no XML parsing. Mirrors flat-white's loop without
# the spatial/dual-path steps.
#
# Prereqsuite: Docker (the script brings up an ephemeral postgres:16).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$PROJECT_DIR/output"
OUTPUT_FILE="$OUTPUT_DIR/fixture.ndjson"
EXPECTED="$PROJECT_DIR/fixtures/expected-output.ndjson"

VERSION="${LONG_BLACK_VERSION:-2026.06.28}"
SCHEMA_VERSION="$(printf '%s' "$VERSION" | tr -cd '0-9')" # 20260628
PORT="${POSTGRES_PORT:-5433}"
DB_URL="postgres://postgres:postgres@localhost:${PORT}/abn"
COMPOSE="docker compose -f $PROJECT_DIR/docker-compose.yml"

START=$(date +%s)
mkdir -p "$OUTPUT_DIR"

echo "[fixture] ensuring postgres on port ${PORT}..."
POSTGRES_PORT="$PORT" $COMPOSE up db -d --wait

run_sql() { $COMPOSE exec -T db psql -U postgres -d abn -v ON_ERROR_STOP=1 -q "$@"; }
sed_ver() { sed "s/__SCHEMA_VERSION__/${SCHEMA_VERSION}/g" "$1"; }

echo "[fixture] resetting schema abn_${SCHEMA_VERSION}..."
printf 'DROP SCHEMA IF EXISTS abn_%s CASCADE;\n' "$SCHEMA_VERSION" | run_sql
sed_ver "$PROJECT_DIR/sql/staging-schema.sql" | run_sql
echo "[fixture] seeding ~20 fixture ABNs..."
sed_ver "$PROJECT_DIR/fixtures/seed-postgres.sql" | run_sql
sed_ver "$PROJECT_DIR/sql/abn-finalize.sql" | run_sql

echo "[fixture] building..."
npm run build --silent

echo "[fixture] flatten + verify..."
DATABASE_URL="$DB_URL" LONG_BLACK_VERSION="$VERSION" node "$PROJECT_DIR/dist/cli.js" "$OUTPUT_FILE"

LINE_COUNT=$(wc -l < "$OUTPUT_FILE" | tr -d ' ')
echo "[fixture] output: $LINE_COUNT documents"

if command -v jq >/dev/null 2>&1; then
  jq -c -e '.' "$OUTPUT_FILE" >/dev/null && echo "[fixture] jq: every line is valid JSON"
fi

if [ -f "$EXPECTED" ]; then
  if diff -q "$OUTPUT_FILE" "$EXPECTED" >/dev/null 2>&1; then
    echo "[fixture] regression: PASS (byte-for-byte match)"
  else
    echo "[fixture] regression: FAIL — output differs from expected-output.ndjson"
    diff "$EXPECTED" "$OUTPUT_FILE" | head -40
    exit 4
  fi
else
  echo "[fixture] NOTE: no expected-output.ndjson baseline yet."
  echo "          Review output/fixture.ndjson, then: cp output/fixture.ndjson fixtures/expected-output.ndjson"
fi

echo "[fixture] done in $(( $(date +%s) - START ))s"
