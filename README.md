# long-black

### Australian businesses. Flattened and served.

long-black turns Australia's public **business-entity** data into a single flat
file of pre-joined records — **one NDJSON document per ABN**. It spins up an
ephemeral Postgres, streams in the ABR ABN Bulk Extract (~15M ABNs), joins it
with ASIC Company, ASIC Business Names, and ACNC charity data on the ABN,
flattens to one document per ABN, and writes per-state gzipped NDJSON. Then it
dies. Postgres is a build tool, not infrastructure.

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
  "charity": null
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
download (data.gov.au CKAN)  →  load (saxes XML → COPY)  →  flatten (Postgres → NDJSON)
        →  verify (schema + ABN mod-89)  →  split per state  →  gzip  →  metadata.json
```

Everything except `load`, `compose`, the schema, and the SQL comes from `crema`.

## Data sources

ABR ABN Bulk Extract + ASIC Company + ASIC Business Names + ACNC Charities — all
data.gov.au, **CC-BY 3.0 AU**, joined on the ABN. See
[docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

## Tech stack

| Layer         | Choice                                                                |
| ------------- | --------------------------------------------------------------------- |
| Database      | PostgreSQL 16 (ephemeral, no PostGIS)                                 |
| Loader        | `saxes` streaming XML → COPY (native TS)                              |
| Pipeline core | `crema` (flatten engine, split, compress, verify, download, metadata) |
| Language      | Node 22 / TypeScript (ESM, strict)                                    |
| Output        | NDJSON, per-state gzipped                                             |

## Licence

Code: **Apache-2.0**. Derived data: **CC-BY 3.0 AU** (see attribution in
`metadata.json` and [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md)).
