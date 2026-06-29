# Document Schema Reference — long-black

> **Schema version:** 0.5.0
> **Runtime validation:** `src/schema.ts` (`AbnDocumentSchema`, Zod)
> **Breaking changes:** require a major version bump.

One NDJSON document per ABN. This document is the contract: `src/schema.ts`,
this file, and `fixtures/expected-output.ndjson` move together (additive field =
minor bump; removal/rename = major). Enrichment objects (`company`, `charity`)
and `registeredBusinessNames` are nullable/empty and populate when a source row
matches on ABN. The real ASIC/ACNC CSV loaders are wired (`src/enrich.ts`,
`sql/normalize-*.sql`); column mappings + verify-on-first-load confirmations are
in `docs/DATA-SOURCES.md`. The fixture seeds example rows to exercise the join
seam (see `fixtures/edge-cases.md`).

## Top-level fields

| Field                     | Type                                  | Nullable | Description                                                       | Source                                                |
| ------------------------- | ------------------------------------- | -------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| `_id`                     | string                                | no       | The ABN — 11 digits, always a string                              | ABR `ABN`                                             |
| `_version`                | string                                | no       | Data version (ABR `TransferInfo/ExtractTime`, e.g. `2026.06.28`)  | build                                                 |
| `abnStatus`               | `"ACT"`\|`"CAN"`                      | no       | ABN status                                                        | ABR `ABN/@status`                                     |
| `abnStatusFromDate`       | string (ISO date)                     | yes      | ABN status start date                                             | ABR `ABN/@ABNStatusFromDate`                          |
| `entityName`              | string                                | yes      | Entity name (non-individual) or composed individual name          | `MainEntity` MN / `concat_ws(givenNames, familyName)` |
| `entityTypeCode`          | string                                | no       | Entity type code (130-value enum, e.g. `IND`,`PRV`,`PUB`)         | ABR `EntityType/EntityTypeInd`                        |
| `entityTypeText`          | string                                | yes      | Entity type label                                                 | ABR `EntityType/EntityTypeText`                       |
| `givenName`               | string                                | yes      | Individual given name(s), 1–2 joined                              | `LegalEntity/IndividualName/GivenName`                |
| `familyName`              | string                                | yes      | Individual family name                                            | `LegalEntity/IndividualName/FamilyName`               |
| `acn`                     | string                                | yes      | ACN/ARBN/ARSN/ARFN number (regardless of type)                    | ABR `ASICNumber`                                      |
| `acnType`                 | `"ACN"`\|`"ARBN"`\|`"ARSN"`\|`"ARFN"` | yes      | Which kind of ASIC number `acn` is                                | ABR `ASICNumber/@ASICNumberType`                      |
| `gstRegistered`           | boolean                               | no       | `true` iff GST status is `ACT`                                    | ABR `GST/@status`                                     |
| `gstStatusFromDate`       | string (ISO date)                     | yes      | GST status start date                                             | ABR `GST/@GSTStatusFromDate`                          |
| `recordLastUpdated`       | string (ISO date)                     | yes      | When the ABR record was last updated                              | ABR `ABR/@recordLastUpdatedDate`                      |
| `state`                   | string                                | yes      | Main business location state (`''` → `null`); incl. `AAT`         | ABR `BusinessAddress/.../State`                       |
| `postcode`                | string                                | yes      | Main business location postcode                                   | ABR `BusinessAddress/.../Postcode`                    |
| `businessNames`           | string[]                              | no       | Registered business names (BN)                                    | ABR `OtherEntity[@type=BN]`                           |
| `tradingNames`            | string[]                              | no       | Trading names (TRD)                                               | ABR `OtherEntity[@type=TRD]`                          |
| `otherNames`              | string[]                              | no       | Other names (OTN)                                                 | ABR `OtherEntity[@type=OTN]`                          |
| `dgr`                     | `Dgr[]`                               | no       | Deductible Gift Recipient endorsements                            | ABR `DGR` (0..N)                                      |
| `registeredBusinessNames` | `RegBN[]`                             | no       | ASIC registered business names (authoritative; 1:N on holder ABN) | ASIC Business Names                                   |
| `company`                 | `Company`\|null                       | yes      | ASIC Company enrichment (populated when matched on ABN)           | ASIC Company                                          |
| `charity`                 | `Charity`\|null                       | yes      | ACNC charity enrichment (populated when matched on ABN)           | ACNC                                                  |

## Nested: `Dgr`

| Field            | Type              | Nullable | Description                                 |
| ---------------- | ----------------- | -------- | ------------------------------------------- |
| `name`           | string            | yes      | DGR fund name (the entity itself if absent) |
| `statusFromDate` | string (ISO date) | yes      | Endorsement start date                      |

## Nested: `RegBN` (registeredBusinessNames)

Each element of `registeredBusinessNames` — ASIC's authoritative registered
business names (1:N on the holder ABN, `BN_ABN`), aggregated in the flatten.

| Field              | Type              | Nullable | Description                        |
| ------------------ | ----------------- | -------- | ---------------------------------- |
| `name`             | string            | no       | Registered business name (trimmed) |
| `status`           | string            | yes      | Registration status                |
| `registrationDate` | string (ISO date) | yes      | When the name was registered       |
| `cancellationDate` | string (ISO date) | yes      | When the name was cancelled        |

## Nested: `company` (ASIC Company)

Populated when an ASIC company record matches on ABN (1:1 — the loader keeps only
the current-name row). Shape: `CompanyEnrichmentSchema` in `src/schema.ts`.

| Field                         | Type              | Nullable | Description                                              |
| ----------------------------- | ----------------- | -------- | -------------------------------------------------------- |
| `acn`                         | string            | yes      | ACN                                                      |
| `name`                        | string            | yes      | Current legal name                                       |
| `currentName`                 | string            | yes      | Resolved current name when distinct (null on most rows)  |
| `type` / `class` / `subClass` | string            | yes      | Raw ASIC company type/class/sub-class codes              |
| `status`                      | string            | yes      | `Registered`/`Deregistered` (REGD/DRGD); other codes raw |
| `registrationDate`            | string (ISO date) | yes      | Date of registration                                     |
| `deregistrationDate`          | string (ISO date) | yes      | Date of deregistration                                   |
| `previousState`               | string            | yes      | Previous state of registration                           |
| `stateRegistrationNumber`     | string            | yes      | State registration number                                |

## Nested: `charity` (ACNC)

Populated when an ACNC charity matches on ABN (1:0..1). Shape:
`CharityEnrichmentSchema` in `src/schema.ts`. The `datadotgov_main` register has
no per-row status column (it lists currently-registered charities), so `status`
is the constant `Registered`; charitable purpose is a boolean-flag matrix, so
`subtype` is the single highest-priority registered subtype (PBI/HPC first, then
the charitable purposes in ACNC Act order), null when none is flagged.

| Field              | Type              | Nullable | Description                                 |
| ------------------ | ----------------- | -------- | ------------------------------------------- |
| `name`             | string            | no       | Charity legal name                          |
| `status`           | string            | no       | Registration status (constant `Registered`) |
| `size`             | string            | yes      | Charity size (Small/Medium/Large)           |
| `subtype`          | string            | yes      | Highest-priority registered subtype         |
| `registrationDate` | string (ISO date) | yes      | When the charity was registered             |

## Enums

- `abnStatus`: `ACT` (active), `CAN` (cancelled).
- `acnType`: `ACN`, `ARBN`, `ARSN`, `ARFN`.
- `entityTypeCode`: free string (the ABR `EntityTypeEnum` has ~130 values; not
  enumerated here to avoid churn — `entityTypeText` carries the label).

## Output format

NDJSON — one document per line, `ORDER BY abn`. Per-state split + gzip are
applied downstream (`crema` split/compress). Dates are ISO `YYYY-MM-DD`.

## Data licensing

Derived from public Australian Government data under **CC-BY 3.0 AU**
(Australian Business Register / ABN Lookup Bulk Extract). See `docs/DATA-SOURCES.md`.
