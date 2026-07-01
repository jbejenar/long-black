# AGENTS.md — long-black

## Project Overview

long-black transforms Australia's public **business-entity** data into pre-joined,
normalized NDJSON — one document per ABN. It spins up an ephemeral Postgres,
streams the ABR ABN Bulk Extract XML in, joins it with **fifteen enrichment
sources** — ASIC Company, ASIC Business Names, ASIC AFS Licensees, ASIC Credit
Licensees, ASIC Banned & Disqualified, ACNC Registered Charities, ACNC Annual
Information Statement, AusTender government-contract spend, GrantConnect grant awards,
the ATO Corporate Tax Transparency + R&D Tax Incentive workbooks, the ASIC AFS + credit
authorised-representative registers, the WGEA reporting-organisations list, and the ASIC
SMSF auditor register (see `docs/DATA-SOURCES.md`) — flattens to one document per ABN,
streams out validated NDJSON (split per state, gzipped), then dies.

The pipeline spine lives in **`crema`** (a sibling package); long-black is the
thin ABN **domain layer** on top. flat-white (addresses) is the sister project
crema was extracted from.

## Architecture

```
src/
  schema.ts          — AbnDocument Zod schema + types (the contract)
  compose.ts         — flat SQL row → AbnDocument
  verify-checks.ts   — ABN-domain checks (mod-89 checksum, name-not-type-code)
  load.ts            — saxes streaming XML → AbnStagingRow + COPY loader
  load-csv.ts        — generic delimited (CSV/TSV) → COPY raw loader (enrichment)
  sources.ts         — data.gov.au source config (stable abn-bulk-extract id)
  output.ts          — split + gzip + metadata (CC-BY attribution)
  cli.ts / load-cli.ts / download-cli.ts / output-cli.ts — thin entry points
sql/
  staging-schema.sql — single `abn` table (UNLOGGED, no inline PK) + enrichment stubs
  abn-finalize.sql   — PK + indexes added AFTER load
  abn_full.sql       — flatten query (single SELECT + enrichment joins)
fixtures/
  seed-postgres.sql  — ~20 representative ABNs + enrichment rows
  expected-output.ndjson — byte-for-byte regression baseline
  sample-abr.xml     — XML parser drift-guard fixture
```

## Key Commands

```bash
npm run build                    # tsc
npm test                         # vitest (unit + regression)
npm run lint && npm run typecheck
./scripts/build-fixture-only.sh  # dev loop: seed → flatten → verify → diff (<30s)
LONG_BLACK_VERSION=2026.06.25 ./scripts/build-local.sh   # real data (~6-8GB)
docker compose up db             # ephemeral postgres:16
```

## Principles (MUST follow)

1. **Fixture-first.** Use `build-fixture-only.sh` for all dev work — no 6-8GB
   download needed. It seeds staging rows directly (no XML parsing).
2. **crema is the spine, not a fork.** The generic pipeline (flatten engine,
   split, compress, verify harness, download, metadata) lives in crema. Don't
   duplicate it here. Improve crema upstream.
3. **The NDJSON schema is the contract.** Change `src/schema.ts`,
   `docs/DOCUMENT-SCHEMA.md`, and `fixtures/expected-output.ndjson` together.
   Additive field = minor bump; removal/rename = major.
4. **Postgres is ephemeral.** It loads, joins, exports, and dies. No persistent state.
5. **Regression = byte-for-byte** against `fixtures/expected-output.ndjson`.

## Code Conventions

- ESM only, strict TypeScript, no `any` (use `unknown` + narrow), `.js` imports.
- Streaming everywhere — cursor reads (via crema), COPY loads, gzip. RSS < 500 MB.
- Zod validates every document during flatten.

## The enrichment seam

Each new source is identical: a stub staging table (`CREATE TABLE IF NOT EXISTS`)
→ one join in `abn_full.sql` → one nullable nested object in `schema.ts` →
regenerate `expected-output.ndjson`. 1:1 sources use `DISTINCT ON (abn)`; 1:N use
a `json_agg` CTE (never direct-join a 1:N table).

## Do NOT

- Duplicate crema's pipeline modules — consume them.
- Use PostGIS — ABN data has no geometry.
- Use `||` to concat names — `||` returns NULL on any NULL operand; use `concat_ws`.
- Put `ON CONFLICT` in a COPY — COPY can't; add the PK after load.
- Add a schema field without updating DOCUMENT-SCHEMA.md + schema.ts + expected-output.ndjson.
