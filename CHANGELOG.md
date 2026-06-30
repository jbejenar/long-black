# Changelog

All notable changes to long-black are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/) for the **output schema**:

- **Major** — a field removed/renamed, a type changed, or nullable→non-nullable.
- **Minor** — a field added (additive).
- **Patch** — a bug fix that changes field values without a schema change.

The NDJSON document is the contract (`docs/DOCUMENT-SCHEMA.md`).

## [Unreleased]

### Added

- **0.9.0** — **Regulated & risk enrichment bundle** (three new ASIC registers →
  three new document fields). long-black now carries whether an ABN holds a current
  financial-services or consumer-credit licence, and whether its corporate entity
  has been actioned by the regulator — turning the dataset from a registry mirror
  into a trust/risk signal. **Additive, minor bump** (no existing field changed):
  - `financialServicesLicence` (`AfsLicence | null`) — ASIC AFS Licensees
    (`asic-afs-licensee`), 1:0..1 on the holder ABN.
  - `creditLicence` (`CreditLicence | null`) — ASIC Credit Licensees
    (`asic-credit-licensee`), 1:0..1 on the holder ABN; `status` is the raw ASIC
    code (e.g. `APPR`).
  - `bannedDisqualified` (`Banned[]`, `[]` when none) — ASIC Banned & Disqualified
    Orgs (`asic-banned-disqualified-org`). The one register keyed on **ACN**, so it
    joins via `asic_number`, not ABN; `endDate` is null for permanent bannings.
  - Wired through the same enrichment seam: `ENRICHMENT_SOURCES` config (now six),
    three `normalize-asic-*.sql`, three `abn_full.sql` CTEs/joins, `compose.ts`,
    and the coverage gate (`src/coverage.ts` — production floors 1,000 / 1,000 / 5,
    fixture floors 1).
  - Proven on the real 2026.06.24 extract: **6,300** AFS licensees, **3,939**
    credit licensees, **12** banned orgs joined across 20,295,936 ABNs, 0
    composition errors (`docs/PERFORMANCE.md`).
  - Contract docs moved in lockstep (`src/schema.ts`, `docs/DOCUMENT-SCHEMA.md`,
    `fixtures/expected-output.ndjson`, `fixtures/schema-baseline.json`,
    `opensearch/abn-mappings.json`, `docs/DATA-SOURCES.md`, `fixtures/edge-cases.md`).
- **0.8.0** — **Data-completeness gates** ("all four sources of truth must be
  complete before shipping"). Enrichment was proven on the real 2026.06.24 extract
  — 2,341,897 ASIC companies, 1,977,574 business-name holders, 65,265 charities
  joined across 20,295,936 ABNs, 0 composition errors (`docs/PERFORMANCE.md`) —
  and the pipeline now refuses to ship anything less:
  - `enrich-cli` fails a source whose load falls below a per-source floor
    (`minRows`: 1,000,000 / 1,000,000 / 20,000), catching an empty/truncated CSV
    or the wrong resource.
  - `cli.js` adds an enrichment-coverage gate after verify (`src/coverage.ts`,
    `LONG_BLACK_COVERAGE_PROFILE`): the build fails unless each nested source
    populated documents at its floor. The fixture loop runs it at fixture scale.
  - `build.yml` / `build-local.sh` make enrichment **required** (no more
    best-effort "warning + ship null") — a failure aborts the build unless a
    deliberate `allow_partial_enrichment=true` override.
  - `build.yml` wires the `compare-cli` anomaly gate: it diffs the build against
    the prior published release and holds anomalous builds as drafts for review
    (`compare_threshold`, default 0.25), uploading the reports as an artifact.
  - manifest-cli now treats `metadata.version` as canonical (validates
    `LONG_BLACK_VERSION` matches) and verifies the shard set bidirectionally
    against `metadata.counts`, so a stale/partial output dir can't yield a
    plausible-but-wrong manifest.
  - `catalogue.yml` skip path now gates downstream steps + the deploy job via a
    `should_generate` output (a bare `exit 0` only ended the check step, so a
    draft/empty state could still deploy a stale catalogue).
- **0.7.0** — **Release catalogue + manifest + comparison tooling** (re-lifted
  into crema as generic, branding/product-injected engines and consumed here):
  - `manifest-cli.js` writes `output/manifest.json` every release — per-shard
    sha256 + record counts + build provenance (repo/commit/run) via crema's
    `buildManifestV2` (product `abn`, no index). The per-state NDJSON.gz shards
    are the manifest source files; the all-ABN Parquet is excluded so
    `total_records` isn't double-counted.
  - `catalogue-cli.js` + `src/catalogue.ts` (`ABN_BRANDING`) render a static
    GitHub-release catalogue; `catalogue.yml` deploys it to GitHub Pages after
    each successful Build (drafts/prereleases excluded — gated twice).
  - `compare-cli.js` flags build-over-build anomalies (a per-state or total
    count moving past the threshold, or a state appearing/retiring) for the
    release manual-review gate.

  Release notes now carry a jq-emitted `**<n>** businesses` line + per-state
  table that the catalogue parses back. No document-schema change.

- **0.6.0** — Optional **Parquet** output (`output-cli.js … --parquet`, emitted
  by the release builds): an all-ABN `long-black-<version>.parquet` alongside the
  per-state NDJSON.gz, via crema's generic `convertToParquet`. Scalars become
  native columns; nested/array fields are JSON strings. No document-schema
  change — same fields, alternative encoding.
- **0.5.0** — Real ASIC/ACNC CSV enrichment loaders (`src/enrich.ts`,
  `enrich-cli.ts`, `sql/normalize-*.sql`): discover each source by stable package
  id → COPY into an all-text raw table built from the sniffed header → normalize
  into typed staging → drop the raw table. Confirmed the live file shapes
  (verify-on-first-load): ASIC are pure TSV with literal `"`/`\` (loaded with
  quoting disabled), ACNC a true comma CSV. No schema change — populates the
  existing `company{}` / `registeredBusinessNames[]` / `charity{}` fields with
  real data. Best-effort in the build (a source failure leaves the object null).
- **0.4.0** — ACNC charity enrichment (`charity{}`), via `LEFT JOIN acnc_charity`.
- **0.3.0** — ASIC Business Names enrichment (`registeredBusinessNames[]`, 1:N),
  via a `json_agg` CTE; kept separate from ABR's `businessNames`.
- **0.2.0** — ASIC Company enrichment (`company{}`), via `DISTINCT ON` + `LEFT JOIN`.
- **0.1.0** — ABR core: `saxes` streaming XML → COPY → flatten → one AbnDocument
  per ABN; per-state split + gzip + `metadata.json`; fixture-first dev loop with
  byte-for-byte regression. Built on `crema`.

### Notes

- Code: Apache-2.0. Derived data: CC-BY 3.0 AU (attribution in `metadata.json`).
