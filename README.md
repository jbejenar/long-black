# long-black

### Australian businesses. Flattened and served.

long-black turns Australia's public **business-entity** data into a single flat
file of pre-joined records — **one NDJSON document per ABN**. It spins up an
ephemeral Postgres, streams in the ABR ABN Bulk Extract (~20M ABNs), joins it
with ASIC Company, ASIC Business Names, ACNC charity + AIS financials, ASIC AFS &
credit licence, ASIC banned & disqualified, AusTender government-contract spend,
ATO corporate-tax-transparency + R&D-incentive data, and ASIC AFS + credit authorised
representatives, flattens to one document per ABN, and writes per-state gzipped
NDJSON. Then it dies. Postgres is a build tool,
not
infrastructure.

The pipeline spine lives in [`crema`](../crema) — a shared streaming-pipeline core
extracted from its sister project [`flat-white`](../flat-white) (addresses).
long-black is the thin ABN **domain layer** on top.

## What's in a document?

```json
{
  "_id": "51824753556",
  "_version": "2026.06.25",
  "abnStatus": "ACT",
  "entityName": "ACME PRIVATE PTY LTD",
  "entityTypeCode": "PRV",
  "acn": "000000761",
  "acnType": "ACN",
  "gstRegistered": true,
  "state": "VIC",
  "postcode": "3000",
  "businessNames": ["ACME"],
  "tradingNames": [],
  "otherNames": [],
  "dgr": [],
  "registeredBusinessNames": [{ "name": "ACME BRANDS", "status": "Registered" }],
  "company": { "status": "Registered", "type": "APTY", "...": "..." },
  "charity": null,
  "financialServicesLicence": { "number": "240001", "startDate": "2003-05-01", "...": "..." },
  "creditLicence": null,
  "bannedDisqualified": [],
  "govSpend": { "totalValueAud": 1500000.5, "contractCount": 3, "lastContractDate": "2024-09-01" },
  "ageYears": 25,
  "isActive": true,
  "flags": { "isCompany": true, "isLicensed": true, "hasGovContracts": true, "...": false }
}
```

Full reference: [docs/DOCUMENT-SCHEMA.md](docs/DOCUMENT-SCHEMA.md).

## Quick start (dev loop)

```bash
npm install
docker compose up db -d           # ephemeral postgres:16
./scripts/build-fixture-only.sh   # seed → flatten → verify → byte-for-byte (<30s)
```

## Build the real thing

```bash
LONG_BLACK_VERSION=2026.06.25 ./scripts/build-local.sh
# download (~1 GB) → load (saxes XML → COPY) → flatten → verify → per-state .ndjson.gz + metadata.json
```

## How it works

```
download (data.gov.au CKAN)  →  load (saxes XML → COPY)  →  enrich (ASIC/ACNC CSV → COPY)
        →  flatten (Postgres → NDJSON)  →  verify (schema + ABN mod-89)
        →  split per state  →  gzip  →  metadata.json
```

Everything except `load`, `enrich`, `compose`, the schema, and the SQL comes from
`crema`.

## Releases

Each monthly [GitHub Release](https://github.com/jbejenar/long-black/releases)
ships the per-state `long-black-<version>-<state>.ndjson.gz` shards, an all-ABN
`.parquet`, `metadata.json` (per-state counts + CC-BY attribution), and
`manifest.json` (per-shard sha256 + record counts + build provenance). A browsable
[release catalogue](https://jbejenar.github.io/long-black/) is generated and
published to GitHub Pages after each build. See
[docs/RELEASING.md](docs/RELEASING.md).

```bash
# grab one state's file from the latest release:
gh release download --repo jbejenar/long-black --pattern 'long-black-*-nsw.ndjson.gz'
```

## Data sources

ABR ABN Bulk Extract + ASIC Company + ASIC Business Names + ACNC Charities + ACNC
Annual Information Statement + ASIC AFS Licensees + ASIC Credit Licensees + ASIC
Banned & Disqualified Orgs (all data.gov.au) + AusTender contracts (OCDS, via the OCP
Data Registry) + ATO Corporate Tax Transparency + ATO R&D Tax Incentive + ASIC AFS
Authorised Representatives + ASIC Credit Representatives — all
**CC-BY** (mostly 3.0 AU; the ATO R&D dataset is CC-BY 2.5 AU), joined on the ABN (the
banned register on the ACN). See [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) for the
per-source licence + attribution.

## Tech stack

| Layer         | Choice                                                                              |
| ------------- | ----------------------------------------------------------------------------------- |
| Database      | PostgreSQL 16 (ephemeral, no PostGIS)                                               |
| Loader        | `saxes` streaming XML (ABR) + COPY-based CSV/TSV (ASIC/ACNC) → COPY                 |
| Pipeline core | `crema` (flatten, split, compress, verify, download, metadata, manifest, catalogue) |
| Language      | Node 22 / TypeScript (ESM, strict)                                                  |
| Output        | NDJSON (per-state, gzipped) + optional all-ABN Parquet (`--parquet`)                |

## Licence

Code: **Apache-2.0**. Derived data: **CC-BY** per source — mostly CC-BY 3.0 AU, with
the ATO R&D Tax Incentive dataset under CC-BY 2.5 AU. Each source's exact licence +
attribution is recorded per-dataset in `metadata.json` (`sources[]`) and
[docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).
