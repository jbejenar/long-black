-- normalize-asic-company.sql — raw_asic_company (all text) → typed asic_company.
--
-- The ASIC company register carries ONE ROW PER NAME a company has ever held;
-- the row flagged `Current Name Indicator = 'Y'` holds the current legal name
-- (its `Current Name` field is blank by construction). We load only the Y rows,
-- so `asic_company.company_name` is the current legal name and the 1:1 join to
-- the ABR base is clean. Rows without a valid 11-digit ABN (companies with no
-- ABN are bucketed under an empty ABN in the source) can't join and are skipped.
--
-- ASIC dates are DD/MM/YYYY; type/class/status are raw ASIC codes (e.g. APTY,
-- LMSH, REGD) passed through unchanged. __SCHEMA_VERSION__ is substituted at run
-- time with the digits-only data version. Column names are the sanitized header
-- labels produced by buildRawTableDdl (double-quoted: `type`/`class` are SQL
-- keywords).

INSERT INTO abn___SCHEMA_VERSION__.asic_company (
  abn, acn, company_name, current_name, type, class, sub_class, status,
  registration_date, deregistration_date, previous_state, state_registration_number,
  current_name_start_date
)
SELECT
  r."abn",
  NULLIF(trim(r."acn"), ''),
  NULLIF(trim(r."company_name"), ''),
  NULLIF(trim(r."current_name"), ''),
  NULLIF(trim(r."type"), ''),
  NULLIF(trim(r."class"), ''),
  NULLIF(trim(r."sub_class"), ''),
  -- Expand only the two universally-documented status codes (matching the
  -- fixture's readable form); any other code (EXAD/SOFF/NOAC/CNCL/…) passes
  -- through raw rather than risk an inexact description. type/class/sub_class
  -- stay raw ASIC codes by design.
  CASE upper(NULLIF(trim(r."status"), ''))
    WHEN 'REGD' THEN 'Registered'
    WHEN 'DRGD' THEN 'Deregistered'
    ELSE NULLIF(trim(r."status"), '')
  END,
  to_date(NULLIF(trim(r."date_of_registration"), ''), 'DD/MM/YYYY'),
  to_date(NULLIF(trim(r."date_of_deregistration"), ''), 'DD/MM/YYYY'),
  NULLIF(trim(r."previous_state_of_registration"), ''),
  NULLIF(trim(r."state_registration_number"), ''),
  to_date(NULLIF(trim(r."current_name_start_date"), ''), 'DD/MM/YYYY')
FROM abn___SCHEMA_VERSION__.raw_asic_company r
WHERE r."current_name_indicator" = 'Y'
  AND r."abn" ~ '^[0-9]{11}$'
  -- company.name and company.status are non-nullable in the contract; skip a
  -- malformed row missing either rather than emit a null that fails verify.
  AND NULLIF(trim(r."company_name"), '') IS NOT NULL
  AND NULLIF(trim(r."status"), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS asic_company_abn_idx
  ON abn___SCHEMA_VERSION__.asic_company (abn);
