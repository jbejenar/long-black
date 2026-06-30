-- normalize-acnc-ais.sql — raw_acnc_ais (all text) → typed acnc_ais.
--
-- ACNC Annual Information Statement (the pinned AIS year — see ENRICHMENT_SOURCES).
-- One row per charity that filed, keyed on the 11-digit `abn`; rows without a valid
-- ABN can't join the ABR base and are skipped. The financial columns are
-- whole-dollar amounts in the source but stored `numeric` (some charities exceed
-- int4, and FTE staff is fractional, e.g. 153.4); `volunteers` is an integer count.
-- Each numeric cast is guarded by a regex so a non-numeric or blank cell becomes
-- NULL rather than aborting the load (the pinned 2024 extract is 100% numeric —
-- the 8,429 reporting-exempt Basic Religious Charities report 0 — but a future
-- year may leave exempt cells blank). Dates are DD/MM/YYYY. Per-ABN de-duplication
-- is handled by the flatten's `DISTINCT ON (abn)` (an amended filing is rare), so
-- this projection stays a straight INSERT … SELECT.

INSERT INTO abn___SCHEMA_VERSION__.acnc_ais (
  abn, reporting_period_start, reporting_period_end,
  total_revenue, total_expenses, total_assets, total_liabilities,
  staff_full_time_equivalent, volunteers
)
SELECT
  r."abn",
  CASE WHEN trim(r."fin_report_from") ~ '^\d{2}/\d{2}/\d{4}$'
       THEN to_date(trim(r."fin_report_from"), 'DD/MM/YYYY') END,
  CASE WHEN trim(r."fin_report_to") ~ '^\d{2}/\d{2}/\d{4}$'
       THEN to_date(trim(r."fin_report_to"), 'DD/MM/YYYY') END,
  CASE WHEN trim(r."total_revenue") ~ '^-?\d+(\.\d+)?$'
       THEN trim(r."total_revenue")::numeric END,
  CASE WHEN trim(r."total_expenses") ~ '^-?\d+(\.\d+)?$'
       THEN trim(r."total_expenses")::numeric END,
  CASE WHEN trim(r."total_assets") ~ '^-?\d+(\.\d+)?$'
       THEN trim(r."total_assets")::numeric END,
  CASE WHEN trim(r."total_liabilities") ~ '^-?\d+(\.\d+)?$'
       THEN trim(r."total_liabilities")::numeric END,
  CASE WHEN trim(r."total_full_time_equivalent_staff") ~ '^-?\d+(\.\d+)?$'
       THEN trim(r."total_full_time_equivalent_staff")::numeric END,
  CASE WHEN trim(r."staff_volunteers") ~ '^-?\d+$'
       THEN trim(r."staff_volunteers")::integer END
FROM abn___SCHEMA_VERSION__.raw_acnc_ais r
WHERE r."abn" ~ '^[0-9]{11}$';

CREATE INDEX IF NOT EXISTS acnc_ais_abn_idx
  ON abn___SCHEMA_VERSION__.acnc_ais (abn);
