#!/usr/bin/env bash
set -euo pipefail

# build-local.sh — full real-data build (P1b "ABR core green").
#   download → load (saxes XML → COPY) → finalize → flatten → verify
#
# Downloads the real ABR ABN Bulk Extract (~1 GB compressed → ~6-8 GB XML,
# ~15M records) — a heavyweight, slow run. Requires Docker.
#
#   LONG_BLACK_VERSION=2026.06.25 ./scripts/build-local.sh
#
# LONG_BLACK_VERSION is the ABR extract date (YYYY.MM.DD), used for the schema
# suffix and document _version. (A future increment derives it from the extract
# TransferInfo/ExtractTime automatically.)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

VERSION="${LONG_BLACK_VERSION:?set LONG_BLACK_VERSION=YYYY.MM.DD (the ABR extract date)}"
SV="$(printf '%s' "$VERSION" | tr -cd '0-9')"
PORT="${POSTGRES_PORT:-5433}"
DB="postgres://postgres:postgres@localhost:${PORT}/abn"
CF="$PROJECT_DIR/docker-compose.yml"
DATA_DIR="$PROJECT_DIR/data"
OUTPUT="$PROJECT_DIR/output/long-black-${VERSION}.ndjson"

runsql() { docker compose -f "$CF" exec -T db psql -U postgres -d abn -v ON_ERROR_STOP=1 -q; }
sed_ver() { sed "s/__SCHEMA_VERSION__/${SV}/g" "$1"; }

mkdir -p "$DATA_DIR" "$PROJECT_DIR/output"
echo "[build-local] ensuring postgres on port ${PORT}..."
POSTGRES_PORT="$PORT" docker compose -f "$CF" up db -d --wait

echo "[build-local] building..."
npm run build --silent

echo "[build-local] downloading ABN Bulk Extract (this is large)..."
# `mapfile`/`readarray` is bash 4+; macOS ships bash 3.2, so read into the array
# portably. download-cli.js prints one XML path per line on stdout (logs go to stderr).
XML=()
while IFS= read -r f; do [ -n "$f" ] && XML+=("$f"); done < <(DATA_DIR="$DATA_DIR" node dist/download-cli.js)
echo "[build-local] ${#XML[@]} XML files."

echo "[build-local] (re)creating schema abn_${SV}..."
printf 'DROP SCHEMA IF EXISTS abn_%s CASCADE;\n' "$SV" | runsql
sed_ver sql/staging-schema.sql | runsql

echo "[build-local] loading (saxes XML → COPY)..."
DATABASE_URL="$DB" LONG_BLACK_VERSION="$VERSION" node dist/load-cli.js "${XML[@]}"

echo "[build-local] finalizing (PK + indexes)..."
sed_ver sql/abn-finalize.sql | runsql

# Enrichment is REQUIRED — the data must be complete before shipping. Each source
# must load above its floor (enrich-cli) or this aborts. Set ALLOW_PARTIAL=true to
# deliberately build with a degraded source (disables the coverage gate too).
echo "[build-local] enrichment (7 sources: ASIC Company/Business Names/AFS/credit/banned + ACNC register/AIS — required)..."
COVERAGE_PROFILE=production
if DATA_DIR="$DATA_DIR" DATABASE_URL="$DB" LONG_BLACK_VERSION="$VERSION" node dist/enrich-cli.js; then
  echo "[build-local] enrichment complete"
elif [ "${ALLOW_PARTIAL:-}" = "true" ]; then
  echo "[build-local] WARNING: enrichment incomplete, ALLOW_PARTIAL=true — shipping degraded data"
  COVERAGE_PROFILE=off
else
  echo "[build-local] ERROR: enrichment incomplete — refusing to continue (ALLOW_PARTIAL=true to override)"
  exit 1
fi

echo "[build-local] flatten + verify (+ enrichment coverage gate)..."
DATABASE_URL="$DB" LONG_BLACK_VERSION="$VERSION" LONG_BLACK_COVERAGE_PROFILE="$COVERAGE_PROFILE" \
  node dist/cli.js "$OUTPUT"

echo "[build-local] output (split per-state + gzip + metadata)..."
LONG_BLACK_VERSION="$VERSION" node dist/output-cli.js "$OUTPUT" "$PROJECT_DIR/output" --parquet

echo "[build-local] ABR core green → $OUTPUT ($(wc -l < "$OUTPUT" | tr -d ' ') documents)"
