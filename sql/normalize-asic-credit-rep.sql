-- normalize-asic-credit-rep.sql — raw_asic_credit_rep (all text) → typed.
--
-- ASIC's Credit Representative register: businesses authorised under a credit
-- licensee (`CRED_LIC_NUM`). The key column `CRED_REP_ABN_ACN` holds EITHER an
-- 11-digit ABN or a 9-digit ACN, routed to abn XOR acn (the flatten matches `abn`
-- directly and `acn` via abn.asic_number, ACN-type-guarded). Dates are DD/MM/YYYY.

INSERT INTO abn___SCHEMA_VERSION__.asic_credit_rep (
  abn, acn, rep_number, licence_number, start_date, end_date
)
SELECT
  CASE WHEN regexp_replace(r."cred_rep_abn_acn", '\D', '', 'g') ~ '^[0-9]{11}$'
       THEN regexp_replace(r."cred_rep_abn_acn", '\D', '', 'g') END,
  CASE WHEN regexp_replace(r."cred_rep_abn_acn", '\D', '', 'g') ~ '^[0-9]{9}$'
       THEN regexp_replace(r."cred_rep_abn_acn", '\D', '', 'g') END,
  NULLIF(trim(r."cred_rep_num"), ''),
  NULLIF(trim(r."cred_lic_num"), ''),
  CASE WHEN trim(r."cred_rep_start_dt") ~ '^\d{2}/\d{2}/\d{4}$'
       THEN to_date(trim(r."cred_rep_start_dt"), 'DD/MM/YYYY') END,
  CASE WHEN trim(r."cred_rep_end_dt") ~ '^\d{2}/\d{2}/\d{4}$'
       THEN to_date(trim(r."cred_rep_end_dt"), 'DD/MM/YYYY') END
FROM abn___SCHEMA_VERSION__.raw_asic_credit_rep r
WHERE regexp_replace(r."cred_rep_abn_acn", '\D', '', 'g') ~ '^([0-9]{11}|[0-9]{9})$';

CREATE INDEX IF NOT EXISTS asic_credit_rep_abn_idx
  ON abn___SCHEMA_VERSION__.asic_credit_rep (abn);
CREATE INDEX IF NOT EXISTS asic_credit_rep_acn_idx
  ON abn___SCHEMA_VERSION__.asic_credit_rep (acn);
