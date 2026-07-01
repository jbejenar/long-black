-- normalize-asic-smsf-auditor.sql — raw_asic_smsf_auditor (all text) → typed.
--
-- ASIC's register of approved SMSF (self-managed super fund) auditors — a regulated
-- financial profession. The file lists auditor×condition rows, so an auditor with
-- several conditions appears multiple times; the auditor-level fields (number, status,
-- registration/suspension dates) are identical across those rows, so we DISTINCT ON
-- the ABN to keep one record per auditor. Keyed on `SMSF_PERSON_ABN`, present on the
-- auditors who operate under an ABN (most are sole traders). Dates are DD/MM/YYYY.

INSERT INTO abn___SCHEMA_VERSION__.asic_smsf_auditor (
  abn, auditor_number, status, registration_date, suspension_start_date, suspension_end_date
)
SELECT DISTINCT ON (regexp_replace(r."smsf_person_abn", '\D', '', 'g'))
  regexp_replace(r."smsf_person_abn", '\D', '', 'g'),
  NULLIF(trim(r."smsf_num"), ''),
  NULLIF(trim(r."smsf_status"), ''),
  CASE WHEN trim(r."smsf_reg_dt") ~ '^\d{2}/\d{2}/\d{4}$'
       THEN to_date(trim(r."smsf_reg_dt"), 'DD/MM/YYYY') END,
  CASE WHEN trim(r."smsf_susp_start_dt") ~ '^\d{2}/\d{2}/\d{4}$'
       THEN to_date(trim(r."smsf_susp_start_dt"), 'DD/MM/YYYY') END,
  CASE WHEN trim(r."smsf_susp_end_dt") ~ '^\d{2}/\d{2}/\d{4}$'
       THEN to_date(trim(r."smsf_susp_end_dt"), 'DD/MM/YYYY') END
FROM abn___SCHEMA_VERSION__.raw_asic_smsf_auditor r
WHERE regexp_replace(r."smsf_person_abn", '\D', '', 'g') ~ '^[0-9]{11}$'
ORDER BY regexp_replace(r."smsf_person_abn", '\D', '', 'g'), r."smsf_reg_dt";

CREATE INDEX IF NOT EXISTS asic_smsf_auditor_abn_idx
  ON abn___SCHEMA_VERSION__.asic_smsf_auditor (abn);
