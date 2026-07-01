-- normalize-wgea-reporter.sql — raw_wgea_reporter (all text) → typed.
--
-- WGEA's "List of Organisations by ABN": every employer (ABN) that reports to the
-- Workplace Gender Equality Agency — i.e. has 100+ employees and lodges a gender-
-- equality report. Columns: `Primary ABN, Primary Organisation, ABN, Company Name`.
-- The join key is the entity's own `ABN`; `Primary ABN`/`Primary Organisation` name
-- the submission group it reports under (self, when it submits alone). We keep the
-- group linkage and drop `Company Name` (the entity's name already comes from the ABR).

INSERT INTO abn___SCHEMA_VERSION__.wgea_reporter (abn, primary_abn, primary_organisation)
SELECT DISTINCT ON (regexp_replace(r."abn", '\D', '', 'g'))
  regexp_replace(r."abn", '\D', '', 'g'),
  CASE WHEN regexp_replace(r."primary_abn", '\D', '', 'g') ~ '^[0-9]{11}$'
       THEN regexp_replace(r."primary_abn", '\D', '', 'g') END,
  NULLIF(trim(r."primary_organisation"), '')
FROM abn___SCHEMA_VERSION__.raw_wgea_reporter r
WHERE regexp_replace(r."abn", '\D', '', 'g') ~ '^[0-9]{11}$'
ORDER BY regexp_replace(r."abn", '\D', '', 'g'), r."primary_organisation";

CREATE INDEX IF NOT EXISTS wgea_reporter_abn_idx
  ON abn___SCHEMA_VERSION__.wgea_reporter (abn);
