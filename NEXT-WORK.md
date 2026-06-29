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
      Build the all-text raw table from the sniffed header so column counts
      match. (The malformed-row COPY deadlock is now closed: `loadDelimitedRaw`
      runs `validateFieldCounts` first — a single streaming pass that rejects a
      ragged file with its line number _before_ any byte reaches the COPY, so the
      postgres@3 server-side-error deadlock is unreachable. So the remaining work
      here is purely wiring the real source configs + normalize SQL.)

## Just-in-time tooling (verbatim lifts from flat-white → crema, when needed)

- [ ] `parquet` output (E1) — generalize the row-mapper into crema; wire a
      `--parquet` output.
- [ ] `compare-releases` / `generate-catalogue` / `manifest` — release/catalogue
      tooling for `catalogue.yml` / build-over-build diffs / the release manifest.
      (`manifest` was lifted into crema early but had no consumer, so it was
      removed to keep crema's surface to exactly what's used — re-lift it here
      when `catalogue.yml` lands.)

## Runtime image slimming (optional)

- [ ] **Drop devDependencies from the runtime image.** The Dockerfile copies the
      builder's `node_modules` wholesale, so the runtime ships typescript/eslint/
      vitest. A naive `npm prune --omit=dev` / `npm ci --omit=dev` re-runs crema's
      `prepare` (a `tsc` build that also `rm -rf dist`) and fails once its tooling
      is gone. Do it with a dedicated prod-deps stage (fresh `npm ci --omit=dev`
      from lock, scripts off, into a clean tree) and copy only that + `dist`.

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
