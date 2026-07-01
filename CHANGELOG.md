# Changelog

All notable changes to long-black are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/) for the **output schema**:

- **Major** — a field removed/renamed, a type changed, or nullable→non-nullable.
- **Minor** — a field added (additive).
- **Patch** — a bug fix that changes field values without a schema change.

The NDJSON document is the contract (`docs/DOCUMENT-SCHEMA.md`).

## [Unreleased]

### Removed

- **Parquet output** — dropped the optional all-ABN `.parquet` asset
  (`src/parquet-output.ts`, `--parquet`). At real scale the file was written
  **uncompressed with every field as a UTF8/JSON-string column**, so it came out
  **~12 GB — ~10× the ~1.26 GB gzipped NDJSON** and delivered no columnar benefit
  (it also blew GitHub's 2 GB per-asset release limit). NDJSON is the contract; the
  document schema is unchanged.

### Added

- **Full-dataset `all.ndjson.gz` on the S3 mirror** — a consolidated all-ABN NDJSON
  (~1.26 GB) in the same global `ORDER BY abn` order as the canonical output, published
  to `data/abn/<version>/all.ndjson.gz` on the S3 mirror only (not the GitHub Release,
  which stays lean per-state — matching flat-white's split). The `mirror-s3` job builds
  it by a streaming byte-wise **merge** of the (already ABN-sorted) shards it downloads
  (`LC_ALL=C sort -m` via FIFOs — no multi-GB temp), verified to contain exactly
  `total_records` lines. The build job still needs no S3 credentials.
- **A+++ S3 manifest** — `manifests/abn-<version>.json` now lists `all.ndjson.gz` as an
  **aggregate** file with its own `sha256` + `bytes`, marked `aggregate: true` and
  **excluded from `total_records`** (it duplicates the shards), so the bundle is fully
  integrity-described without doubling the count. The mirror asserts
  `total_records == Σ non-aggregate files` before publishing.

### Changed

- **Metadata attribution** — `metadata.json` `sources[]` now itemizes **all nine
  datasets** individually (previously only five), so every release fully accounts
  for what it is derived from. Added the ACNC Annual Information Statement and the
  ASIC AFS / Credit / Banned & Disqualified datasets to `ABN_SOURCES`
  (`src/output.ts`), each with its CC-BY 3.0 AU attribution. No document-schema
  change (the output contract is unchanged) — metadata only.

### Added

- **0.17.0** — **GrantConnect grant awards** — `govGrants`
  (`{totalValueAud, grantCount, firstGrantDate, lastGrantDate}` | null) plus
  `flags.receivesGovGrants`. Additive, minor bump. Every Australian Government **grant
  awarded** to a recipient ABN (grants.gov.au), aggregated all-history — the grants
  complement to `govSpend` (AusTender **contracts**). ~200k+ awards since Dec 2017.
  - **New authenticated loader** (`src/gov-grants.ts`): grants.gov.au sits behind a
    CloudFront request-fingerprint filter (needs a full browser header set) and its
    bulk "Grant Award Published" report needs a free account. The loader logs in
    (`POST /RegisteredUser/Login` with the page's anti-forgery token → session cookie),
    downloads the report per publish-date year (`/Reports/GaPublishedDownload` → XLSX;
    the 50k-row cap is handled by bisecting a capped range), and sums value per
    recipient ABN in integer cents. Runs headless (plain `fetch` + cookie jar) — no
    browser at build time. Credentials come from repo secrets `GRANTCONNECT_USERNAME`
    / `GRANTCONNECT_PASSWORD` (never committed); a credless build skips the source and
    the production coverage gate then catches the gap.
  - CC-BY 3.0 AU (© Commonwealth of Australia, Dept of Finance / GrantConnect); added
    to `ABN_SOURCES`.
  - Proven on the real 20.3M build (see below).
- **0.16.0** — **ASIC SMSF auditors** — `smsfAuditor`
  (`{number, status, registrationDate, suspensionStartDate, suspensionEndDate}` | null)
  plus `flags.isSmsfAuditor`. Additive, minor bump. The entity is an ASIC-approved
  self-managed-super-fund auditor (`asic-smsf`) — a regulated financial profession;
  `suspension*` dates are an enforcement/risk signal. Keyed on the auditor's ABN
  (`SMSF_PERSON_ABN`); the source's auditor×condition rows dedupe to **~613 distinct
  auditor ABNs** (most approved auditors are individuals with no ABN — small but clean).
  CC-BY 3.0 AU (© ASIC), added to `ABN_SOURCES` (anti-drift test enforces it).
  - **Verified dead-ends (documented, not shipped):** ASIC Registered Auditors
    (ACN-only, ~221 — too low) and Liquidators (no ABN/ACN, name-keyed); NDIS
    Commission datasets (licence `notspecified`, not CC-BY); NGER (stale on data.gov.au,
    name-keyed live); GrantConnect (auth-gated portal). Only clean, CC-BY, ABN-keyed
    bulk sources are integrated.
  - Proven on the real 20.3M build: smsfAuditor 613; 0 composition errors, no duplicate
    `_id`, production gate green.
- **0.15.0** — **WGEA reporting** — `wgeaReporter` (`{primaryAbn, primaryOrganisation}`
  | null) plus `flags.isWgeaReporter`. Additive, minor bump. The entity reports to the
  Workplace Gender Equality Agency (`wgea-dataset`): an employer with **100+ staff**
  that lodges a gender-equality report — a size + gender-equality signal, ~10k
  organisations. Keyed directly on ABN; `primaryAbn`/`primaryOrganisation` name the
  submission group. Loaded from WGEA's dedicated per-ABN CSV (latest ABN-keyed snapshot
  is 2022). CC-BY 3.0 AU (© WGEA), added to `ABN_SOURCES`.
  - **Scoped decision:** the Modern Slavery Statements Register (originally paired here)
    was **excluded** — it moved to a web app (transparency.gov.au) with no bulk
    ABN-keyed CSV/API export, so there is no source to load cleanly. Documented in
    `DATA-SOURCES.md`; revisit if a bulk export appears.
  - Proven on the real 20.3M build: wgeaReporter coverage; 0 composition errors, no
    duplicate `_id`, production gate green.
- **0.14.0** — **ASIC representatives** — two per-ABN authorisation signals plus
  `flags.isAfsAuthorisedRep` / `isCreditRep`. Additive, minor bump.
  - `afsAuthorisedRep` (`{number, licenceNumber, status, startDate, endDate}` | null)
    — ASIC **AFS Authorised Representatives** (`asic-afs-authorised-representative`),
    ~126k businesses authorised to distribute financial products under an AFSL.
  - `creditRep` (`{number, licenceNumber, startDate, endDate}` | null) — ASIC **Credit
    Representatives** (`asic-credit-representative`), ~18k businesses authorised under
    a credit licence.
  - Both keyed on ABN-**or**-ACN → the ACN rows resolve via `asic_number` (the same
    type-guarded two-path as the ASIC AFS/credit licence sources; proven on the
    fixture ACN row). Both CC-BY 3.0 AU (© ASIC), added to `ABN_SOURCES`.
  - **Scoped decision:** the ASIC Financial Advisers Register (FAR) was evaluated for
    an adviser-count-per-AFSL signal but **excluded** — the published tab-delimited
    file carries embedded tabs in free-text columns before the ABN key (a field-count
    mismatch on real data), so a reliable ABN-keyed load isn't possible without
    risking column misalignment. Per the data-completeness policy we don't ship a
    source we can't load cleanly; its marginal value didn't justify a fragile parse.
- **0.13.0** — **Financial depth** (ATO) — two premium per-ABN money signals plus
  `flags.isLargeCorporateTaxpayer` / `claimsRdTaxIncentive`. Additive, minor bump.
  - `taxTransparency` (`{incomeYear, totalIncome, taxableIncome, taxPayable}` | null)
    — ATO **Corporate Tax Transparency** (`corporate-transparency`), the ~4.2k
    entities with ≥$100M total income and their actual income + tax paid.
    `taxableIncome`/`taxPayable` are null when the ATO reported ≤0. ABN-only.
  - `rdTaxIncentive` (`{incomeYear, totalRdExpenditure}` | null) — ATO **R&D Tax
    Incentive** (`research-and-development-tax-incentive`), ~13k companies' notional
    R&D spend. ABN-or-ACN keyed (the ~1.5% ACN rows resolve via `asic_number`, the
    same type-guarded two-path as the ASIC AFS/credit sources).
  - New **XLSX loader** (`src/load-xlsx.ts` + `src/xlsx-sources.ts`, using `exceljs`)
    — the first Excel-workbook sources: finds the ABN-bearing sheet, picks the latest
    income-year resource, routes ABN/ACN, COPYs into the staging table. Reusable
    (Bundle D's Aged Care register will use it). Also extended `parquet-output.ts`.
  - Both **CC-BY** but different versions (verified from the data.gov.au records):
    Corporate Tax Transparency **CC-BY 3.0 AU**, R&D Tax Incentive **CC-BY 2.5 AU** —
    © Commonwealth of Australia (Australian Taxation Office); added to `ABN_SOURCES`.
  - Proven on the real 20.3M build: taxTransparency **4,119**, rdTaxIncentive
    **13,019**; 0 composition errors, no duplicate `_id`, production gate green.
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
