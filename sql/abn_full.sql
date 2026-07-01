-- abn_full.sql — long-black flatten query. One JSON-ready row per ABN.
--
-- ABR's owned names and DGRs are already JSONB arrays on the row, so the core
-- is a single-table SELECT. Enrichment SOURCES join in: ASIC Company (1:1,
-- guarded by DISTINCT ON) is exposed as a nullable nested `company` object.
-- __SCHEMA_VERSION__ is substituted by crema's streamFlatten. Dates are cast to
-- text (ISO) for byte-deterministic output; record_last_updated (int YYYYMMDD)
-- is converted in compose.ts.
--
-- entityName uses concat_ws, NOT `||`: `||` returns NULL if any operand is NULL,
-- so an individual with only a FamilyName would otherwise lose their name.
-- ORDER BY abn streams in PK-index order (PK exists by flatten time) — no sort.

WITH company AS (
  SELECT DISTINCT ON (abn)
    abn, acn, company_name, current_name, type, class, sub_class, status,
    registration_date, deregistration_date, previous_state, state_registration_number
  FROM abn___SCHEMA_VERSION__.asic_company
  -- company_name breaks ties so the pick is deterministic if a duplicate ABN
  -- ever slips through (the normalize loads one current-name row per ABN).
  ORDER BY abn, current_name_start_date DESC NULLS LAST, company_name
),
-- 1:N — aggregate ASIC registered business names per ABN (never direct-join).
business_names_agg AS (
  SELECT abn, json_agg(json_build_object(
    'name', business_name,
    'status', status,
    'registrationDate', registration_date::text,
    'cancellationDate', cancellation_date::text
  ) ORDER BY business_name, registration_date) AS names
  FROM abn___SCHEMA_VERSION__.asic_business_name
  GROUP BY abn
),
-- 1:0..1 — DISTINCT ON guards against a duplicate-ABN fan-out (one charity per
-- ABN expected, but never let the join multiply base rows → no duplicate _id).
charity AS (
  SELECT DISTINCT ON (abn)
    abn, charity_name, status, size, subtype, registration_date
  FROM abn___SCHEMA_VERSION__.acnc_charity
  ORDER BY abn, registration_date DESC NULLS LAST, charity_name
),
-- 1:0..1 — the charity's most recent Annual Information Statement (financials),
-- folded into the charity{} object. DISTINCT ON keeps the latest period if a
-- charity ever has more than one filing in the snapshot (an amendment).
ais AS (
  SELECT DISTINCT ON (abn)
    abn, reporting_period_start, reporting_period_end, total_revenue, total_expenses,
    total_assets, total_liabilities, staff_full_time_equivalent, volunteers
  FROM abn___SCHEMA_VERSION__.acnc_ais
  ORDER BY abn, reporting_period_end DESC NULLS LAST
),
-- 1:0..1 — AusTender government-contract spend, already aggregated per ABN by
-- src/gov-spend.ts (DISTINCT ON is a defensive guard against a duplicate ABN row).
gov_spend AS (
  SELECT DISTINCT ON (abn)
    abn, total_value_aud, contract_count, first_contract_date, last_contract_date
  FROM abn___SCHEMA_VERSION__.gov_spend
  ORDER BY abn, total_value_aud DESC NULLS LAST
),
-- 1:0..1 — ATO Corporate Tax Transparency (ABN-only). DISTINCT ON keeps the latest
-- income year if the loaded report ever carried more than one per ABN.
tax_transparency AS (
  SELECT DISTINCT ON (abn)
    abn, income_year, total_income, taxable_income, tax_payable
  FROM abn___SCHEMA_VERSION__.tax_transparency
  ORDER BY abn, income_year DESC NULLS LAST
),
-- 1:0..1 — ATO R&D Tax Incentive, ABN-or-ACN keyed (same two-path, ACN-type-guarded
-- resolution as the ASIC AFS/credit sources).
rd_by_abn AS (
  SELECT DISTINCT ON (abn) abn, income_year, total_rd_expenditure
  FROM abn___SCHEMA_VERSION__.rd_tax_incentive
  WHERE abn IS NOT NULL
  ORDER BY abn, income_year DESC NULLS LAST
),
rd_by_acn AS (
  SELECT DISTINCT ON (acn) acn, income_year, total_rd_expenditure
  FROM abn___SCHEMA_VERSION__.rd_tax_incentive
  WHERE acn IS NOT NULL
  ORDER BY acn, income_year DESC NULLS LAST
),
-- 1:0..1 — ASIC AFS + credit authorised representatives (Bundle B). Same ABN-or-ACN
-- two-path resolution as the licence sources; DISTINCT ON keeps the latest rep
-- record per key (most recent start date).
afs_rep_by_abn AS (
  SELECT DISTINCT ON (abn) abn, rep_number, licence_number, status, start_date, end_date
  FROM abn___SCHEMA_VERSION__.asic_afs_rep WHERE abn IS NOT NULL
  ORDER BY abn, start_date DESC NULLS LAST, rep_number
),
afs_rep_by_acn AS (
  SELECT DISTINCT ON (acn) acn, rep_number, licence_number, status, start_date, end_date
  FROM abn___SCHEMA_VERSION__.asic_afs_rep WHERE acn IS NOT NULL
  ORDER BY acn, start_date DESC NULLS LAST, rep_number
),
credit_rep_by_abn AS (
  SELECT DISTINCT ON (abn) abn, rep_number, licence_number, start_date, end_date
  FROM abn___SCHEMA_VERSION__.asic_credit_rep WHERE abn IS NOT NULL
  ORDER BY abn, start_date DESC NULLS LAST, rep_number
),
credit_rep_by_acn AS (
  SELECT DISTINCT ON (acn) acn, rep_number, licence_number, start_date, end_date
  FROM abn___SCHEMA_VERSION__.asic_credit_rep WHERE acn IS NOT NULL
  ORDER BY acn, start_date DESC NULLS LAST, rep_number
),
-- 1:0..1 — WGEA reporting organisations (Bundle C), keyed directly on ABN.
wgea AS (
  SELECT DISTINCT ON (abn) abn, primary_abn, primary_organisation
  FROM abn___SCHEMA_VERSION__.wgea_reporter
  ORDER BY abn, primary_organisation
),
-- 1:0..1 — ASIC SMSF auditors (Bundle D), keyed on the auditor's ABN.
smsf AS (
  SELECT DISTINCT ON (abn)
    abn, auditor_number, status, registration_date, suspension_start_date, suspension_end_date
  FROM abn___SCHEMA_VERSION__.asic_smsf_auditor
  ORDER BY abn, registration_date
),
-- 1:0..1 — ASIC AFS + credit licences. The source `*_ABN_ACN` column holds EITHER
-- an 11-digit ABN or a 9-digit ACN (the normalizer routes each to the abn/acn
-- column). So each licence resolves to a base row by TWO paths: a direct ABN match,
-- or an ACN match against a.asic_number. The ACN match EXCLUDES asic_numbers we KNOW
-- are non-ACN (ARBN/ARSN/ARFN), guarding against a 9-digit collision attaching the
-- wrong entity. NB: the real ABR extract leaves @ASICNumberType = 'undetermined' on
-- every ASIC number (see DATA-SOURCES.md), so an exact `= 'ACN'` would match nothing;
-- the exclusion form matches ACN + undetermined while still dropping a typed ARBN.
-- Kept as four small DISTINCT ON CTEs (one per key per source) so each is a hash join
-- from the base; the SELECT prefers the whole ABN-path object, else the ACN-path one.
afs_by_abn AS (
  SELECT DISTINCT ON (abn)
    abn, licence_number, name, start_date, conditions
  FROM abn___SCHEMA_VERSION__.asic_afs_licence
  WHERE abn IS NOT NULL
  ORDER BY abn, start_date DESC NULLS LAST, licence_number
),
afs_by_acn AS (
  SELECT DISTINCT ON (acn)
    acn, licence_number, name, start_date, conditions
  FROM abn___SCHEMA_VERSION__.asic_afs_licence
  WHERE acn IS NOT NULL
  ORDER BY acn, start_date DESC NULLS LAST, licence_number
),
credit_by_abn AS (
  SELECT DISTINCT ON (abn)
    abn, licence_number, name, status, start_date, end_date
  FROM abn___SCHEMA_VERSION__.asic_credit_licence
  WHERE abn IS NOT NULL
  ORDER BY abn, start_date DESC NULLS LAST, licence_number
),
credit_by_acn AS (
  SELECT DISTINCT ON (acn)
    acn, licence_number, name, status, start_date, end_date
  FROM abn___SCHEMA_VERSION__.asic_credit_licence
  WHERE acn IS NOT NULL
  ORDER BY acn, start_date DESC NULLS LAST, licence_number
),
-- 0..N banning/disqualification actions, keyed on 9-digit ACN → joined via
-- a.asic_number, excluding asic_numbers typed ARBN/ARSN/ARFN (see join; real data
-- is 'undetermined'). Aggregate per ACN so the join never fans out base rows.
banned_agg AS (
  SELECT acn, json_agg(json_build_object(
    'type', type,
    'startDate', start_date::text,
    'endDate', end_date::text,
    'comment', comment
  ) ORDER BY start_date, type) AS items
  FROM abn___SCHEMA_VERSION__.asic_banned_disqualified
  GROUP BY acn
)
SELECT
  a.abn                                                AS _id,
  a.abn_status                                         AS abn_status,
  a.abn_status_from_date::text                         AS abn_status_from_date,
  a.entity_type_code                                   AS entity_type_code,
  a.entity_type_text                                   AS entity_type_text,
  COALESCE(
    a.entity_name,
    NULLIF(trim(concat_ws(' ', a.given_names, a.family_name)), '')
  )                                                    AS entity_name,
  a.given_names                                        AS given_names,
  a.family_name                                        AS family_name,
  a.asic_number                                        AS acn,
  a.asic_number_type                                   AS acn_type,
  (a.gst_status = 'ACT')                               AS gst_registered,
  a.gst_status_from_date::text                         AS gst_status_from_date,
  a.record_last_updated                                AS record_last_updated,
  a.address_state                                      AS state,
  a.address_postcode                                   AS postcode,
  COALESCE(a.business_names, '[]'::jsonb)              AS business_names,
  COALESCE(a.trading_names,  '[]'::jsonb)              AS trading_names,
  COALESCE(a.other_names,    '[]'::jsonb)              AS other_names,
  COALESCE(a.dgr,            '[]'::jsonb)              AS dgr,
  COALESCE(bn.names,         '[]'::json)              AS registered_business_names,
  CASE WHEN c.abn IS NULL THEN NULL ELSE json_build_object(
    'acn', c.acn,
    'name', c.company_name,
    'currentName', c.current_name,
    'type', c.type,
    'class', c.class,
    'subClass', c.sub_class,
    'status', c.status,
    'registrationDate', c.registration_date::text,
    'deregistrationDate', c.deregistration_date::text,
    'previousState', c.previous_state,
    'stateRegistrationNumber', c.state_registration_number
  ) END                                                AS company,
  CASE WHEN ch.abn IS NULL THEN NULL ELSE json_build_object(
    'name', ch.charity_name,
    'status', ch.status,
    'size', ch.size,
    'subtype', ch.subtype,
    'registrationDate', ch.registration_date::text,
    'financials', CASE WHEN ais.abn IS NULL THEN NULL ELSE json_build_object(
      'reportingPeriodStart', ais.reporting_period_start::text,
      'reportingPeriodEnd', ais.reporting_period_end::text,
      'totalRevenue', ais.total_revenue,
      'totalExpenses', ais.total_expenses,
      'totalAssets', ais.total_assets,
      'totalLiabilities', ais.total_liabilities,
      'staffFullTimeEquivalent', ais.staff_full_time_equivalent,
      'volunteers', ais.volunteers
    ) END
  ) END                                                AS charity,
  -- Prefer the direct ABN-path licence; fall back to the ACN-path match. Take the
  -- whole object from one source (never field-mix the two).
  CASE
    WHEN afsa.abn IS NOT NULL THEN json_build_object(
      'number', afsa.licence_number,
      'name', afsa.name,
      'startDate', afsa.start_date::text,
      'conditions', afsa.conditions)
    WHEN afsc.acn IS NOT NULL THEN json_build_object(
      'number', afsc.licence_number,
      'name', afsc.name,
      'startDate', afsc.start_date::text,
      'conditions', afsc.conditions)
    ELSE NULL
  END                                                  AS financial_services_licence,
  CASE
    WHEN cra.abn IS NOT NULL THEN json_build_object(
      'number', cra.licence_number,
      'name', cra.name,
      'status', cra.status,
      'startDate', cra.start_date::text,
      'endDate', cra.end_date::text)
    WHEN crc.acn IS NOT NULL THEN json_build_object(
      'number', crc.licence_number,
      'name', crc.name,
      'status', crc.status,
      'startDate', crc.start_date::text,
      'endDate', crc.end_date::text)
    ELSE NULL
  END                                                  AS credit_licence,
  COALESCE(bd.items, '[]'::json)                       AS banned_disqualified,
  CASE WHEN gs.abn IS NULL THEN NULL ELSE json_build_object(
    'totalValueAud', gs.total_value_aud,
    'contractCount', gs.contract_count,
    'firstContractDate', gs.first_contract_date::text,
    'lastContractDate', gs.last_contract_date::text
  ) END                                                AS gov_spend,
  CASE WHEN tt.abn IS NULL THEN NULL ELSE json_build_object(
    'incomeYear', tt.income_year,
    'totalIncome', tt.total_income,
    'taxableIncome', tt.taxable_income,
    'taxPayable', tt.tax_payable
  ) END                                                AS tax_transparency,
  CASE
    WHEN rda.abn IS NOT NULL THEN json_build_object(
      'incomeYear', rda.income_year, 'totalRdExpenditure', rda.total_rd_expenditure)
    WHEN rdc.acn IS NOT NULL THEN json_build_object(
      'incomeYear', rdc.income_year, 'totalRdExpenditure', rdc.total_rd_expenditure)
    ELSE NULL
  END                                                  AS rd_tax_incentive,
  CASE
    WHEN afra.abn IS NOT NULL THEN json_build_object(
      'number', afra.rep_number, 'licenceNumber', afra.licence_number,
      'status', afra.status, 'startDate', afra.start_date::text, 'endDate', afra.end_date::text)
    WHEN afrc.acn IS NOT NULL THEN json_build_object(
      'number', afrc.rep_number, 'licenceNumber', afrc.licence_number,
      'status', afrc.status, 'startDate', afrc.start_date::text, 'endDate', afrc.end_date::text)
    ELSE NULL
  END                                                  AS afs_authorised_rep,
  CASE
    WHEN crra.abn IS NOT NULL THEN json_build_object(
      'number', crra.rep_number, 'licenceNumber', crra.licence_number,
      'startDate', crra.start_date::text, 'endDate', crra.end_date::text)
    WHEN crrc.acn IS NOT NULL THEN json_build_object(
      'number', crrc.rep_number, 'licenceNumber', crrc.licence_number,
      'startDate', crrc.start_date::text, 'endDate', crrc.end_date::text)
    ELSE NULL
  END                                                  AS credit_rep,
  CASE WHEN w.abn IS NULL THEN NULL ELSE json_build_object(
    'primaryAbn', w.primary_abn,
    'primaryOrganisation', w.primary_organisation
  ) END                                                AS wgea_reporter,
  CASE WHEN sm.abn IS NULL THEN NULL ELSE json_build_object(
    'number', sm.auditor_number,
    'status', sm.status,
    'registrationDate', sm.registration_date::text,
    'suspensionStartDate', sm.suspension_start_date::text,
    'suspensionEndDate', sm.suspension_end_date::text
  ) END                                                AS smsf_auditor
FROM abn___SCHEMA_VERSION__.abn a
LEFT JOIN company c ON c.abn = a.abn
LEFT JOIN business_names_agg bn ON bn.abn = a.abn
LEFT JOIN charity ch ON ch.abn = a.abn
LEFT JOIN ais ON ais.abn = a.abn
LEFT JOIN gov_spend gs ON gs.abn = a.abn
LEFT JOIN tax_transparency tt ON tt.abn = a.abn
LEFT JOIN rd_by_abn rda ON rda.abn = a.abn
LEFT JOIN rd_by_acn rdc
  ON rdc.acn = a.asic_number AND COALESCE(a.asic_number_type, '') NOT IN ('ARBN', 'ARSN', 'ARFN')
LEFT JOIN afs_rep_by_abn afra ON afra.abn = a.abn
LEFT JOIN afs_rep_by_acn afrc
  ON afrc.acn = a.asic_number AND COALESCE(a.asic_number_type, '') NOT IN ('ARBN', 'ARSN', 'ARFN')
LEFT JOIN credit_rep_by_abn crra ON crra.abn = a.abn
LEFT JOIN credit_rep_by_acn crrc
  ON crrc.acn = a.asic_number AND COALESCE(a.asic_number_type, '') NOT IN ('ARBN', 'ARSN', 'ARFN')
LEFT JOIN wgea w ON w.abn = a.abn
LEFT JOIN smsf sm ON sm.abn = a.abn
LEFT JOIN afs_by_abn afsa ON afsa.abn = a.abn
LEFT JOIN afs_by_acn afsc
  ON afsc.acn = a.asic_number AND COALESCE(a.asic_number_type, '') NOT IN ('ARBN', 'ARSN', 'ARFN')
LEFT JOIN credit_by_abn cra ON cra.abn = a.abn
LEFT JOIN credit_by_acn crc
  ON crc.acn = a.asic_number AND COALESCE(a.asic_number_type, '') NOT IN ('ARBN', 'ARSN', 'ARFN')
LEFT JOIN banned_agg bd
  ON bd.acn = a.asic_number AND COALESCE(a.asic_number_type, '') NOT IN ('ARBN', 'ARSN', 'ARFN')
ORDER BY a.abn;
