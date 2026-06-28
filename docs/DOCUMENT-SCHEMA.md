# Document Schema Reference — long-black

> **Schema version:** 0.1.0
> **Runtime validation:** `src/schema.ts` (`AbnDocumentSchema`, Zod)
> **Breaking changes:** require a major version bump.

One NDJSON document per ABN. This document is the contract: `src/schema.ts`,
this file, and `fixtures/expected-output.ndjson` move together (additive field =
minor bump; removal/rename = major). Enrichment objects (`company`, `charity`)
are nullable and stay `null` until those sources are wired (P3).

## Top-level fields

| Field               | Type                                  | Nullable | Description                                                      | Source                                                |
| ------------------- | ------------------------------------- | -------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| `_id`               | string                                | no       | The ABN — 11 digits, always a string                             | ABR `ABN`                                             |
| `_version`          | string                                | no       | Data version (ABR `TransferInfo/ExtractTime`, e.g. `2026.06.28`) | build                                                 |
| `abnStatus`         | `"ACT"`\|`"CAN"`                      | no       | ABN status                                                       | ABR `ABN/@status`                                     |
| `abnStatusFromDate` | string (ISO date)                     | yes      | ABN status start date                                            | ABR `ABN/@ABNStatusFromDate`                          |
| `entityName`        | string                                | yes      | Entity name (non-individual) or composed individual name         | `MainEntity` MN / `concat_ws(givenNames, familyName)` |
| `entityTypeCode`    | string                                | no       | Entity type code (130-value enum, e.g. `IND`,`PRV`,`PUB`)        | ABR `EntityType/EntityTypeInd`                        |
| `entityTypeText`    | string                                | yes      | Entity type label                                                | ABR `EntityType/EntityTypeText`                       |
| `givenName`         | string                                | yes      | Individual given name(s), 1–2 joined                             | `LegalEntity/IndividualName/GivenName`                |
| `familyName`        | string                                | yes      | Individual family name                                           | `LegalEntity/IndividualName/FamilyName`               |
| `acn`               | string                                | yes      | ACN/ARBN/ARSN/ARFN number (regardless of type)                   | ABR `ASICNumber`                                      |
| `acnType`           | `"ACN"`\|`"ARBN"`\|`"ARSN"`\|`"ARFN"` | yes      | Which kind of ASIC number `acn` is                               | ABR `ASICNumber/@ASICNumberType`                      |
| `gstRegistered`     | boolean                               | no       | `true` iff GST status is `ACT`                                   | ABR `GST/@status`                                     |
| `gstStatusFromDate` | string (ISO date)                     | yes      | GST status start date                                            | ABR `GST/@GSTStatusFromDate`                          |
| `recordLastUpdated` | string (ISO date)                     | yes      | When the ABR record was last updated                             | ABR `ABR/@recordLastUpdatedDate`                      |
| `state`             | string                                | yes      | Main business location state (`''` → `null`); incl. `AAT`        | ABR `BusinessAddress/.../State`                       |
| `postcode`          | string                                | yes      | Main business location postcode                                  | ABR `BusinessAddress/.../Postcode`                    |
| `businessNames`     | string[]                              | no       | Registered business names (BN)                                   | ABR `OtherEntity[@type=BN]`                           |
| `tradingNames`      | string[]                              | no       | Trading names (TRD)                                              | ABR `OtherEntity[@type=TRD]`                          |
| `otherNames`        | string[]                              | no       | Other names (OTN)                                                | ABR `OtherEntity[@type=OTN]`                          |
| `dgr`               | `Dgr[]`                               | no       | Deductible Gift Recipient endorsements                           | ABR `DGR` (0..N)                                      |
| `company`           | `Company`\|null                       | yes      | ASIC Company enrichment (null until P3.01)                       | ASIC Company                                          |
| `charity`           | `Charity`\|null                       | yes      | ACNC charity enrichment (null until P3.03)                       | ACNC                                                  |

## Nested: `Dgr`

| Field            | Type              | Nullable | Description                                 |
| ---------------- | ----------------- | -------- | ------------------------------------------- |
| `name`           | string            | yes      | DGR fund name (the entity itself if absent) |
| `statusFromDate` | string (ISO date) | yes      | Endorsement start date                      |

## Nested: `company` (P3.01) / `charity` (P3.03)

Null until those sources are wired. Shapes: `CompanyEnrichmentSchema` /
`CharityEnrichmentSchema` in `src/schema.ts`.

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
