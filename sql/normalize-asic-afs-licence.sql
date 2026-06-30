-- normalize-asic-afs-licence.sql — raw_asic_afs_licence (all text) → typed.
--
-- ASIC's Australian Financial Services Licensee register lists CURRENT AFSL
-- holders (the "- Current" CSV). `AFS_LIC_ABN_ACN` carries the licensee's
-- identifier — usually an 11-digit ABN, but a real fraction of rows carry the
-- 9-digit ACN instead (measured on 2026.06.24: ~6,300 ABN vs ~164 ACN rows). We
-- route each value to the matching column (`abn` XOR `acn`) after stripping any
-- separators, so the flatten can resolve ACN-keyed rows via abn.asic_number rather
-- than dropping them (which would falsely report null AFSL). Rows that are neither
-- a clean 11-digit ABN nor a 9-digit ACN can't join the ABR base and are skipped.
-- Dates are DD/MM/YYYY. Column names are the sanitized header labels produced by
-- buildRawTableDdl. Presence of a row = the entity holds a current AFS licence
-- (the source has no per-row status column).

INSERT INTO abn___SCHEMA_VERSION__.asic_afs_licence (
  abn, acn, licence_number, name, start_date, conditions
)
SELECT
  CASE WHEN regexp_replace(r."afs_lic_abn_acn", '\D', '', 'g') ~ '^[0-9]{11}$'
       THEN regexp_replace(r."afs_lic_abn_acn", '\D', '', 'g') END,
  CASE WHEN regexp_replace(r."afs_lic_abn_acn", '\D', '', 'g') ~ '^[0-9]{9}$'
       THEN regexp_replace(r."afs_lic_abn_acn", '\D', '', 'g') END,
  NULLIF(trim(r."afs_lic_num"), ''),
  NULLIF(trim(r."afs_lic_name"), ''),
  CASE WHEN trim(r."afs_lic_start_dt") ~ '^\d{2}/\d{2}/\d{4}$'
       THEN to_date(trim(r."afs_lic_start_dt"), 'DD/MM/YYYY') END,
  NULLIF(trim(r."afs_lic_condition"), '')
FROM abn___SCHEMA_VERSION__.raw_asic_afs_licence r
WHERE regexp_replace(r."afs_lic_abn_acn", '\D', '', 'g') ~ '^([0-9]{11}|[0-9]{9})$'
  -- licence_number is non-nullable in the contract; skip a malformed row.
  AND NULLIF(trim(r."afs_lic_num"), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS asic_afs_licence_abn_idx
  ON abn___SCHEMA_VERSION__.asic_afs_licence (abn);
CREATE INDEX IF NOT EXISTS asic_afs_licence_acn_idx
  ON abn___SCHEMA_VERSION__.asic_afs_licence (acn);
