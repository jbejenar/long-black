# Data Sources — long-black

All sources are published on [data.gov.au](https://data.gov.au), licensed
**Creative Commons Attribution 3.0 Australia (CC-BY 3.0 AU)**, and carry the
**ABN** (or, for the banned register, the **ACN**) as a common join key. This is
what makes a pre-joined super-dataset possible — and is why long-black uses a
relational store (Postgres) rather than a direct XML→NDJSON stream.

| Source                          | CKAN id                        | Format           | Size                                | Cadence      | Join key                | Contributes                                                                       |
| ------------------------------- | ------------------------------ | ---------------- | ----------------------------------- | ------------ | ----------------------- | --------------------------------------------------------------------------------- |
| **ABR ABN Bulk Extract** (core) | `abn-bulk-extract`             | XML, 2 ZIP parts | ~493 MB ×2 (~6–8 GB XML), ~15M ABNs | Weekly       | **ABN**, ACN/ARBN       | entity name/type, ABN status, GST, DGR, business/trading names, state+postcode    |
| **ASIC Company**                | `asic-companies`               | CSV (tab) / ZIP  | ~394 MB                             | Weekly (Tue) | **ABN** + ACN           | `company{}` — type/class/status, registration & deregistration dates, prior state |
| **ASIC Business Names**         | `asic-business-names`          | CSV (tab) / ZIP  | ~247 MB                             | Weekly (Wed) | **ABN** of holder       | `registeredBusinessNames[]` — authoritative names + status/dates                  |
| **ACNC Registered Charities**   | `acnc-register`                | CSV / XLSX       | ~15 MB, ~60k                        | Weekly       | **ABN**                 | `charity{}` — status, size, subtype, registration date                            |
| **ASIC AFS Licensees**          | `asic-afs-licensee`            | CSV (comma)      | ~1 MB, ~6.3k                        | Weekly       | **ABN**                 | `financialServicesLicence{}` — AFS licence number, name, start date, conditions   |
| **ASIC Credit Licensees**       | `asic-credit-licensee`         | CSV (comma)      | ~1 MB, ~3.9k                        | Weekly       | **ABN**                 | `creditLicence{}` — credit licence number, name, status, start/end dates          |
| **ASIC Banned & Disqualified**  | `asic-banned-disqualified-org` | CSV (tab)        | ~10 KB, ~15 rows                    | Weekly       | **ACN** (`asic_number`) | `bannedDisqualified[]` — banning/disqualification actions (type, dates, comment)  |

**Why the regulated & risk bundle.** AFS and credit licences are the two
ASIC-issued permissions that gate who may legally provide financial or consumer-
credit services in Australia; the banned & disqualified register records ASIC
enforcement actions. Together they turn long-black from a registry mirror into a
**trust/risk signal** — a consumer can tell whether an ABN is a licensed financial
services provider and whether it (or its corporate entity) has been actioned by
the regulator.

**Future tail** (same seam, when wanted): ASIC AFS authorised representatives,
auditors, liquidators, banned & disqualified **persons** (vs orgs); ACNC Annual
Information Statement financials; AusTender government-contract spend — all
data.gov.au, CC-BY, keyed on ABN/ACN.

## Notes

- **ASIC delimiters are per-file, not uniform** — confirmed by sampling each live
  file (verify-on-first-load), since the `.csv` extension lies:
  - **Tab-delimited, pure TSV** (`quoting: false`): the large registers — ASIC
    Company, ASIC Business Names, and the ASIC Banned & Disqualified Orgs file.
    `"` and `\` appear LITERALLY inside values (5500+ literal `"` in a 600 KB
    Business Names sample) and a tab never appears inside a value, so they are
    loaded with quote-parsing disabled (`enrich.ts` → `loadDelimitedRaw` with
    `quoting: false`, which COPYs as `FORMAT csv` with a control-byte QUOTE so
    `"`, `\` and `\.` are all literal).
  - **Real comma CSV** (`quoting: true`, RFC-4180): ACNC, **ASIC AFS Licensees**,
    and **ASIC Credit Licensees** — quoted fields, loaded with quoting on.
- The joined document **mixes snapshots** taken on different days (ABR weekly,
  ASIC Tue/Wed, ACNC weekly). Each source's extract date is recorded in
  `metadata.json`; the document `_version` tracks the ABR `TransferInfo/ExtractTime`.
- **Individual names** (sole traders' `givenName`/`familyName`) are public data
  published by the ABR under CC-BY; redistribution is permitted.
- **Enrichment is additive + best-effort.** The typed staging tables start empty;
  a transient data.gov.au failure for any one source leaves its nested object
  null rather than failing the whole build (`enrich-cli.js` reports per-source
  failures and the build logs a warning and continues).

## Enrichment column mappings (verify-on-first-load)

The enrichment loader (`src/enrich.ts`) discovers each source's data CSV by
stable package id, COPYs it into an all-`text` raw table built from the file's
real header (`sniffHeader` → `buildRawTableDdl`, so column count always matches),
then a per-source normalize SQL casts and projects into the typed staging table.
Dates are **DD/MM/YYYY** (Australian) → `to_date(…, 'DD/MM/YYYY')`. Rows without a
valid 11-digit ABN are skipped (they cannot join the ABR base).

**ASIC Company** (`sql/normalize-asic-company.sql`) — the register carries one row
per name a company has held; only the **current-name row** (`Current Name
Indicator = 'Y'`) is loaded, so `company.name` is the current legal name and the
join is 1:1. `Status` codes `REGD`/`DRGD` expand to `Registered`/`Deregistered`
(matching the fixture's readable form); any other code (`EXAD`, `SOFF`, …) passes
through raw rather than risk an inexact description. `type`/`class`/`subClass`
stay raw ASIC codes by design.

| Output (`company.*`)          | ASIC column                           |
| ----------------------------- | ------------------------------------- |
| `name`                        | Company Name (current-name row)       |
| `currentName`                 | Current Name (blank on Y rows → null) |
| `acn`                         | ACN                                   |
| `type` / `class` / `subClass` | Type / Class / Sub Class              |
| `status`                      | Status (REGD/DRGD expanded)           |
| `registrationDate`            | Date of Registration                  |
| `deregistrationDate`          | Date of Deregistration                |
| `previousState`               | Previous State of Registration        |
| `stateRegistrationNumber`     | State Registration number             |

**ASIC Business Names** (`sql/normalize-asic-business-name.sql`) — 1:N on the
holder ABN (`BN_ABN`); the flatten aggregates per ABN. Names are space-padded in
the source (a fixed-width export artifact) and are trimmed.

| Output (`registeredBusinessNames[].*`) | ASIC column  |
| -------------------------------------- | ------------ |
| `name`                                 | BN_NAME      |
| `status`                               | BN_STATUS    |
| `registrationDate`                     | BN_REG_DT    |
| `cancellationDate`                     | BN_CANCEL_DT |

(`bn_number` ← BN_STATE_NUM and `state` ← BN_STATE_OF_REG are staged but not yet
emitted; `REGISTER_NAME`, always "BUSINESS NAMES", is not carried.)

**ACNC charities** (`sql/normalize-acnc-charity.sql`) — the `datadotgov_main`
register lists currently-registered charities and has **no per-row status
column**, so `charity.status` is the constant `'Registered'`. Charitable purpose
is encoded as ~14 boolean flag columns rather than a single subtype, so
`charity.subtype` is the **single highest-priority registered subtype** — PBI/HPC
first (the institutional subtypes), then the charitable purposes in ACNC Act
order — and null when none is flagged.

| Output (`charity.*`) | ACNC column                                  |
| -------------------- | -------------------------------------------- |
| `name`               | Charity_Legal_Name                           |
| `status`             | constant `'Registered'`                      |
| `size`               | Charity_Size                                 |
| `subtype`            | priority projection of the ~14 purpose flags |
| `registrationDate`   | Registration_Date                            |

**ASIC AFS Licensees** (`sql/normalize-asic-afs-licence.sql`) — the register lists
**current** AFS licence holders (the "- Current" CSV). `AFS_LIC_ABN_ACN` carries
the holder's 11-digit ABN; rows without one can't join the ABR base and are
skipped. Presence of a row = the ABN holds a current AFSL (there is no per-row
status column). 1:0..1 per ABN (`DISTINCT ON (abn)`).

| Output (`financialServicesLicence.*`) | ASIC column       |
| ------------------------------------- | ----------------- |
| `number`                              | AFS_LIC_NUM       |
| `name`                                | AFS_LIC_NAME      |
| `startDate`                           | AFS_LIC_START_DT  |
| `conditions`                          | AFS_LIC_CONDITION |

**ASIC Credit Licensees** (`sql/normalize-asic-credit-licence.sql`) — same shape
as the AFS register, keyed on the 11-digit `CRED_LIC_ABN_ACN`. `status` is the
raw ASIC code (e.g. `APPR`) passed through unchanged rather than risk an inexact
expansion. 1:0..1 per ABN.

| Output (`creditLicence.*`) | ASIC column       |
| -------------------------- | ----------------- |
| `number`                   | CRED_LIC_NUM      |
| `name`                     | CRED_LIC_NAME     |
| `status`                   | CRED_LIC_STATUS   |
| `startDate`                | CRED_LIC_START_DT |
| `endDate`                  | CRED_LIC_END_DT   |

**ASIC Banned & Disqualified Orgs** (`sql/normalize-asic-banned-disqualified.sql`)
— the one register keyed on **ACN, not ABN**: `BD_ORG_ACN` is a 9-digit ACN, so
it joins via `asic_number` (the ABR-supplied ACN/ARBN), not the ABN. Non-digits
are stripped and only valid 9-digit ACNs are kept. Dates are guarded — `BD_ORG_END_DT`
holds free text such as "Permanent banning" for permanent actions, parsed to null
(a permanent ban has no end date). 0..N actions per org (`json_agg`, ordered by
start date then type). Tiny, volatile source (~15 rows — most ASIC bannings are of
persons, not orgs).

| Output (`bannedDisqualified[].*`) | ASIC column                                                   |
| --------------------------------- | ------------------------------------------------------------- |
| `type`                            | BD_ORG_TYPE                                                   |
| `startDate`                       | BD_ORG_START_DT                                               |
| `endDate`                         | BD_ORG_END_DT (free text → null when not a `DD/MM/YYYY` date) |
| `comment`                         | BD_ORG_COMMENT                                                |

(The join column `acn` ← `BD_ORG_ACN` and `name` ← `BD_ORG_NAME` are staged for
the match but `name`/`acn` are not re-emitted — the ABN's own `entityName`/`acn`
already carry them.)

## Attribution (required by CC-BY 3.0 AU)

- © Commonwealth of Australia (Australian Business Register)
- © Australian Securities and Investments Commission (ASIC)
- © Australian Charities and Not-for-profits Commission (ACNC)

These appear in every build's `metadata.json` (`sources[].attribution`).
