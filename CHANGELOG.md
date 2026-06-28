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

- **0.4.0** — ACNC charity enrichment (`charity{}`), via `LEFT JOIN acnc_charity`.
- **0.3.0** — ASIC Business Names enrichment (`registeredBusinessNames[]`, 1:N),
  via a `json_agg` CTE; kept separate from ABR's `businessNames`.
- **0.2.0** — ASIC Company enrichment (`company{}`), via `DISTINCT ON` + `LEFT JOIN`.
- **0.1.0** — ABR core: `saxes` streaming XML → COPY → flatten → one AbnDocument
  per ABN; per-state split + gzip + `metadata.json`; fixture-first dev loop with
  byte-for-byte regression. Built on `crema`.

### Notes

- Code: Apache-2.0. Derived data: CC-BY 3.0 AU (attribution in `metadata.json`).
