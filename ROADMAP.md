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

## E2 — Pipeline hardening

Robustness + distribution work on the release pipeline (`build.yml` is authoritative;
`build-local.sh` mirrors it; the container entrypoint had drifted):

- ✅ **Container `real` path fixed.** `docker-entrypoint.sh`'s real build now runs
  enrichment **fail-fast** with the production coverage gate (+ an `ALLOW_PARTIAL`
  escape hatch) — matching `build.yml`/`build-local.sh` — instead of best-effort
  "continuing with partial", and its stale comment is refreshed.
- ✅ **S3 mirror of releases (live).** A separate least-privilege `mirror-s3` job mirrors
  each published release to the **shared bucket** using flat-white's product-namespaced
  layout — immutable `s3://<bucket>/data/abn/<version>/…` + `manifests/abn-<version>.json`
  (no in-place mutation, no `latest` pointer). Enabled: the OIDC `long-black-role`
  (`s3:PutObject`/`s3:ListBucket` scoped to `data/abn/*` + `manifests/abn-*`, trusting
  `jbejenar/long-black:ref:refs/heads/main`) is created and the repo variable
  `AWS_ROLE_ARN` is set, so the mirror fires on each release. `s3-smoke.yml`
  (workflow_dispatch) validates the OIDC path non-destructively. See `docs/RELEASING.md`
  § "S3 mirror".
- ✅ **Cadence — weekly** (Mondays, 03:00 UTC), tracking the weekly ABR extract; a week
  with no new extract re-resolves the same version and doesn't cut a duplicate release.

## E3 — GrantConnect grant awards ✅ (shipped, v0.17.0)

Whole-of-government **grant awards** (grants.gov.au) keyed on recipient ABN + value —
the grants complement to AusTender `govSpend` (contracts). grants.gov.au sits behind a
CloudFront request-fingerprint filter (a full browser header set → 200) and its bulk
"Grant Award Published" report needs a free account, so `src/gov-grants.ts` authenticates
headlessly (login → per-year XLSX report → aggregate per recipient ABN) with credentials
from repo secrets `GRANTCONNECT_USERNAME` / `GRANTCONNECT_PASSWORD` (never committed).
Real proof: 295,714 awards → 66,858 recipient ABNs.
