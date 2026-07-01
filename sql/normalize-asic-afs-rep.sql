-- normalize-asic-afs-rep.sql — raw_asic_afs_rep (all text) → typed.
--
-- ASIC's AFS Authorised Representative register: businesses authorised to distribute
-- financial products under an AFSL (`AFS_LIC_NUM`). It has SEPARATE `AFS_REP_ABN`
-- (11-digit) and `AFS_REP_ACN` (9-digit) columns; a row may carry one or both. We
-- route the 11-digit ABN to `abn` and the 9-digit ACN to `acn` (the flatten matches
-- `abn` directly and `acn` via abn.asic_number, ACN-type-guarded, like the licence
-- sources). Rows with neither can't join and are skipped. Dates are DD/MM/YYYY.

INSERT INTO abn___SCHEMA_VERSION__.asic_afs_rep (
  abn, acn, rep_number, licence_number, status, start_date, end_date
)
SELECT
  CASE WHEN regexp_replace(r."afs_rep_abn", '\D', '', 'g') ~ '^[0-9]{11}$'
       THEN regexp_replace(r."afs_rep_abn", '\D', '', 'g') END,
  CASE WHEN regexp_replace(r."afs_rep_acn", '\D', '', 'g') ~ '^[0-9]{9}$'
       THEN regexp_replace(r."afs_rep_acn", '\D', '', 'g') END,
  NULLIF(trim(r."afs_rep_num"), ''),
  NULLIF(trim(r."afs_lic_num"), ''),
  NULLIF(trim(r."afs_rep_status"), ''),
  CASE WHEN trim(r."afs_rep_start_dt") ~ '^\d{2}/\d{2}/\d{4}$'
       THEN to_date(trim(r."afs_rep_start_dt"), 'DD/MM/YYYY') END,
  CASE WHEN trim(r."afs_rep_end_dt") ~ '^\d{2}/\d{2}/\d{4}$'
       THEN to_date(trim(r."afs_rep_end_dt"), 'DD/MM/YYYY') END
FROM abn___SCHEMA_VERSION__.raw_asic_afs_rep r
WHERE regexp_replace(r."afs_rep_abn", '\D', '', 'g') ~ '^[0-9]{11}$'
   OR regexp_replace(r."afs_rep_acn", '\D', '', 'g') ~ '^[0-9]{9}$';

CREATE INDEX IF NOT EXISTS asic_afs_rep_abn_idx
  ON abn___SCHEMA_VERSION__.asic_afs_rep (abn);
CREATE INDEX IF NOT EXISTS asic_afs_rep_acn_idx
  ON abn___SCHEMA_VERSION__.asic_afs_rep (acn);
