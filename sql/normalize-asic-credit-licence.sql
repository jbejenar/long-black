-- normalize-asic-credit-licence.sql — raw_asic_credit_licence (all text) → typed.
--
-- ASIC's Credit Licensee register (the "- Current" CSV). `CRED_LIC_ABN_ACN` holds
-- the licensee's identifier — usually an 11-digit ABN, but a real fraction carry
-- the 9-digit ACN instead (measured on 2026.06.24: ~3,939 ABN vs ~357 ACN rows).
-- Each value is routed to `abn` XOR `acn` after stripping separators, so ACN-keyed
-- rows resolve via abn.asic_number rather than being dropped (which would falsely
-- report null creditLicence). Rows that are neither a clean 11-digit ABN nor a
-- 9-digit ACN are skipped. `CRED_LIC_STATUS` is a raw ASIC code (e.g. APPR) passed
-- through unchanged rather than risk an inexact expansion. Dates are DD/MM/YYYY.

INSERT INTO abn___SCHEMA_VERSION__.asic_credit_licence (
  abn, acn, licence_number, name, status, start_date, end_date
)
SELECT
  CASE WHEN regexp_replace(r."cred_lic_abn_acn", '\D', '', 'g') ~ '^[0-9]{11}$'
       THEN regexp_replace(r."cred_lic_abn_acn", '\D', '', 'g') END,
  CASE WHEN regexp_replace(r."cred_lic_abn_acn", '\D', '', 'g') ~ '^[0-9]{9}$'
       THEN regexp_replace(r."cred_lic_abn_acn", '\D', '', 'g') END,
  NULLIF(trim(r."cred_lic_num"), ''),
  NULLIF(trim(r."cred_lic_name"), ''),
  NULLIF(trim(r."cred_lic_status"), ''),
  CASE WHEN trim(r."cred_lic_start_dt") ~ '^\d{2}/\d{2}/\d{4}$'
       THEN to_date(trim(r."cred_lic_start_dt"), 'DD/MM/YYYY') END,
  CASE WHEN trim(r."cred_lic_end_dt") ~ '^\d{2}/\d{2}/\d{4}$'
       THEN to_date(trim(r."cred_lic_end_dt"), 'DD/MM/YYYY') END
FROM abn___SCHEMA_VERSION__.raw_asic_credit_licence r
WHERE regexp_replace(r."cred_lic_abn_acn", '\D', '', 'g') ~ '^([0-9]{11}|[0-9]{9})$'
  AND NULLIF(trim(r."cred_lic_num"), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS asic_credit_licence_abn_idx
  ON abn___SCHEMA_VERSION__.asic_credit_licence (abn);
CREATE INDEX IF NOT EXISTS asic_credit_licence_acn_idx
  ON abn___SCHEMA_VERSION__.asic_credit_licence (acn);
