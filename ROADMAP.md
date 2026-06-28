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
