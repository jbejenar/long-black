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
  ORDER BY abn, current_name_start_date DESC NULLS LAST
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
  ) END                                                AS company
FROM abn___SCHEMA_VERSION__.abn a
LEFT JOIN company c ON c.abn = a.abn
LEFT JOIN business_names_agg bn ON bn.abn = a.abn
ORDER BY a.abn;
