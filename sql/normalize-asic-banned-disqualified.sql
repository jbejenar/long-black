-- normalize-asic-banned-disqualified.sql — raw → typed asic_banned_disqualified.
--
-- ASIC's Banned and Disqualified Organisations register. Unlike the other ASIC
-- sources it is keyed on 9-digit ACN (`BD_ORG_ACN`), NOT ABN — so it joins the
-- ABR base via abn.asic_number (also a 9-char ACN), not via ABN. One row per
-- banning/disqualification action (0..N per org). The data CSV is tab-delimited
-- despite the .csv extension (loaded with quoting off). Dates are DD/MM/YYYY.
-- The ACN is reduced to its 9 digits so it matches asic_number's stored form.

INSERT INTO abn___SCHEMA_VERSION__.asic_banned_disqualified (
  acn, name, type, start_date, end_date, comment
)
SELECT
  regexp_replace(r."bd_org_acn", '\D', '', 'g'),
  NULLIF(trim(r."bd_org_name"), ''),
  NULLIF(trim(r."bd_org_type"), ''),
  -- Guarded parse: BD_ORG_END_DT carries non-dates for permanent bannings (e.g.
  -- "Permanent banning") → null end date. Apply the same guard to start for safety.
  CASE WHEN trim(r."bd_org_start_dt") ~ '^\d{2}/\d{2}/\d{4}$'
       THEN to_date(trim(r."bd_org_start_dt"), 'DD/MM/YYYY') END,
  CASE WHEN trim(r."bd_org_end_dt") ~ '^\d{2}/\d{2}/\d{4}$'
       THEN to_date(trim(r."bd_org_end_dt"), 'DD/MM/YYYY') END,
  NULLIF(trim(r."bd_org_comment"), '')
FROM abn___SCHEMA_VERSION__.raw_asic_banned_disqualified r
-- Only rows whose ACN is exactly 9 digits can join an ABR asic_number.
WHERE regexp_replace(r."bd_org_acn", '\D', '', 'g') ~ '^[0-9]{9}$';

CREATE INDEX IF NOT EXISTS asic_banned_disqualified_acn_idx
  ON abn___SCHEMA_VERSION__.asic_banned_disqualified (acn);
