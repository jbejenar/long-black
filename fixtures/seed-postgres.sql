-- seed-postgres.sql — long-black fixture rows (~20 representative ABNs).
--
-- Hand-authored STAGING rows (not XML): the schema + tables are created first by
-- sql/staging-schema.sql, then these INSERTs run, then sql/abn-finalize.sql adds
-- the PK. __SCHEMA_VERSION__ is substituted with the digits-only data version.
-- All ABNs are checksum-valid (mod-89). Catalogue: fixtures/edge-cases.md.

INSERT INTO abn___SCHEMA_VERSION__.abn (
  abn, abn_status, abn_status_from_date, entity_type_code, entity_type_text,
  entity_name, given_names, family_name, asic_number, asic_number_type,
  gst_status, gst_status_from_date, address_state, address_postcode,
  business_names, trading_names, other_names, dgr, record_last_updated
) VALUES
-- 1. Sole trader (IND), two given names, no GST
('51000000680','ACT',DATE '1999-03-01','IND','Individual/Sole Trader',
 NULL,'JOHN PETER','SMITH',NULL,NULL,NULL,NULL,'NSW','2000',
 NULL,NULL,NULL,NULL,20260601),
-- 2. Private company (PRV), ACN, GST active, one business name
('51000000761','ACT',DATE '2001-06-15','PRV','Australian Private Company',
 'ACME PRIVATE PTY LTD',NULL,NULL,'000000761','ACN','ACT',DATE '2001-07-01','VIC','3000',
 '["ACME"]'::jsonb,NULL,NULL,NULL,20260515),
-- 3. Public company (PUB)
('51000000793','ACT',DATE '1995-01-01','PUB','Australian Public Company',
 'BIGCORP LIMITED',NULL,NULL,'000000793','ACN','ACT',DATE '2000-07-01','QLD','4000',
 NULL,NULL,NULL,NULL,20260520),
-- 4. Discretionary trust (DTT), no GST
('51000000810','ACT',DATE '2010-04-01','DTT','Discretionary Trading Trust',
 'THE SMITH FAMILY TRUST',NULL,NULL,NULL,NULL,NULL,NULL,'WA','6000',
 NULL,NULL,NULL,NULL,20260410),
-- 5. Super fund (SMF), no ACN
('51000000842','ACT',DATE '2015-09-01','SMF','ATO Regulated Self-Managed Superannuation Fund',
 'SMITH SUPER FUND',NULL,NULL,NULL,NULL,NULL,NULL,'SA','5000',
 NULL,NULL,NULL,NULL,20260301),
-- 6. Government entity (GOV)
('51000000874','ACT',DATE '1990-01-01','GOV','Commonwealth Government Entity',
 'DEPARTMENT OF EXAMPLE',NULL,NULL,NULL,NULL,'ACT',DATE '2000-07-01','ACT','2600',
 NULL,NULL,NULL,NULL,20260101),
-- 7. Single DGR endorsement
('51000000923','ACT',DATE '2012-01-01','PRV','Australian Private Company',
 'GIVING CO PTY LTD',NULL,NULL,'000000923','ACN','ACT',DATE '2012-01-01','VIC','3001',
 NULL,NULL,NULL,'[{"name":"GIVING CO DGR FUND","statusFromDate":"2012-01-01"}]'::jsonb,20260601),
-- 8. Multiple DGR endorsements (fan-out guard)
('51000000955','ACT',DATE '2008-01-01','PUB','Australian Public Company',
 'MULTI DGR LIMITED',NULL,NULL,'000000955','ACN','ACT',DATE '2008-07-01','QLD','4001',
 NULL,NULL,NULL,'[{"name":"DGR FUND A","statusFromDate":"2011-01-01"},{"name":"DGR FUND B","statusFromDate":"2013-06-01"}]'::jsonb,20260601),
-- 9. GST cancelled
('51000000987','ACT',DATE '2005-01-01','PRV','Australian Private Company',
 'EXPIRED GST PTY LTD',NULL,NULL,'000000987','ACN','CAN',DATE '2019-06-30','NSW','2001',
 NULL,NULL,NULL,NULL,20260601),
-- 10. GST never registered (null)
('51000001490','ACT',DATE '2018-01-01','PRV','Australian Private Company',
 'NO GST PTY LTD',NULL,NULL,'000001490','ACN',NULL,NULL,'VIC','3002',
 NULL,NULL,NULL,NULL,20260601),
-- 11. Multiple business + trading + other names (fan-out guard)
('51000001571','ACT',DATE '2016-01-01','PRV','Australian Private Company',
 'MANY NAMES PTY LTD',NULL,NULL,'000001571','ACN','ACT',DATE '2016-07-01','NSW','2002',
 '["NAME ONE","NAME TWO"]'::jsonb,'["TRADE CO"]'::jsonb,'["OTHER NAME"]'::jsonb,NULL,20260601),
-- 12. Cancelled ABN (status CAN)
('51000001620','CAN',DATE '2020-01-01','PRV','Australian Private Company',
 'DEFUNCT PTY LTD',NULL,NULL,'000001620','ACN','CAN',DATE '2020-01-01','NT','0800',
 NULL,NULL,NULL,NULL,20260601),
-- 13. Empty-string state and postcode (→ null in the document, 'other' bucket on split)
('51000001652','ACT',DATE '2014-01-01','PRV','Australian Private Company',
 'NOWHERE PTY LTD',NULL,NULL,'000001652','ACN','ACT',DATE '2014-07-01','','',
 NULL,NULL,NULL,NULL,20260601),
-- 14. AAT (Australian Antarctic Territory) state
('51000001684','ACT',DATE '2013-01-01','PUB','Australian Public Company',
 'ANTARCTIC RESEARCH LIMITED',NULL,NULL,'000001684','ACN','ACT',DATE '2013-07-01','AAT','7151',
 NULL,NULL,NULL,NULL,20260601),
-- 15. ACN present, no GST
('51000001701','ACT',DATE '2011-01-01','PRV','Australian Private Company',
 'ACN ONLY PTY LTD',NULL,NULL,'000001701','ACN',NULL,NULL,'TAS','7000',
 NULL,NULL,NULL,NULL,20260601),
-- 16. Names with & apostrophe unicode whitespace
('51000001733','ACT',DATE '2017-01-01','PRV','Australian Private Company',
 'O''BRIEN & SØNS PTY LTD',NULL,NULL,'000001733','ACN','ACT',DATE '2017-07-01','VIC','3003',
 '["JOE''S CAFÉ"]'::jsonb,NULL,NULL,NULL,20260601),
-- 17. Individual with ONLY a family name (concat_ws fix: entityName must be "MONONYM", not null)
('51000001765','ACT',DATE '2009-01-01','IND','Individual/Sole Trader',
 NULL,NULL,'MONONYM',NULL,NULL,NULL,NULL,'SA','5001',
 NULL,NULL,NULL,NULL,20260601),
-- 18. ARBN (foreign company) — acnType must be ARBN, not mislabelled ACN
('51000001797','ACT',DATE '2006-01-01','PUB','Australian Public Company',
 'FOREIGN CO PTY LTD',NULL,NULL,'000001797','ARBN','ACT',DATE '2006-07-01','NSW','2003',
 NULL,NULL,NULL,NULL,20260601),
-- 19. Minimal record: no names, no address
('51000001814','ACT',NULL,'IND','Individual/Sole Trader',
 NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
 NULL,NULL,NULL,NULL,20260601),
-- 20. Trading name only
('51000001846','ACT',DATE '2019-01-01','PRV','Australian Private Company',
 'TRADING ONLY PTY LTD',NULL,NULL,'000001846','ACN','ACT',DATE '2019-07-01','QLD','4002',
 NULL,'["JUST TRADING"]'::jsonb,NULL,NULL,20260601);

-- ASIC Company enrichment fixtures (1:1 on ABN). Populate company{} for a few
-- entities; all other ABNs keep company:null (proving the LEFT JOIN seam).
-- Deregistered company (1846) exercises the deregistration_date path.
INSERT INTO abn___SCHEMA_VERSION__.asic_company (
  abn, acn, company_name, current_name, type, class, sub_class, status,
  registration_date, deregistration_date, previous_state, state_registration_number,
  current_name_start_date
) VALUES
('51000000761','000000761','ACME PRIVATE PTY LTD','ACME PRIVATE PTY LTD','APTY','LMSH','PROP',
 'Registered',DATE '2001-06-15',NULL,NULL,NULL,DATE '2001-06-15'),
('51000000793','000000793','BIGCORP LIMITED','BIGCORP LIMITED','APUB','LMPL',NULL,
 'Registered',DATE '1995-01-01',NULL,'VIC','C12345',DATE '2005-03-01'),
('51000001846','000001846','TRADING ONLY PTY LTD','TRADING ONLY PTY LTD','APTY','LMSH','PROP',
 'Deregistered',DATE '2019-01-01',DATE '2024-05-01',NULL,NULL,DATE '2019-01-01');

-- ASIC Business Names enrichment fixtures (1:N on ABN; authoritative, distinct
-- from ABR's OtherEntity business names). 51000001571 has TWO (the 1:N aggregation
-- guard); 51000000761 has one cancelled name.
INSERT INTO abn___SCHEMA_VERSION__.asic_business_name (
  abn, business_name, status, registration_date, cancellation_date, bn_number, state
) VALUES
('51000001571','MANY NAMES CONSULTING','Registered',DATE '2017-03-01',NULL,'BN1000002','NSW'),
('51000001571','MANY NAMES TRADING','Registered',DATE '2016-02-01',NULL,'BN1000001','NSW'),
('51000000761','ACME BRANDS','Cancelled',DATE '2002-01-01',DATE '2010-01-01','BN1000003','VIC');

-- ACNC charity enrichment fixtures (1:0..1 on ABN). 2 charities; all other ABNs
-- keep charity:null. (51000000923 also has a DGR — the common charity shape.)
INSERT INTO abn___SCHEMA_VERSION__.acnc_charity (
  abn, charity_name, status, size, subtype, registration_date
) VALUES
('51000000923','GIVING CO CHARITABLE FOUNDATION','Registered','Medium','Advancing education',DATE '2012-06-01'),
('51000000810','THE SMITH FAMILY CHARITABLE TRUST','Registered','Small','Advancing social or public welfare',DATE '2011-01-01');

-- ASIC AFS licence enrichment fixtures (1:0..1 on ABN; AFS_LIC_ABN_ACN is the ABN).
INSERT INTO abn___SCHEMA_VERSION__.asic_afs_licence (
  abn, licence_number, name, start_date, conditions
) VALUES
('51000000761','240001','ACME PRIVATE PTY LTD',DATE '2003-05-01',NULL);

-- ASIC Credit licence enrichment fixtures (1:0..1 on ABN). Status raw ASIC code.
INSERT INTO abn___SCHEMA_VERSION__.asic_credit_licence (
  abn, licence_number, name, status, start_date, end_date
) VALUES
('51000000793','390001','BIGCORP LIMITED','APPR',DATE '2011-03-01',NULL);

-- ASIC Banned & Disqualified fixtures (0..N, keyed on ACN → joined via
-- abn.asic_number). 51000000987's asic_number '000000987' gets TWO banning
-- actions (the 1:N aggregation + ACN-join guard).
INSERT INTO abn___SCHEMA_VERSION__.asic_banned_disqualified (
  acn, name, type, start_date, end_date, comment
) VALUES
('000000987','EXPIRED GST PTY LTD','Australian Financial Services banning',DATE '2019-07-01',DATE '2022-07-01','No comment made'),
('000000987','EXPIRED GST PTY LTD','Credit banning',DATE '2020-01-01',NULL,NULL);
