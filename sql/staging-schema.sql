-- staging-schema.sql — long-black ABN staging schema (owned, not gnaf-loader).
--
-- __SCHEMA_VERSION__ is substituted with the digits-only data version (e.g. 20260628).
-- The `abn` table is created WITHOUT an inline PK and loaded unconstrained; the
-- PRIMARY KEY + child-join indexes are added AFTER load by abn-finalize.sql
-- (fast bulk-load — COPY can't do ON CONFLICT, so conflict handling stays out of
-- the load). UNLOGGED because the database is ephemeral.

CREATE SCHEMA IF NOT EXISTS abn___SCHEMA_VERSION__;

CREATE UNLOGGED TABLE IF NOT EXISTS abn___SCHEMA_VERSION__.abn (
  abn                  char(11) NOT NULL,        -- PRIMARY KEY added after COPY
  abn_status           text,                     -- ACT | CAN
  abn_status_from_date date,
  entity_type_code     text,                     -- EntityTypeInd (130-value enum)
  entity_type_text     text,
  entity_name          text,                     -- MainEntity NonIndividualName[MN]
  given_names          text,                     -- LegalEntity 1-2 GivenName, joined
  family_name          text,
  asic_number          text,                     -- ACN/ARBN/ARSN/ARFN value
  asic_number_type     text,                     -- @ASICNumberType discriminator
  gst_status           text,                     -- ACT | CAN | null
  gst_status_from_date date,
  address_state        text,                     -- may be '' or 'AAT'
  address_postcode     text,
  business_names       jsonb,                    -- OtherEntity[BN]  (composed at parse time)
  trading_names        jsonb,                    -- OtherEntity[TRD]
  other_names          jsonb,                    -- OtherEntity[OTN]
  dgr                  jsonb,                    -- [{statusFromDate, status?, name?}]
  record_last_updated  integer                   -- YYYYMMDD
);

-- Enrichment SOURCES — stubbed so the flatten LEFT JOINs compile before the
-- loaders exist (populated in P3). 1:1 company, 1:N business names, 1:0..1 charity.
CREATE UNLOGGED TABLE IF NOT EXISTS abn___SCHEMA_VERSION__.asic_company (
  abn char(11), acn text, company_name text, current_name text, type text,
  class text, sub_class text, status text, registration_date date,
  deregistration_date date, previous_state text, state_registration_number text,
  current_name_start_date date
);

CREATE UNLOGGED TABLE IF NOT EXISTS abn___SCHEMA_VERSION__.asic_business_name (
  abn char(11), business_name text, status text, registration_date date,
  cancellation_date date, bn_number text, state text
);

CREATE UNLOGGED TABLE IF NOT EXISTS abn___SCHEMA_VERSION__.acnc_charity (
  abn char(11), charity_name text, status text, size text, subtype text,
  registration_date date
);

-- ACNC Annual Information Statement — the charity's most recent AIS financials,
-- folded into the charity{} object (1:0..1 on ABN). Monetary columns are numeric
-- (whole dollars; can exceed int4), staff FTE is numeric (fractional), volunteers
-- is an integer count.
CREATE UNLOGGED TABLE IF NOT EXISTS abn___SCHEMA_VERSION__.acnc_ais (
  abn char(11), reporting_period_start date, reporting_period_end date,
  total_revenue numeric, total_expenses numeric, total_assets numeric,
  total_liabilities numeric, staff_full_time_equivalent numeric, volunteers integer
);

-- Regulated & risk SOURCES (ASIC). AFS + credit licences are 1:0..1 per entity.
-- Their *_ABN_ACN source column holds EITHER an 11-digit ABN or a 9-digit ACN, so
-- the normalizer routes each value into `abn` OR `acn` (never both on one row); the
-- flatten matches `abn` directly and `acn` against abn.asic_number (ACN type only).
-- Banned/disqualified orgs are keyed on 9-digit ACN (no ABN in the source) → also
-- joined via abn.asic_number where asic_number_type = 'ACN'.
CREATE UNLOGGED TABLE IF NOT EXISTS abn___SCHEMA_VERSION__.asic_afs_licence (
  abn char(11), acn text, licence_number text, name text, start_date date, conditions text
);

CREATE UNLOGGED TABLE IF NOT EXISTS abn___SCHEMA_VERSION__.asic_credit_licence (
  abn char(11), acn text, licence_number text, name text, status text,
  start_date date, end_date date
);

CREATE UNLOGGED TABLE IF NOT EXISTS abn___SCHEMA_VERSION__.asic_banned_disqualified (
  acn text, name text, type text, start_date date, end_date date, comment text
);

-- AusTender government-contract spend, pre-aggregated per supplier ABN by
-- src/gov-spend.ts (OCDS bulk → in-memory sum → COPY here). 1:0..1 on ABN.
-- total_value_aud is numeric (summed in integer cents upstream for exactness; can
-- reach tens of billions); dates are the earliest/latest contract dateSigned.
CREATE UNLOGGED TABLE IF NOT EXISTS abn___SCHEMA_VERSION__.gov_spend (
  abn char(11), total_value_aud numeric, contract_count integer,
  first_contract_date date, last_contract_date date
);
