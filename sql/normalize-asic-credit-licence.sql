-- normalize-asic-credit-licence.sql — raw_asic_credit_licence (all text) → typed.
--
-- ASIC's Credit Licensee register (the "- Current" CSV). `CRED_LIC_ABN_ACN`
-- carries an 11-digit ABN when the licensee has one; rows without a valid ABN are
-- skipped. `CRED_LIC_STATUS` is a raw ASIC code (e.g. APPR) passed through
-- unchanged rather than risk an inexact expansion. Dates are DD/MM/YYYY.

INSERT INTO abn___SCHEMA_VERSION__.asic_credit_licence (
  abn, licence_number, name, status, start_date, end_date
)
SELECT
  r."cred_lic_abn_acn",
  NULLIF(trim(r."cred_lic_num"), ''),
  NULLIF(trim(r."cred_lic_name"), ''),
  NULLIF(trim(r."cred_lic_status"), ''),
  CASE WHEN trim(r."cred_lic_start_dt") ~ '^\d{2}/\d{2}/\d{4}$'
       THEN to_date(trim(r."cred_lic_start_dt"), 'DD/MM/YYYY') END,
  CASE WHEN trim(r."cred_lic_end_dt") ~ '^\d{2}/\d{2}/\d{4}$'
       THEN to_date(trim(r."cred_lic_end_dt"), 'DD/MM/YYYY') END
FROM abn___SCHEMA_VERSION__.raw_asic_credit_licence r
WHERE r."cred_lic_abn_acn" ~ '^[0-9]{11}$'
  AND NULLIF(trim(r."cred_lic_num"), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS asic_credit_licence_abn_idx
  ON abn___SCHEMA_VERSION__.asic_credit_licence (abn);
