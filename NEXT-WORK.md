# Next Work — long-black

> The functional pipeline is complete and green (fixture loop byte-for-byte;
> XML→COPY→flatten proven; live CKAN discovery verified; all four sources enrich).
> Remaining items are runtime validation + just-in-time tooling.

## Runtime validation (deliberate, heavyweight)

- [ ] **Real-data smoke (P1.04)** — `LONG_BLACK_VERSION=2026.06.25 ./scripts/build-local.sh`.
      Downloads ~1 GB (→ ~6–8 GB XML, ~15M records). Confirm: RSS < 500 MB during
      flatten, row count ≈ 15M, spot-check known ABNs vs abr.business.gov.au.
      Write the numbers into `docs/PERFORMANCE.md`.

## Real enrichment loaders (verify-on-first-load)

- [ ] **ASIC / ACNC CSV loaders** — wire `load-csv.ts` (`loadDelimitedRaw`) +
      a per-source normalize `INSERT … SELECT` once the real file headers are
      confirmed (`sniffHeader`). ASIC files are tab-delimited despite `.csv`.

## Just-in-time tooling (verbatim lifts from flat-white → crema, when needed)

- [ ] `parquet` output (E1) — generalize the row-mapper into crema; wire a
      `--parquet` output.
- [ ] `compare-releases` / `generate-catalogue` — release/catalogue tooling for
      `catalogue.yml` / build-over-build diffs.

## Cadence

Monthly `build.yml` cron (date-versioned `vYYYY.MM.DD` from the ABR
`TransferInfo/ExtractTime`); pick a week where all four sources are fresh.

## Reference

| Need               | Read                      |
| ------------------ | ------------------------- |
| Output contract    | `docs/DOCUMENT-SCHEMA.md` |
| Fixture edge cases | `fixtures/edge-cases.md`  |
| Data sources       | `docs/DATA-SOURCES.md`    |
| Flatten SQL        | `sql/abn_full.sql`        |
| Agent rules        | `CLAUDE.md` (auto-loaded) |
