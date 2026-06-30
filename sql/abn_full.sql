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
-- 1:0..1 — ASIC AFS + credit licences. The source `*_ABN_ACN` column holds EITHER
-- an 11-digit ABN or a 9-digit ACN (the normalizer routes each to the abn/acn
-- column). So each licence resolves to a base row by TWO paths: a direct ABN match,
-- or an ACN match against a.asic_number — but only when that number is an actual ACN
-- (asic_number can also be ARBN/ARSN/ARFN; matching those would be a false positive).
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
-- a.asic_number (only when asic_number_type = 'ACN'; see join). Aggregate per ACN
-- so the join never fans out base rows.
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
    'registrationDate', ch.registration_date::text
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
  COALESCE(bd.items, '[]'::json)                       AS banned_disqualified
FROM abn___SCHEMA_VERSION__.abn a
LEFT JOIN company c ON c.abn = a.abn
LEFT JOIN business_names_agg bn ON bn.abn = a.abn
LEFT JOIN charity ch ON ch.abn = a.abn
LEFT JOIN afs_by_abn afsa ON afsa.abn = a.abn
LEFT JOIN afs_by_acn afsc ON afsc.acn = a.asic_number AND a.asic_number_type = 'ACN'
LEFT JOIN credit_by_abn cra ON cra.abn = a.abn
LEFT JOIN credit_by_acn crc ON crc.acn = a.asic_number AND a.asic_number_type = 'ACN'
LEFT JOIN banned_agg bd ON bd.acn = a.asic_number AND a.asic_number_type = 'ACN'
ORDER BY a.abn;
