# Performance — long-black

Measured numbers from a full real-data build (P1.04 smoke). Update these when the
hardware, dataset size, or pipeline shape changes materially.

## Test environment

|          |                                                                           |
| -------- | ------------------------------------------------------------------------- |
| Machine  | Apple M5 MacBook Pro, 64 GB RAM                                           |
| Postgres | `postgres:16` in Docker (no PostGIS), default `docker-compose.yml` tuning |
| Node     | 22                                                                        |
| Source   | ABR ABN Bulk Extract, `abn-bulk-extract`, extract **2026.06.24**          |
| Input    | 2 ZIP parts (~986 MB compressed) → 20 XML files (~13 GB)                  |
| Output   | **20,295,936** documents (one per ABN)                                    |

The ABR extract has grown past the original ~15M estimate — **20.3M** ABNs as of
2026.06.24 — which is what first exercised the >16.7M code paths (see Notes).

## Stage timings

End-to-end on the machine above (single run; wall-clock):

| Stage                            | Time        | Peak RSS   | Notes                                                           |
| -------------------------------- | ----------- | ---------- | --------------------------------------------------------------- |
| Download + extract               | ~2 min 12 s | —          | 2 ZIPs (~986 MB) → 20 XML files (~13 GB)                        |
| Load (saxes XML → COPY)          | ~1 min 52 s | **144 MB** | 20,295,936 records, ~181k rec/s, one streaming COPY             |
| Finalize (PK + indexes)          | ~9 s        | —          | `ALTER TABLE … ADD PRIMARY KEY` + indexes after load            |
| Flatten + verify                 | ~2 min 3 s  | **229 MB** | cursor(500) stream → NDJSON, ~165k docs/s; 0 composition errors |
| Output (split + gzip + metadata) | ~1 min 48 s | —          | per-state NDJSON, streaming gzip, `metadata.json`               |
| **Total**                        | **~8 min**  | **229 MB** | from cold download to per-state `.ndjson.gz`                    |

Peak RSS across the whole pipeline is **229 MB** — comfortably under the **500 MB**
budget. Memory is flat with respect to row count: the load holds only the current
`<ABR>`, the flatten streams via a server-side cursor, and verify uses
sorted-adjacency id checks (no per-row accumulation).

## Output

Per-state split, streaming gzip (one file per `state`; `other` bucket for
null/empty state; `AAT`, when present, is its own bucket — this extract had none):

| State     |      Documents |  Compressed |
| --------- | -------------: | ----------: |
| NSW       |      6,612,855 |      308 MB |
| VIC       |      5,325,699 |      250 MB |
| QLD       |      4,178,875 |      199 MB |
| WA        |      2,070,306 |       99 MB |
| SA        |      1,289,500 |       62 MB |
| TAS       |        320,994 |       16 MB |
| ACT       |        296,194 |       14 MB |
| NT        |        142,797 |        7 MB |
| other     |         58,716 |      2.7 MB |
| **Total** | **20,295,936** | **~958 MB** |

`metadata.json` records the per-state counts, the build timestamp, and the CC-BY
3.0 AU source attribution.

## Enrichment (real extract, 2026.06.24)

All three enrichment sources were downloaded from data.gov.au and loaded against
the real 20.3M-ABN table, then joined through `abn_full.sql`. Measured on the
machine above; the join adds ~13 s to the flatten (2 min 16 s vs 2 min 3 s
core-only) and stays well under the memory budget.

| Source              | Rows loaded | ABNs enriched | Coverage | Load time   |
| ------------------- | ----------: | ------------: | -------: | ----------- |
| ASIC Company        |   2,342,141 |     2,341,897 |   11.5 % | —           |
| ASIC Business Names |   2,618,824 |     1,977,574 |    9.7 % | —           |
| ACNC charities      |      65,270 |        65,265 |    0.3 % | —           |
| **All three**       |           — |             — |        — | ~1 min 26 s |

ABNs-enriched is the document count carrying a non-null `company` / non-empty
`registeredBusinessNames[]` / non-null `charity`; it matches the output exactly
(0 composition errors over 20,295,936 docs). Most ABNs are sole traders / trusts
with no ASIC company or charity record, so single-digit-percent coverage is
expected, not a gap.

**Completeness gates** (the "data must be complete before shipping" policy):

- `enrich-cli` fails if any source loads below its floor (`minRows`: company/
  business-names 1,000,000, charities 20,000 — ≈⅓ of the counts above).
- `cli.js` runs an enrichment-coverage gate after verify
  (`LONG_BLACK_COVERAGE_PROFILE=production`): the build fails unless `company` ≥
  1,000,000, `registeredBusinessNames` ≥ 1,000,000, and `charity` ≥ 20,000 docs.
- `build.yml` treats an incomplete enrichment as fatal (no silent partial
  release) unless a deliberate `allow_partial_enrichment=true` manual override,
  and diffs the build against the prior release (`compare-cli`) to hold anomalous
  builds as drafts.

## Data-quality observations (real extract)

- **ABN checksum:** all 20,295,936 `_id`s pass the mod-89 weighted checksum (0
  failures).
- **Uniqueness:** 0 duplicate `_id`s; the post-load `ADD PRIMARY KEY` did not trip
  the dedup fallback (each ABN appears once across the 20 files).
- **Names equal to type codes:** 7 documents have a name field whose value equals
  an XML discriminator code — all genuine (e.g. `DGR`/`BN` as people's initials in
  a trading name, `IND`/`TRD` as real registered names), not a parse leak. See the
  note in `src/verify-checks.ts`.

## Notes

- **>16.7M is a real threshold, not theoretical.** At 20.3M docs the verify
  harness's original id-uniqueness Set both exceeded V8's ~16.7M-entry cap
  (`RangeError: Set maximum size exceeded`) and consumed ~3 GB RSS. crema's
  `verify` now takes `idsSorted` (the flatten emits `ORDER BY abn`), detecting
  duplicates by adjacency in O(1) memory — which is what keeps the flatten+verify
  stage at 229 MB above.
- **Reproduce:** `LONG_BLACK_VERSION=2026.06.24 ./scripts/build-local.sh` (needs
  Docker + ~15 GB free disk for the extract). The fixture loop
  (`./scripts/build-fixture-only.sh`) covers the pipeline shape in <30 s without a
  download.
