-- normalize-asic-business-name.sql — raw_asic_business_name → typed asic_business_name.
--
-- 1:N — a holder ABN (`BN_ABN`) can hold many registered business names; the
-- flatten aggregates them per ABN (json_agg in abn_full.sql). Rows without a
-- valid 11-digit holder ABN are skipped. Names are space-padded in the source
-- (a fixed-width export artifact) → trimmed. Dates are DD/MM/YYYY.
--
-- `bn_number` ← BN_STATE_NUM (the state registration number), `state` ←
-- BN_STATE_OF_REG. REGISTER_NAME (always "BUSINESS NAMES") is not carried.
-- __SCHEMA_VERSION__ is substituted at run time.

INSERT INTO abn___SCHEMA_VERSION__.asic_business_name (
  abn, business_name, status, registration_date, cancellation_date, bn_number, state
)
SELECT
  r."bn_abn",
  NULLIF(trim(r."bn_name"), ''),
  NULLIF(trim(r."bn_status"), ''),
  to_date(NULLIF(trim(r."bn_reg_dt"), ''), 'DD/MM/YYYY'),
  to_date(NULLIF(trim(r."bn_cancel_dt"), ''), 'DD/MM/YYYY'),
  NULLIF(trim(r."bn_state_num"), ''),
  NULLIF(trim(r."bn_state_of_reg"), '')
FROM abn___SCHEMA_VERSION__.raw_asic_business_name r
WHERE r."bn_abn" ~ '^[0-9]{11}$'
  -- registeredBusinessNames[].name is non-nullable; skip a nameless row so the
  -- aggregated array never carries a null name (which would fail verify).
  AND NULLIF(trim(r."bn_name"), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS asic_business_name_abn_idx
  ON abn___SCHEMA_VERSION__.asic_business_name (abn);
