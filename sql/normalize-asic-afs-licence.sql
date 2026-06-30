-- normalize-asic-afs-licence.sql — raw_asic_afs_licence (all text) → typed.
--
-- ASIC's Australian Financial Services Licensee register lists CURRENT AFSL
-- holders (the "- Current" CSV). `AFS_LIC_ABN_ACN` carries an 11-digit ABN when
-- the licensee has one; rows without a valid 11-digit ABN can't join the ABR
-- base and are skipped. Dates are DD/MM/YYYY. Column names are the sanitized
-- header labels produced by buildRawTableDdl. Presence of a row = the ABN holds
-- a current AFS licence (the source has no per-row status column).

INSERT INTO abn___SCHEMA_VERSION__.asic_afs_licence (
  abn, licence_number, name, start_date, conditions
)
SELECT
  r."afs_lic_abn_acn",
  NULLIF(trim(r."afs_lic_num"), ''),
  NULLIF(trim(r."afs_lic_name"), ''),
  CASE WHEN trim(r."afs_lic_start_dt") ~ '^\d{2}/\d{2}/\d{4}$'
       THEN to_date(trim(r."afs_lic_start_dt"), 'DD/MM/YYYY') END,
  NULLIF(trim(r."afs_lic_condition"), '')
FROM abn___SCHEMA_VERSION__.raw_asic_afs_licence r
WHERE r."afs_lic_abn_acn" ~ '^[0-9]{11}$'
  -- licence_number is non-nullable in the contract; skip a malformed row.
  AND NULLIF(trim(r."afs_lic_num"), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS asic_afs_licence_abn_idx
  ON abn___SCHEMA_VERSION__.asic_afs_licence (abn);
