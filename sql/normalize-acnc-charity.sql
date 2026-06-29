-- normalize-acnc-charity.sql — raw_acnc_charity (datadotgov_main) → typed acnc_charity.
--
-- The ACNC main register lists CURRENTLY-REGISTERED charities and has no per-row
-- status column, so `status` is the constant 'Registered'. The register encodes
-- charitable purpose as ~14 boolean flag columns rather than a single subtype, so
-- `subtype` is projected to the single highest-priority registered subtype —
-- PBI/HPC first (the institutional subtypes), then the charitable purposes in
-- ACNC Act order — and NULL when none is flagged. (A charity can hold several
-- purposes; the per-purpose flags are preserved in the source if a richer
-- `purposes[]` field is ever added.) Rows without a valid 11-digit ABN are
-- skipped. Dates are DD/MM/YYYY. __SCHEMA_VERSION__ is substituted at run time.

INSERT INTO abn___SCHEMA_VERSION__.acnc_charity (
  abn, charity_name, status, size, subtype, registration_date
)
SELECT
  r."abn",
  NULLIF(trim(r."charity_legal_name"), ''),
  'Registered',
  NULLIF(trim(r."charity_size"), ''),
  CASE
    WHEN r."pbi" = 'Y' THEN 'Public Benevolent Institution'
    WHEN r."hpc" = 'Y' THEN 'Health Promotion Charity'
    WHEN r."advancing_health" = 'Y' THEN 'Advancing health'
    WHEN r."advancing_education" = 'Y' THEN 'Advancing education'
    WHEN r."advancing_social_or_public_welfare" = 'Y' THEN 'Advancing social or public welfare'
    WHEN r."advancing_religion" = 'Y' THEN 'Advancing religion'
    WHEN r."advancing_culture" = 'Y' THEN 'Advancing culture'
    WHEN r."promoting_reconciliation_mutual_respect_and_tolerance" = 'Y'
      THEN 'Promoting reconciliation, mutual respect and tolerance'
    WHEN r."promoting_or_protecting_human_rights" = 'Y' THEN 'Promoting or protecting human rights'
    WHEN r."advancing_security_or_safety_of_australia_or_australian_public" = 'Y'
      THEN 'Advancing the security or safety of Australia or the Australian public'
    WHEN r."preventing_or_relieving_suffering_of_animals" = 'Y'
      THEN 'Preventing or relieving the suffering of animals'
    WHEN r."advancing_natual_environment" = 'Y' THEN 'Advancing the natural environment'
    WHEN r."promote_or_oppose_a_change_to_law_government_poll_or_prac" = 'Y'
      THEN 'Promoting or opposing a change to law, government policy or practice'
    WHEN r."purposes_beneficial_to_ther_general_public_and_other_analogous" = 'Y'
      THEN 'Purposes beneficial to the general public and other analogous purposes'
    ELSE NULL
  END,
  to_date(NULLIF(trim(r."registration_date"), ''), 'DD/MM/YYYY')
FROM abn___SCHEMA_VERSION__.raw_acnc_charity r
WHERE r."abn" ~ '^[0-9]{11}$'
  -- charity.name is non-nullable; skip a nameless row rather than fail verify.
  AND NULLIF(trim(r."charity_legal_name"), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS acnc_charity_abn_idx
  ON abn___SCHEMA_VERSION__.acnc_charity (abn);
