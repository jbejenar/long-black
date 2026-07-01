# Fixture edge cases — long-black

The fixture (`fixtures/seed-postgres.sql`) seeds ~20 representative ABNs into the
`abn` staging table, plus example rows into the twelve enrichment stub tables
(`asic_company`, `asic_business_name`, `acnc_charity`, `acnc_ais`,
`asic_afs_licence`, `asic_credit_licence`, `asic_banned_disqualified`, `gov_spend`,
`tax_transparency`, `rd_tax_incentive`, `asic_afs_rep`, `asic_credit_rep`) so the join
seam is exercised end-to-end (not just stubbed). All ABNs are checksum-valid (mod-89).
Each row exercises a distinct edge case the flatten + schema + verify must handle.

| ABN         | Case                                                            | What it guards                                                                                                   |
| ----------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 51000000680 | Sole trader (IND), two given names, no GST                      | individual name composition; `gstRegistered=false`                                                               |
| 51000000761 | Private company (PRV), ACN, GST active, 1 business name         | the common company shape                                                                                         |
| 51000000793 | Public company (PUB)                                            | entity type variety                                                                                              |
| 51000000810 | Discretionary trust (DTT), no GST                               | trust entity type; null ACN                                                                                      |
| 51000000842 | Super fund (SMF), no ACN                                        | super fund entity type                                                                                           |
| 51000000874 | Government entity (GOV)                                         | government entity type                                                                                           |
| 51000000923 | Single DGR endorsement                                          | `dgr[]` with one element                                                                                         |
| 51000000955 | **Multiple** DGR endorsements                                   | fan-out guard (1:N DGR)                                                                                          |
| 51000000987 | GST cancelled (`status=CAN`); `asic_number_type='undetermined'` | `gstRegistered=false` despite a GST date; **acnType → null** (the real-ABR shape) yet ACN-path joins still match |
| 51000001490 | GST never registered (null)                                     | null GST                                                                                                         |
| 51000001571 | Multiple business + trading + other names                       | fan-out guard (1:N names)                                                                                        |
| 51000001620 | Cancelled ABN (`abnStatus=CAN`)                                 | cancelled-entity handling                                                                                        |
| 51000001652 | **Empty-string** state and postcode                             | `'' → null` in the doc; `other` bucket on split                                                                  |
| 51000001684 | `AAT` (Antarctic) state                                         | the rare valid state code                                                                                        |
| 51000001701 | ACN present, no GST                                             | ACN without GST                                                                                                  |
| 51000001733 | Names with `&`, apostrophe, unicode (`Ø`,`É`)                   | escaping / UTF-8 round-trip                                                                                      |
| 51000001765 | Individual with **only a family name**                          | the `concat_ws` fix — entityName must be `MONONYM`, not null                                                     |
| 51000001797 | **ARBN** sharing the banned/licence ACN digits                  | `acnType=ARBN`; ACN-path joins must NOT attach (type guard)                                                      |
| 51000001814 | Minimal record: no names, no address                            | all-null tolerance                                                                                               |
| 51000001846 | Trading name only                                               | `tradingNames[]` populated, others empty                                                                         |

## Enrichment-source edge cases (the multi-source join seam)

These rows in the enrichment stub tables prove each cardinality joins correctly
and lands in the nullable nested objects of `expected-output.ndjson`.

| ABN         | Source                | Case                                                                                                        | What it guards                                                                        |
| ----------- | --------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 51000000761 | ASIC Company          | Company matched on ABN (active)                                                                             | `company{}` populated (1:1 via `DISTINCT ON`)                                         |
| 51000000793 | ASIC Company          | Public company match                                                                                        | `company{}` populated for a second entity type                                        |
| 51000001846 | ASIC Company          | Deregistered company (deregistrationDate set)                                                               | `company{}` carries the deregistration path                                           |
| 51000000761 | ASIC Business Names   | One registered business name (incl. a cancelled)                                                            | `registeredBusinessNames[]` (1:N agg) + cancellation date                             |
| 51000001571 | ASIC Business Names   | **Multiple** registered names for one ABN                                                                   | fan-out guard (1:N `json_agg`, ordered)                                               |
| 51000000810 | ACNC                  | Charity on a discretionary-trust ABN; **no AIS filed**                                                      | `charity{}` populated (1:0..1) with `financials: null`                                |
| 51000000923 | ACNC                  | Charity on a DGR-endorsed ABN                                                                               | `charity{}` co-exists with `dgr[]`                                                    |
| 51000000923 | ACNC AIS              | Charity **with** a filed AIS (revenue/expenses/assets, FTE 12.5, 45 volunteers)                             | `charity.financials{}` populated as JSON numbers, folded into `charity{}`             |
| 51000000761 | ASIC AFS Licensee     | AFS licence keyed by **ABN** (direct match)                                                                 | `financialServicesLicence{}` populated via the ABN path                               |
| 51000000987 | ASIC AFS Licensee     | AFS licence keyed by **ACN** `000000987` (abn NULL)                                                         | ACN-path fallback resolves to the ABN via `asic_number` (Bug-1 false-negative)        |
| 51000000793 | ASIC Credit Licensee  | Credit licence keyed by **ABN** (`APPR`)                                                                    | `creditLicence{}` populated via the ABN path; raw status code passed through          |
| 51000000987 | ASIC Credit Licensee  | Credit licence keyed by **ACN** `000000987` (abn NULL)                                                      | ACN-path fallback resolves to the ABN via `asic_number`                               |
| 51000000987 | ASIC Banned & Disq.   | **Two** banning actions, joined via **ACN** (`asic_number='000000987'`, `undetermined` type), one permanent | `bannedDisqualified[]` fan-out (1:N via ACN) + permanent-ban null `endDate`           |
| 51000001797 | AFS / Credit / Banned | **ARBN** with the SAME `000000987` digits but `asic_number_type=ARBN`                                       | all three ACN-path joins must skip it → null/null/`[]` (false-positive guard)         |
| 51000000761 | AusTender (govSpend)  | Supplier on **3** contracts, summed value `1500000.50` (fractional cents), 2018→2024                        | `govSpend{}` populated; `flags.hasGovContracts=true`; multi-contract sum + date range |
| 51000000793 | AusTender (govSpend)  | Supplier on **1** contract, whole-dollar value `250000.00`                                                  | `govSpend{}` single-contract; first==last date; `250000.00` → JSON number `250000`    |
| 51000000793 | ATO Tax Transparency  | ≥$100M entity with income + taxable + tax                                                                   | `taxTransparency{}` populated; `flags.isLargeCorporateTaxpayer=true`                  |
| 51000000761 | ATO Tax Transparency  | Income only; **taxable/tax null** (ATO reported ≤0)                                                         | nullable `taxableIncome`/`taxPayable` when ≤0                                         |
| 51000000761 | ATO R&D Incentive     | R&D claim keyed by **ABN**                                                                                  | `rdTaxIncentive{}` via ABN path; `flags.claimsRdTaxIncentive=true`                    |
| 51000000987 | ATO R&D Incentive     | R&D claim keyed by **ACN** `000000987` (undetermined type)                                                  | ACN-path resolves via `asic_number` (same two-path as AFS/credit)                     |
| 51000000761 | ASIC AFS Rep          | AFS authorised rep keyed by **ABN**                                                                         | `afsAuthorisedRep{}` via ABN path; `flags.isAfsAuthorisedRep=true`                    |
| 51000000987 | ASIC AFS Rep          | AFS authorised rep keyed by **ACN** `000000987` (undetermined type)                                         | ACN-path resolves via `asic_number` (two-path, like the licence sources)              |
| 51000000793 | ASIC Credit Rep       | Credit rep keyed by **ABN**                                                                                 | `creditRep{}` via ABN path; `flags.isCreditRep=true`                                  |

> **ACN-path matching uses `asic_number_type` to EXCLUDE, not require.** The real ABR
> extract sets `@ASICNumberType = 'undetermined'` on every ASIC number (it never
> emits ACN/ARBN/ARSN/ARFN), so the ACN-path joins match when the type is anything
> **other than** a known foreign/scheme type (`ARBN`/`ARSN`/`ARFN`) — i.e. `ACN`,
> `undetermined`, or null all match, while a typed `ARBN` is dropped. The matching
> entity (`51000000987`) is therefore seeded `undetermined` to mirror real data; the
> collision entity (`51000001797`) is seeded `ARBN` to prove the exclusion still
> fires. A guard that required `= 'ACN'` would pass this fixture only if the matcher
> were seeded `ACN` — yet would silently drop **every** real match (all
> `undetermined`), which is exactly the regression the 20.3M proof caught.
