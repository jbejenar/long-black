# Fixture edge cases — long-black

The fixture seeds ~20 representative ABNs into the single `abn` staging table
(`fixtures/seed-postgres.sql`). All ABNs are checksum-valid (mod-89). Each row
exercises a distinct edge case the flatten + schema + verify must handle.

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
