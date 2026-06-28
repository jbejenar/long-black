-- abn-finalize.sql — post-load constraints + indexes.
--
-- Run AFTER the abn table is loaded (COPY in production, INSERT in fixtures).
-- The 20-file ABR extract carries each ABN once, so ADD PRIMARY KEY succeeds;
-- a future extract with duplicates must be deduped before this runs.
-- __SCHEMA_VERSION__ is substituted with the digits-only data version.

ALTER TABLE abn___SCHEMA_VERSION__.abn ADD PRIMARY KEY (abn);

CREATE INDEX IF NOT EXISTS asic_company_abn_idx
  ON abn___SCHEMA_VERSION__.asic_company (abn);
CREATE INDEX IF NOT EXISTS asic_business_name_abn_idx
  ON abn___SCHEMA_VERSION__.asic_business_name (abn);
CREATE INDEX IF NOT EXISTS acnc_charity_abn_idx
  ON abn___SCHEMA_VERSION__.acnc_charity (abn);
