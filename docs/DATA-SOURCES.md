# Data Sources — long-black

All four sources are published on [data.gov.au](https://data.gov.au), licensed
**Creative Commons Attribution 3.0 Australia (CC-BY 3.0 AU)**, and carry the
**ABN** as a common join key. This is what makes a pre-joined super-dataset
possible — and is why long-black uses a relational store (Postgres) rather than a
direct XML→NDJSON stream.

| Source                          | CKAN id               | Format           | Size                                | Cadence      | Join key          | Contributes                                                                       |
| ------------------------------- | --------------------- | ---------------- | ----------------------------------- | ------------ | ----------------- | --------------------------------------------------------------------------------- |
| **ABR ABN Bulk Extract** (core) | `abn-bulk-extract`    | XML, 2 ZIP parts | ~493 MB ×2 (~6–8 GB XML), ~15M ABNs | Weekly       | **ABN**, ACN/ARBN | entity name/type, ABN status, GST, DGR, business/trading names, state+postcode    |
| **ASIC Company**                | `asic-companies`      | CSV (tab) / ZIP  | ~394 MB                             | Weekly (Tue) | **ABN** + ACN     | `company{}` — type/class/status, registration & deregistration dates, prior state |
| **ASIC Business Names**         | `asic-business-names` | CSV (tab) / ZIP  | ~247 MB                             | Weekly (Wed) | **ABN** of holder | `registeredBusinessNames[]` — authoritative names + status/dates                  |
| **ACNC Registered Charities**   | `acnc-register`       | CSV / XLSX       | ~15 MB, ~60k                        | Weekly       | **ABN**           | `charity{}` — status, size, subtype, registration date                            |

**Future tail** (same seam, when wanted): ASIC AFS licensees & representatives,
credit licensees, auditors, liquidators, banned & disqualified persons/orgs — all
data.gov.au, CC-BY, keyed on ABN/ACN/licence.

## Notes

- **ASIC `.csv` files are tab-delimited** despite the extension; the holder-ABN
  column name is confirmed on first real load (`load-csv.ts` `sniffHeader`).
- The joined document **mixes snapshots** taken on different days (ABR weekly,
  ASIC Tue/Wed, ACNC weekly). Each source's extract date is recorded in
  `metadata.json`; the document `_version` tracks the ABR `TransferInfo/ExtractTime`.
- **Individual names** (sole traders' `givenName`/`familyName`) are public data
  published by the ABR under CC-BY; redistribution is permitted.

## Attribution (required by CC-BY 3.0 AU)

- © Commonwealth of Australia (Australian Business Register)
- © Australian Securities and Investments Commission (ASIC)
- © Australian Charities and Not-for-profits Commission (ACNC)

These appear in every build's `metadata.json` (`sources[].attribution`).
