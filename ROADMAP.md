# long-black

### Australian businesses. Flattened and served.

> Built on [`crema`](../crema). Sister project of [`flat-white`](../flat-white).

## Overview

Transform Australia's public business-entity data (ABR ABN Bulk Extract + ASIC
Company + ASIC Business Names + ACNC charities) into pre-joined NDJSON — one
document per ABN. Ephemeral Postgres in, NDJSON out.

## Status

| Phase  | What                        | Status                                                                                         |
| ------ | --------------------------- | ---------------------------------------------------------------------------------------------- |
| **C0** | Extract `crema` shared core | ✅ done (flatten engine, split, compress, verify, download, metadata, manifest, schema-compat) |
| **P0** | Foundation + fixture loop   | ✅ green byte-for-byte (<1s warm)                                                              |
| **P1** | ABR core (real XML)         | ✅ loader + sources + live discovery proven; ⏳ 15M smoke (deliberate)                         |
| **P2** | Container, CI, output       | ✅ Dockerfile, ci.yml, per-state split+gzip+metadata, opensearch, schema baseline              |
| **P3** | Enrichment                  | ✅ ASIC Company (1:1) · ASIC Business Names (1:N) · ACNC charity (1:0..1)                      |
| **P4** | Launch docs                 | ✅ README, AGENTS, CLAUDE, DOCUMENT-SCHEMA, DATA-SOURCES, this file                            |
| **E1** | Enhancements                | ⏳ Parquet output; further ASIC registers; materialize path if profiling needs it              |

## Principles

1. One container, one file. Ephemeral Postgres. NDJSON is the contract.
2. Fixture-first development (no 6–8 GB download to test).
3. `crema` is the spine — don't duplicate it.
4. Sovereign data only: data.gov.au, CC-BY 3.0 AU.

## Enrichment seam

Each source: stub staging table → one join in `abn_full.sql` → one nullable
nested object in `schema.ts` → regenerate `expected-output.ndjson`. Proven for
1:1, 1:N, and 1:0..1.

## Cost model

Public repo, free GitHub Actions, free GitHub Release hosting. Free.

## E2 — Pipeline hardening (planned)

Deferred distribution + robustness work on the release pipeline (`build.yml` is the
authoritative pipeline; `build-local.sh` mirrors it; the container entrypoint is the
gap):

- **S3 mirror of releases.** `build.yml` publishes a GitHub Release but does not mirror
  the assets (per-state `*.ndjson.gz`, all-ABN `.parquet`, `metadata.json`,
  `manifest.json`) to S3. Add an upload step after the release is verified, writing to
  `s3://<bucket>/long-black/v<version>/…` (+ a `latest/` pointer). **Pending decisions:**
  bucket + region, and auth (GitHub OIDC role — preferred — vs. `AWS_ACCESS_KEY_ID`/
  `AWS_SECRET_ACCESS_KEY` secrets). flat-white's `s3-smoke.yml` is the reference shape.
- **Fix the container `real` path.** `docker-entrypoint.sh`'s real build runs enrichment
  **best-effort** (`|| … continuing with partial`) and omits
  `LONG_BLACK_COVERAGE_PROFILE=production` on the flatten — contradicting the fail-fast +
  coverage-gate policy that `build.yml`/`build-local.sh` enforce. Make it fail-fast +
  gated (with an `ALLOW_PARTIAL` escape hatch, like the others) and refresh its stale
  "ASIC Company/Business Names + ACNC" comment (enrichment is now 14 sources).
- **Cadence.** Currently monthly (5th, 03:00 UTC). Revisit weekly if fresher ABR/ASIC
  core data is wanted (ATO/WGEA are annual, so daily is pointless).

## E3 — GrantConnect grant awards (in progress)

Whole-of-government **grant awards** (grants.gov.au), keyed on recipient ABN + value —
the grants complement to AusTender `govSpend` (contracts). grants.gov.au sits behind a
CloudFront WAF that 403s automated/non-browser traffic, and its report export needs a
free account, so the loader authenticates with credentials stored as repo secrets
(`GRANTCONNECT_USERNAME` / `GRANTCONNECT_PASSWORD`) — never committed. See NEXT-WORK.md.
