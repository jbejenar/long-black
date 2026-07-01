# Changelog

All notable changes to long-black are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/) for the **output schema**:

- **Major** — a field removed/renamed, a type changed, or nullable→non-nullable.
- **Minor** — a field added (additive).
- **Patch** — a bug fix that changes field values without a schema change.

The NDJSON document is the contract (`docs/DOCUMENT-SCHEMA.md`).

## [Unreleased]

### Fixed

- **Parquet output completeness** — the optional `--parquet` export
  (`src/parquet-output.ts`) had never been extended past 0.8.0, so the `.parquet`
  asset was silently missing every field added since: `financialServicesLicence`,
  `creditLicence`, `bannedDisqualified`, `govSpend`, `ageYears`, `isActive`, `flags`.
  All are now represented (scalars native — `isActive` BOOLEAN, `ageYears` INT64 —
  nested/array fields as JSON strings), so the Parquet asset matches the NDJSON
  contract. A round-trip test asserts the new fields appear. NDJSON output unchanged.

### Changed

- **Metadata attribution** — `metadata.json` `sources[]` now itemizes **all nine
  datasets** individually (previously only five), so every release fully accounts
  for what it is derived from. Added the ACNC Annual Information Statement and the
  ASIC AFS / Credit / Banned & Disqualified datasets to `ABN_SOURCES`
  (`src/output.ts`), each with its CC-BY 3.0 AU attribution. No document-schema
  change (the output contract is unchanged) — metadata only.

### Added

- **0.12.0** — **Government spend** (`govSpend`) — per-ABN AusTender
  government-contract spend, plus a `flags.hasGovContracts`. Additive, minor bump.
  - Source: the **Open Contracting Partnership Data Registry** bulk mirror of
    AusTender's OCDS data ([publication 19](https://data.open-contracting.org/en/publication/19))
    — `full.jsonl.gz`, ~251 MB, **updated monthly**, ~852k contracts from 2007. The
    only current bulk feed: the data.gov.au mirror is frozen at 2013 and the
    `api.tenders.gov.au` API is a ~25–40k-call paginated crawl with no published rate
    limits (verify-on-first-load; see `docs/DATA-SOURCES.md`).
  - New JSON-aggregation loader (`src/gov-spend.ts`, **not** a CSV COPY): streams the
    gzip, attributes each contract's value to every supplier party carrying an
    `AU-ABN`, sums in **integer cents** (exact, order-deterministic), and bulk-loads
    a per-ABN aggregate into `gov_spend`. De-dupes by `ocid`. ~1% of contracts list
    multiple suppliers — the full value is attributed to each (documented).
  - `govSpend` shape: `{ totalValueAud, contractCount, firstContractDate,
lastContractDate }`, folded into the document via a 1:0..1 join; `null` when the
    ABN never supplied a contract. Coverage gate floor 30,000 (`src/coverage.ts`).
  - © Commonwealth of Australia (Department of Finance / AusTender) — **CC-BY 3.0
    AU** (the data.gov.au record's dataset licence; the OCP Data Registry is the
    access route). Added to `ABN_SOURCES` so it appears in `metadata.json`.
  - Contract docs moved in lockstep (`src/schema.ts`, `docs/DOCUMENT-SCHEMA.md`,
    `fixtures/expected-output.ndjson`, `fixtures/schema-baseline.json`,
    `opensearch/abn-mappings.json`, `docs/DATA-SOURCES.md`, `fixtures/edge-cases.md`).
- **0.11.0** — **Derived signals** — three new fields computed in `compose.ts` from
  data already in each document, **no new source, no join, no coverage gate**.
  Additive, minor bump:
  - `ageYears` (`number | null`) — whole **calendar** years from `abnStatusFromDate`
    to the `_version` date, computed from date components (not elapsed-ms/365.25,
    which undercounts exact anniversaries). Computed against the build version,
    **never wall-clock**, so the output stays byte-deterministic; null when the
    from-date is absent (~0% of rows) or malformed, clamped to 0 if it post-dates the
    build.
  - `isActive` (`boolean`) — `abnStatus === 'ACT'`. **44.2%** of the 2026.06.24
    extract (most ABNs are cancelled — 11.3M of 20.3M).
  - `flags` (`EntityFlags`) — always-present convenience booleans so consumers can
    filter without digging into nested null/empty objects: `isIndividual` (~54%),
    `isCompany` (~12%), `isCharity` (~0.3%), `isLicensed` (AFS or credit, ~0.05%),
    `hasEnforcementAction` (banned, 12 entities), `isDgr` (~0.16%).
  - Contract docs moved in lockstep (`src/schema.ts`, `docs/DOCUMENT-SCHEMA.md`,
    `fixtures/expected-output.ndjson`, `fixtures/schema-baseline.json`,
    `opensearch/abn-mappings.json`). Prevalences spot-checked on the real 20.3M build.
- **0.10.0** — **Charity financials** (ACNC Annual Information Statement). Adds a
  nested `charity.financials` object so each currently-registered charity carries
  its most recent AIS financials — revenue, expenses, assets, liabilities — plus
  workforce (FTE staff, volunteers) and the reporting period. **Additive, minor
  bump** (a new nested field inside the existing `charity` object):
  - Source: `acnc-<year>-annual-information-statement-ais-data` (CKAN; one package
    per year — the loader pins a known year, `acnc-2024-…`, as a reproducible
    snapshot bumped with a one-line change). Main CSV `datadotgov_ais24`, comma CSV,
    keyed on the 11-digit `abn` (verify-on-first-load: 53,665 filers, 100% numeric
    financials, all ABN-keyed).
  - Monetary fields are emitted as **JSON numbers** (whole dollars, stored
    `numeric` since some exceed int4); `staffFullTimeEquivalent` may be fractional;
    `volunteers` is an integer. Casts are regex-guarded (blank/non-numeric → null).
  - Folded into `charity{}` (not a top-level field), so financials surface only for
    currently-registered charities; on the 2024 AIS, **1,859** filers had
    deregistered and carry no financials (documented trade-off).
  - Wired through the same seam: `ENRICHMENT_SOURCES` (now seven),
    `normalize-acnc-ais.sql`, an `ais` CTE folded into the charity object in
    `abn_full.sql`, and a `charityFinancials` coverage gate (`src/coverage.ts` —
    production floor 20,000, fixture floor 1). Real coverage (20.3M proof):
    **51,806** charities with financials (register ∩ AIS).
  - **Fixed (caught by the 20.3M proof):** the 0.9.0 ACN-path joins guarded with
    `asic_number_type = 'ACN'`, but the real ABR extract types every ASIC number
    `'undetermined'`, so that guard matched **nothing** — `bannedDisqualified` came
    back empty for all 20.3M docs and the production coverage gate failed. The three
    ACN-path joins now **exclude** known foreign types (`ARBN`/`ARSN`/`ARFN`) instead,
    matching `undetermined`/`ACN`/null while still dropping a typed foreign collision;
    a fixture seeded `undetermined` now proves the real-data path (preventing the
    regression). Documented the `acnType`-always-null reality in `DOCUMENT-SCHEMA.md`.
  - Contract docs moved in lockstep (`src/schema.ts`, `docs/DOCUMENT-SCHEMA.md`,
    `fixtures/expected-output.ndjson`, `fixtures/schema-baseline.json`,
    `opensearch/abn-mappings.json`, `docs/DATA-SOURCES.md`, `fixtures/edge-cases.md`).
- **0.9.0** — **Regulated & risk enrichment bundle** (three new ASIC registers →
  three new document fields). long-black now carries whether an ABN holds a current
  financial-services or consumer-credit licence, and whether its corporate entity
  has been actioned by the regulator — turning the dataset from a registry mirror
  into a trust/risk signal. **Additive, minor bump** (no existing field changed):
  - `financialServicesLicence` (`AfsLicence | null`) — ASIC AFS Licensees
    (`asic-afs-licensee`), 1:0..1 per entity. `AFS_LIC_ABN_ACN` carries **either an
    11-digit ABN or a 9-digit ACN**, so the licence resolves by two paths: a direct
    ABN match, or an ACN match against `asic_number`, **excluding** asic_numbers
    typed `ARBN`/`ARSN`/`ARFN` (a known foreign number sharing the digits is never
    matched; real ABR data is `undetermined`, so the join excludes rather than
    requires `ACN` — see 0.10.0). Without the ACN path ~164 real licensees would
    falsely report null.
  - `creditLicence` (`CreditLicence | null`) — ASIC Credit Licensees
    (`asic-credit-licensee`), 1:0..1 per entity; same ABN-or-ACN keying (~357 real
    ACN-keyed rows recovered); `status` is the raw ASIC code (e.g. `APPR`).
  - `bannedDisqualified` (`Banned[]`, `[]` when none) — ASIC Banned & Disqualified
    Orgs (`asic-banned-disqualified-org`). The one register keyed on **ACN**, so it
    joins via `asic_number`, excluding asic_numbers typed `ARBN`/`ARSN`/`ARFN` —
    guarding against a foreign entity inheriting another org's enforcement record on
    a 9-digit collision; `endDate` is null for permanent bannings.
  - Wired through the same enrichment seam: `ENRICHMENT_SOURCES` config (now six),
    three `normalize-asic-*.sql`, type-guarded `abn_full.sql` CTEs/joins, `compose.ts`,
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
