# Document Schema Reference — long-black

> **Schema version:** 0.10.0
> **Runtime validation:** `src/schema.ts` (`AbnDocumentSchema`, Zod)
> **Breaking changes:** require a major version bump.

> 0.10.0 adds **charity financials** (additive, minor): a nested
> `charity.financials` object from the ACNC Annual Information Statement. 0.9.0 added
> the **regulated & risk** bundle (`financialServicesLicence`, `creditLicence`,
> `bannedDisqualified`). 0.6.0 added an optional **Parquet** output (`--parquet`) —
> the same fields as the NDJSON, scalars as native columns and nested fields as JSON
> strings.

One NDJSON document per ABN. This document is the contract: `src/schema.ts`,
this file, and `fixtures/expected-output.ndjson` move together (additive field =
minor bump; removal/rename = major). Enrichment objects (`company`, `charity`,
`financialServicesLicence`, `creditLicence`) and the enrichment arrays
(`registeredBusinessNames`, `bannedDisqualified`) are nullable/empty and populate
when a source row matches — on ABN, except `bannedDisqualified` which matches on
ACN (`asic_number`). The real ASIC/ACNC CSV loaders are wired (`src/enrich.ts`,
`sql/normalize-*.sql`); column mappings + verify-on-first-load confirmations are
in `docs/DATA-SOURCES.md`. The fixture seeds example rows to exercise the join
seam (see `fixtures/edge-cases.md`).

## Top-level fields

| Field                      | Type                                  | Nullable | Description                                                       | Source                                                |
| -------------------------- | ------------------------------------- | -------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| `_id`                      | string                                | no       | The ABN — 11 digits, always a string                              | ABR `ABN`                                             |
| `_version`                 | string                                | no       | Data version (ABR `TransferInfo/ExtractTime`, e.g. `2026.06.28`)  | build                                                 |
| `abnStatus`                | `"ACT"`\|`"CAN"`                      | no       | ABN status                                                        | ABR `ABN/@status`                                     |
| `abnStatusFromDate`        | string (ISO date)                     | yes      | ABN status start date                                             | ABR `ABN/@ABNStatusFromDate`                          |
| `entityName`               | string                                | yes      | Entity name (non-individual) or composed individual name          | `MainEntity` MN / `concat_ws(givenNames, familyName)` |
| `entityTypeCode`           | string                                | no       | Entity type code (130-value enum, e.g. `IND`,`PRV`,`PUB`)         | ABR `EntityType/EntityTypeInd`                        |
| `entityTypeText`           | string                                | yes      | Entity type label                                                 | ABR `EntityType/EntityTypeText`                       |
| `givenName`                | string                                | yes      | Individual given name(s), 1–2 joined                              | `LegalEntity/IndividualName/GivenName`                |
| `familyName`               | string                                | yes      | Individual family name                                            | `LegalEntity/IndividualName/FamilyName`               |
| `acn`                      | string                                | yes      | ACN/ARBN/ARSN/ARFN number (regardless of type)                    | ABR `ASICNumber`                                      |
| `acnType`                  | `"ACN"`\|`"ARBN"`\|`"ARSN"`\|`"ARFN"` | yes      | Which kind of ASIC number `acn` is                                | ABR `ASICNumber/@ASICNumberType`                      |
| `gstRegistered`            | boolean                               | no       | `true` iff GST status is `ACT`                                    | ABR `GST/@status`                                     |
| `gstStatusFromDate`        | string (ISO date)                     | yes      | GST status start date                                             | ABR `GST/@GSTStatusFromDate`                          |
| `recordLastUpdated`        | string (ISO date)                     | yes      | When the ABR record was last updated                              | ABR `ABR/@recordLastUpdatedDate`                      |
| `state`                    | string                                | yes      | Main business location state (`''` → `null`); incl. `AAT`         | ABR `BusinessAddress/.../State`                       |
| `postcode`                 | string                                | yes      | Main business location postcode                                   | ABR `BusinessAddress/.../Postcode`                    |
| `businessNames`            | string[]                              | no       | Registered business names (BN)                                    | ABR `OtherEntity[@type=BN]`                           |
| `tradingNames`             | string[]                              | no       | Trading names (TRD)                                               | ABR `OtherEntity[@type=TRD]`                          |
| `otherNames`               | string[]                              | no       | Other names (OTN)                                                 | ABR `OtherEntity[@type=OTN]`                          |
| `dgr`                      | `Dgr[]`                               | no       | Deductible Gift Recipient endorsements                            | ABR `DGR` (0..N)                                      |
| `registeredBusinessNames`  | `RegBN[]`                             | no       | ASIC registered business names (authoritative; 1:N on holder ABN) | ASIC Business Names                                   |
| `company`                  | `Company`\|null                       | yes      | ASIC Company enrichment (populated when matched on ABN)           | ASIC Company                                          |
| `charity`                  | `Charity`\|null                       | yes      | ACNC charity enrichment (populated when matched on ABN)           | ACNC                                                  |
| `financialServicesLicence` | `AfsLicence`\|null                    | yes      | ASIC AFS licence held by this ABN (regulatory/trust signal)       | ASIC AFS Licensee                                     |
| `creditLicence`            | `CreditLicence`\|null                 | yes      | ASIC credit licence held by this ABN                              | ASIC Credit Licensee                                  |
| `bannedDisqualified`       | `Banned[]`                            | no       | ASIC banning/disqualification actions (via ACN); empty if none    | ASIC Banned & Disqualified Orgs                       |

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

| Field              | Type                      | Nullable | Description                                         |
| ------------------ | ------------------------- | -------- | --------------------------------------------------- |
| `name`             | string                    | no       | Charity legal name                                  |
| `status`           | string                    | no       | Registration status (constant `Registered`)         |
| `size`             | string                    | yes      | Charity size (Small/Medium/Large)                   |
| `subtype`          | string                    | yes      | Highest-priority registered subtype                 |
| `registrationDate` | string (ISO date)         | yes      | When the charity was registered                     |
| `financials`       | `CharityFinancials`\|null | yes      | Latest ACNC Annual Information Statement financials |

### Nested: `charity.financials` (ACNC AIS)

The charity's most recent **Annual Information Statement** financials, folded into
`charity` (so it surfaces only for currently-registered charities — a charity that
deregistered after filing won't carry financials). Null when the charity has no AIS
on file. Shape: `CharityFinancialsSchema`. Monetary values are **JSON numbers**
(whole dollars); `staffFullTimeEquivalent` may be fractional. The AIS year is a
pinned snapshot (see `docs/DATA-SOURCES.md`); read the reporting year from
`reportingPeriodEnd`.

| Field                     | Type              | Nullable | Description                                    |
| ------------------------- | ----------------- | -------- | ---------------------------------------------- |
| `reportingPeriodStart`    | string (ISO date) | yes      | AIS financial-year start                       |
| `reportingPeriodEnd`      | string (ISO date) | yes      | AIS financial-year end                         |
| `totalRevenue`            | number            | yes      | Total revenue (whole dollars)                  |
| `totalExpenses`           | number            | yes      | Total expenses                                 |
| `totalAssets`             | number            | yes      | Total assets                                   |
| `totalLiabilities`        | number            | yes      | Total liabilities                              |
| `staffFullTimeEquivalent` | number            | yes      | Full-time-equivalent staff (may be fractional) |
| `volunteers`              | number            | yes      | Volunteer count                                |

## Nested: `financialServicesLicence` (ASIC AFS)

Populated when the entity holds a current Australian Financial Services licence
(1:0..1). `AFS_LIC_ABN_ACN` carries **either an 11-digit ABN or a 9-digit ACN**:
ABN rows match `abn` directly, ACN rows match `asic_number` **unless that number is
typed `ARBN`/`ARSN`/`ARFN`** (a known foreign/scheme number sharing the digits is
never matched; see the `acnType` note below for why this excludes rather than
requires `ACN`). The register lists current holders, so presence = a current AFSL.
Shape: `AfsLicenceSchema` in `src/schema.ts`.

| Field        | Type              | Nullable | Description                       |
| ------------ | ----------------- | -------- | --------------------------------- |
| `number`     | string            | no       | AFS licence number                |
| `name`       | string            | yes      | Licensee name as recorded by ASIC |
| `startDate`  | string (ISO date) | yes      | Licence start date                |
| `conditions` | string            | yes      | Licence conditions text, if any   |

## Nested: `creditLicence` (ASIC Credit)

Populated when the entity holds an ASIC credit licence (1:0..1). Same ABN-**or**-ACN
keying as the AFS licence above (`CRED_LIC_ABN_ACN`, type-guarded ACN fallback).
Shape: `CreditLicenceSchema`. `status` is the raw ASIC code (e.g. `APPR`).

| Field       | Type              | Nullable | Description              |
| ----------- | ----------------- | -------- | ------------------------ |
| `number`    | string            | no       | Credit licence number    |
| `name`      | string            | yes      | Licensee name            |
| `status`    | string            | yes      | Raw ASIC status code     |
| `startDate` | string (ISO date) | yes      | Licence start date       |
| `endDate`   | string (ISO date) | yes      | Licence end date, if any |

## Nested: `Banned` (bannedDisqualified)

Each element is an ASIC banning/disqualification action against the organisation.
Unlike the other ASIC sources this register is keyed on **ACN** (`BD_ORG_ACN`), so
it joins via `asic_number`, **excluding** asic_numbers typed `ARBN`/`ARSN`/`ARFN` —
matching a known foreign number that shares the 9 digits would attach another org's
enforcement record. 0..N actions per entity (`bannedDisqualified` is `[]` when
none). `endDate` is null for permanent bannings. Shape: `BannedDisqualifiedSchema`.

| Field       | Type              | Nullable | Description                                                 |
| ----------- | ----------------- | -------- | ----------------------------------------------------------- |
| `type`      | string            | yes      | Banning type (e.g. "Australian Financial Services banning") |
| `startDate` | string (ISO date) | yes      | When the banning started                                    |
| `endDate`   | string (ISO date) | yes      | When it ends (null = permanent)                             |
| `comment`   | string            | yes      | ASIC comment, if any                                        |

## Enums

- `abnStatus`: `ACT` (active), `CAN` (cancelled).
- `acnType`: `ACN`, `ARBN`, `ARSN`, `ARFN` — **but in practice always `null`**. The
  real ABR extract sets `@ASICNumberType = 'undetermined'` on every ASIC number
  (~4.07M of them), and the loader maps any value outside the enum to `null`. So
  `acn` (the number) is populated while `acnType` is null on real data; the enum
  values appear only if a future extract types its ASIC numbers properly. This is
  also why the ACN-path enrichment joins (AFS/credit/banned) **exclude** known
  foreign types rather than require `ACN` — see those nested sections.
- `entityTypeCode`: free string (the ABR `EntityTypeEnum` has ~130 values; not
  enumerated here to avoid churn — `entityTypeText` carries the label).

## Output format

NDJSON — one document per line, `ORDER BY abn`. Per-state split + gzip are
applied downstream (`crema` split/compress). Dates are ISO `YYYY-MM-DD`.

With `--parquet`, an all-ABN `long-black-<version>.parquet` is also emitted
(`crema` `convertToParquet`): scalar fields become native Parquet columns and the
nested/array fields (`businessNames`, `tradingNames`, `otherNames`, `dgr`,
`registeredBusinessNames`, `company`, `charity`, `financialServicesLicence`,
`creditLicence`, `bannedDisqualified`) are serialized to JSON strings. Consumers
can filter by the native `state` column.

## Data licensing

Derived from public Australian Government data under **CC-BY 3.0 AU** (Australian
Business Register, ASIC registers, and ACNC). See `docs/DATA-SOURCES.md`.
