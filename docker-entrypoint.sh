#!/usr/bin/env bash
set -euo pipefail

# long-black container entrypoint.
#   docker run long-black                       # fixture build (default)
#   docker run -e LONG_BLACK_VERSION=2026.06.25 -v $PWD/output:/output long-black real
#
# Starts an internal Postgres, runs the pipeline, writes to /output, then dies.

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
DB="postgres://postgres:postgres@localhost:5432/abn"
MODE="${1:-fixture}"
VERSION="${LONG_BLACK_VERSION:-2026.06.28}"
SV="$(printf '%s' "$VERSION" | tr -cd '0-9')"

cleanup() { su postgres -c "pg_ctl -D $PGDATA stop -m fast" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# --- start Postgres (init on first run) ---
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  su postgres -c "initdb -D $PGDATA --auth=trust" >/dev/null
  {
    echo "listen_addresses='localhost'"
    echo "fsync=off"
    echo "synchronous_commit=off"
    echo "maintenance_work_mem=256MB"
  } >> "$PGDATA/postgresql.conf"
fi
su postgres -c "pg_ctl -D $PGDATA -w start" >/dev/null
su postgres -c "createdb abn" 2>/dev/null || true

runsql() { su postgres -c "psql -d abn -v ON_ERROR_STOP=1 -q"; }
sed_ver() { sed "s/__SCHEMA_VERSION__/${SV}/g" "$1"; }

mkdir -p /output
echo "[entrypoint] resetting schema abn_${SV}..."
echo "DROP SCHEMA IF EXISTS abn_${SV} CASCADE;" | runsql
sed_ver /app/sql/staging-schema.sql | runsql

if [ "$MODE" = "fixture" ]; then
  echo "[entrypoint] fixture build..."
  sed_ver /app/fixtures/seed-postgres.sql | runsql
  sed_ver /app/sql/abn-finalize.sql | runsql
  DATABASE_URL="$DB" LONG_BLACK_VERSION="$VERSION" node /app/dist/cli.js /output/fixture.ndjson
  if diff -q /output/fixture.ndjson /app/fixtures/expected-output.ndjson >/dev/null; then
    echo "[entrypoint] fixture: byte-for-byte OK"
  else
    echo "[entrypoint] fixture: REGRESSION"; exit 4
  fi
else
  echo "[entrypoint] real build (downloading ABN Bulk Extract)..."
  mapfile -t XML < <(DATA_DIR=/data node /app/dist/download-cli.js)
  DATABASE_URL="$DB" LONG_BLACK_VERSION="$VERSION" node /app/dist/load-cli.js "${XML[@]}"
  sed_ver /app/sql/abn-finalize.sql | runsql
  # Enrichment is REQUIRED — the data must be complete before shipping (matches
  # build.yml / build-local.sh, not best-effort). enrich-cli loads all sources
  # (ASIC/ACNC CSVs + AusTender + ATO XLSX + GrantConnect); GrantConnect needs
  # GRANTCONNECT_USERNAME/PASSWORD in the container env (docker run -e), else it fails.
  # A load below any floor aborts the build, and the coverage gate runs in production
  # mode — unless ALLOW_PARTIAL=true deliberately ships degraded data (gate off).
  echo "[entrypoint] enrichment (all sources — REQUIRED)..."
  COVERAGE_PROFILE=production
  if DATA_DIR=/data DATABASE_URL="$DB" LONG_BLACK_VERSION="$VERSION" node /app/dist/enrich-cli.js; then
    echo "[entrypoint] enrichment complete"
  elif [ "${ALLOW_PARTIAL:-}" = "true" ]; then
    echo "[entrypoint] WARNING: enrichment incomplete, ALLOW_PARTIAL=true — shipping degraded data"
    COVERAGE_PROFILE=off
  else
    echo "[entrypoint] ERROR: enrichment incomplete — refusing to ship (ALLOW_PARTIAL=true to override)"
    exit 5
  fi
  OUT="/output/long-black-${VERSION}.ndjson"
  DATABASE_URL="$DB" LONG_BLACK_VERSION="$VERSION" LONG_BLACK_COVERAGE_PROFILE="$COVERAGE_PROFILE" \
    node /app/dist/cli.js "$OUT"
  LONG_BLACK_VERSION="$VERSION" node /app/dist/output-cli.js "$OUT" /output --parquet
fi

echo "[entrypoint] done."
ls -lh /output 2>/dev/null || true
