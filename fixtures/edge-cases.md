# Fixture edge cases — long-black

The fixture (`fixtures/seed-postgres.sql`) seeds ~20 representative ABNs into the
`abn` staging table, plus example rows into the three enrichment stub tables
(`asic_company`, `asic_business_name`, `acnc_charity`) so the join seam is
exercised end-to-end (not just stubbed). All ABNs are checksum-valid (mod-89).
Each row exercises a distinct edge case the flatten + schema + verify must handle.

| ABN         | Case                                                    | What it guards                                               |
| ----------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| 51000000680 | Sole trader (IND), two given names, no GST              | individual name composition; `gstRegistered=false`           |
| 51000000761 | Private company (PRV), ACN, GST active, 1 business name | the common company shape                                     |
| 51000000793 | Public company (PUB)                                    | entity type variety                                          |
| 51000000810 | Discretionary trust (DTT), no GST                       | trust entity type; null ACN                                  |
| 51000000842 | Super fund (SMF), no ACN                                | super fund entity type                                       |
| 51000000874 | Government entity (GOV)                                 | government entity type                                       |
| 51000000923 | Single DGR endorsement                                  | `dgr[]` with one element                                     |
| 51000000955 | **Multiple** DGR endorsements                           | fan-out guard (1:N DGR)                                      |
| 51000000987 | GST cancelled (`status=CAN`)                            | `gstRegistered=false` despite a GST date                     |
| 51000001490 | GST never registered (null)                             | null GST                                                     |
| 51000001571 | Multiple business + trading + other names               | fan-out guard (1:N names)                                    |
| 51000001620 | Cancelled ABN (`abnStatus=CAN`)                         | cancelled-entity handling                                    |
| 51000001652 | **Empty-string** state and postcode                     | `'' → null` in the doc; `other` bucket on split              |
| 51000001684 | `AAT` (Antarctic) state                                 | the rare valid state code                                    |
| 51000001701 | ACN present, no GST                                     | ACN without GST                                              |
| 51000001733 | Names with `&`, apostrophe, unicode (`Ø`,`É`)           | escaping / UTF-8 round-trip                                  |
| 51000001765 | Individual with **only a family name**                  | the `concat_ws` fix — entityName must be `MONONYM`, not null |
| 51000001797 | **ARBN** (foreign company)                              | `acnType=ARBN`, not mislabelled `ACN`                        |
| 51000001814 | Minimal record: no names, no address                    | all-null tolerance                                           |
| 51000001846 | Trading name only                                       | `tradingNames[]` populated, others empty                     |

## Enrichment-source edge cases (the multi-source join seam)

These rows in the enrichment stub tables prove each cardinality joins correctly
and lands in the nullable nested objects of `expected-output.ndjson`.

| ABN         | Source              | Case                                             | What it guards                                            |
| ----------- | ------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| 51000000761 | ASIC Company        | Company matched on ABN (active)                  | `company{}` populated (1:1 via `DISTINCT ON`)             |
| 51000000793 | ASIC Company        | Public company match                             | `company{}` populated for a second entity type            |
| 51000001846 | ASIC Company        | Deregistered company (deregistrationDate set)    | `company{}` carries the deregistration path               |
| 51000000761 | ASIC Business Names | One registered business name (incl. a cancelled) | `registeredBusinessNames[]` (1:N agg) + cancellation date |
| 51000001571 | ASIC Business Names | **Multiple** registered names for one ABN        | fan-out guard (1:N `json_agg`, ordered)                   |
| 51000000810 | ACNC                | Charity on a discretionary-trust ABN             | `charity{}` populated (1:0..1 LEFT JOIN)                  |
| 51000000923 | ACNC                | Charity on a DGR-endorsed ABN                    | `charity{}` co-exists with `dgr[]`                        |
