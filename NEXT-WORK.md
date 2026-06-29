# Next Work — long-black

> The functional pipeline is complete and green (fixture loop byte-for-byte;
> XML→COPY→flatten proven; live CKAN discovery verified; all four sources enrich).
> Remaining items are runtime validation + just-in-time tooling.

## Runtime validation (deliberate, heavyweight)

- [x] **Real-data smoke (P1.04)** — ran `LONG_BLACK_VERSION=2026.06.24
./scripts/build-local.sh` on the real extract: **20,295,936** ABNs, peak RSS
      **229 MB** (< 500 MB), all checksums valid, 0 dup ids. Numbers in
      `docs/PERFORMANCE.md`. Surfaced + fixed two real bugs: the verify Set
      blowing V8's 16.7M cap (crema `idsSorted`) and `build-local.sh`'s `mapfile`
      (bash 4+) on macOS bash 3.2.

## Real enrichment loaders (verify-on-first-load)

- [x] **ASIC / ACNC CSV loaders** — wired in `src/enrich.ts` (+ `enrich-cli.ts`)
      and `sql/normalize-{asic-company,asic-business-name,acnc-charity}.sql`. The
      real headers, delimiter, and quoting were confirmed by sampling the live
      files: ASIC are **pure TSV** with LITERAL `"`/`\` in values (loaded with
      quoting off — `FORMAT csv` + control-byte QUOTE), ACNC is a true comma CSV
      (quoting on). The loader builds the all-text raw table from the sniffed
      header (`buildRawTableDdl`), COPYs (deadlock-guarded), then normalizes →
      typed staging → drops the raw table. Decisions: ASIC company loads only the
      current-name rows (`Current Name Indicator = 'Y'`) so `company.name` is
      current; `REGD`/`DRGD` → `Registered`/`Deregistered`, other codes raw; ACNC
      `status` = constant `Registered` and `subtype` = priority projection of the
      ~14 purpose flags. Best-effort in the build (a source 404 leaves the nested
      object null). Column mappings: `docs/DATA-SOURCES.md`. Covered by
      `test/integration/enrichment-load.test.ts` (live COPY + normalize) and
      `test/unit/{load-csv,enrich}.test.ts`.

## Just-in-time tooling (verbatim lifts from flat-white → crema, when needed)

- [x] **`parquet` output (E1)** — crema's generic `convertToParquet` (row-mapper
      injected); long-black wires `--parquet` (`src/parquet-output.ts` +
      `output-cli.js … --parquet`). The release builds emit an all-ABN
      `long-black-<version>.parquet` alongside the per-state NDJSON.gz. (0.6.0)
- [x] **`compare-releases` / `generate-catalogue` / `manifest`** — re-lifted into
      crema as generic engines (product/branding injected) and consumed by
      long-black. `manifest-cli.js` writes `output/manifest.json` (per-shard sha256 + record counts + build provenance) every release, with the all-ABN Parquet
      excluded so `total_records` isn't doubled. `catalogue.ts` (`ABN_BRANDING`) +
      `catalogue-cli.js` render the release catalogue, deployed to GitHub Pages by
      `catalogue.yml` after each successful Build. `compare-cli.js` is the
      build-over-build anomaly check (exit 2 on a per-state/total move past the
      threshold or a new/retired state) for the release manual-review gate.

## Runtime image slimming (optional)

- [x] **Drop devDependencies from the runtime image.** The Dockerfile copies the
      builder's `node_modules` wholesale, so the runtime ships typescript/eslint/
      vitest. A naive `npm prune --omit=dev` / `npm ci --omit=dev` re-runs crema's
      `prepare` (a `tsc` build that also `rm -rf dist`) and fails once its tooling
      is gone. Done with a dedicated `proddeps` stage: fresh `npm ci --omit=dev`
      from lock with scripts off into a clean tree (crema's `prepare` deleted first
      so installing the `file:` dep doesn't re-trigger `tsc`), grafting the
      already-built `dist` on top, then the runtime copies only that prod tree +
      `dist`. Image 1.36 GB → 975 MB (~28% smaller); runtime carries no
      typescript/eslint/vitest/prettier.

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
