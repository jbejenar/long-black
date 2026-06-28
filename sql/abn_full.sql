-- abn_full.sql — long-black flatten query. One JSON-ready row per ABN.
--
-- Phase 1: a single-table SELECT — no CTEs, no aggregation (ABR's owned names
-- and DGRs are already JSONB arrays on the row). A CTE arrives only when the
-- 1:N ASIC Business Names source lands (P3). __SCHEMA_VERSION__ is substituted
-- by crema's streamFlatten. Dates are cast to text (ISO) for byte-deterministic
-- output; record_last_updated (int YYYYMMDD) is converted in compose.ts.
--
-- entityName uses concat_ws, NOT `||`: `||` returns NULL if any operand is NULL,
-- so an individual with only a FamilyName would otherwise lose their name.
-- ORDER BY abn streams in PK-index order (PK exists by flatten time) — no sort.

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
  COALESCE(a.dgr,            '[]'::jsonb)              AS dgr
FROM abn___SCHEMA_VERSION__.abn a
ORDER BY a.abn;
