/**
 * long-black — AbnDocument schema (the output contract).
 *
 * Zod schema + inferred type for one document per ABN. Kept in sync with
 * docs/DOCUMENT-SCHEMA.md and fixtures/expected-output.ndjson (the 3-files rule):
 * additive field = minor bump, removal/rename = major.
 *
 * Enrichment objects (`company`, `charity`) are nullable so the multi-source
 * seam exists from day one; they stay null until those sources are wired.
 */

import { z } from "zod";

/** A Deductible Gift Recipient endorsement (0..N per ABN). */
export const DgrSchema = z.object({
  name: z.string().nullable(),
  statusFromDate: z.string().nullable(),
});

/** ASIC Company enrichment (1:1 on ABN). Null until the source is wired. */
export const CompanyEnrichmentSchema = z.object({
  acn: z.string().nullable(),
  name: z.string(),
  currentName: z.string().nullable(),
  type: z.string().nullable(),
  class: z.string().nullable(),
  subClass: z.string().nullable(),
  status: z.string(),
  registrationDate: z.string().nullable(),
  deregistrationDate: z.string().nullable(),
  previousState: z.string().nullable(),
  stateRegistrationNumber: z.string().nullable(),
});

/** A registered business name from ASIC (1:N on ABN; authoritative, distinct from ABR's). */
export const RegisteredBusinessNameSchema = z.object({
  name: z.string(),
  status: z.string().nullable(),
  registrationDate: z.string().nullable(),
  cancellationDate: z.string().nullable(),
});

/**
 * ACNC Annual Information Statement financials (the charity's most recent AIS).
 * Nested under `charity` and null when the charity has no AIS on file. Monetary
 * values are whole-dollar amounts; `staffFullTimeEquivalent` may be fractional.
 */
export const CharityFinancialsSchema = z.object({
  reportingPeriodStart: z.string().nullable(),
  reportingPeriodEnd: z.string().nullable(),
  totalRevenue: z.number().nullable(),
  totalExpenses: z.number().nullable(),
  totalAssets: z.number().nullable(),
  totalLiabilities: z.number().nullable(),
  staffFullTimeEquivalent: z.number().nullable(),
  volunteers: z.number().nullable(),
});

/** ACNC charity enrichment (1:0..1 on ABN). `financials` populate from the AIS. */
export const CharityEnrichmentSchema = z.object({
  name: z.string(),
  status: z.string(),
  size: z.string().nullable(),
  subtype: z.string().nullable(),
  registrationDate: z.string().nullable(),
  financials: CharityFinancialsSchema.nullable(),
});

/** ASIC Australian Financial Services licence (1:0..1 on ABN). Presence = a current AFSL holder. */
export const AfsLicenceSchema = z.object({
  number: z.string(),
  name: z.string().nullable(),
  startDate: z.string().nullable(),
  conditions: z.string().nullable(),
});

/** ASIC Credit licence (1:0..1 on ABN). */
export const CreditLicenceSchema = z.object({
  number: z.string(),
  name: z.string().nullable(),
  status: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
});

/** ASIC AFS authorised representative — authorised to distribute financial products under an AFSL. */
export const AfsAuthorisedRepSchema = z.object({
  number: z.string(),
  licenceNumber: z.string().nullable(),
  status: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
});

/** ASIC credit representative — authorised under a credit licensee. */
export const CreditRepSchema = z.object({
  number: z.string(),
  licenceNumber: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
});

/** WGEA reporting organisation — a 100+-staff employer that reports gender-equality data. */
export const WgeaReporterSchema = z.object({
  /** The submission-group ABN this entity reports under (itself, when it submits alone). */
  primaryAbn: z.string().nullable(),
  /** The submission group's organisation name. */
  primaryOrganisation: z.string().nullable(),
});

/** ASIC-approved SMSF (self-managed super fund) auditor — a regulated financial profession. */
export const SmsfAuditorSchema = z.object({
  number: z.string(),
  status: z.string().nullable(),
  registrationDate: z.string().nullable(),
  suspensionStartDate: z.string().nullable(),
  suspensionEndDate: z.string().nullable(),
});

/** An ASIC banning/disqualification action against an organisation (0..N, joined via ACN). */
export const BannedDisqualifiedSchema = z.object({
  type: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  comment: z.string().nullable(),
});

/**
 * AusTender government-contract spend, aggregated per supplier ABN (1:0..1).
 * Null when the ABN has never been a listed supplier on an Australian Government
 * contract. Values cover all AusTender history (from 2007); `totalValueAud` is the
 * summed face value of those contracts (whole-of-history, not annual).
 */
export const GovSpendSchema = z.object({
  totalValueAud: z.number(),
  contractCount: z.number(),
  firstContractDate: z.string().nullable(),
  lastContractDate: z.string().nullable(),
});

/**
 * GrantConnect grant awards received, aggregated per recipient ABN (1:0..1). The
 * grants counterpart to `govSpend` (contracts). Null when the ABN has never been a
 * grant recipient. `totalValueAud` is the summed value of all grant awards to the ABN
 * (all history from Dec 2017); dates are the earliest/latest award publish date.
 */
export const GovGrantsSchema = z.object({
  totalValueAud: z.number(),
  grantCount: z.number(),
  firstGrantDate: z.string().nullable(),
  lastGrantDate: z.string().nullable(),
});

/**
 * ATO Corporate Tax Transparency (1:0..1). Present only for entities with ≥$100M
 * total income for the reported year. `taxableIncome`/`taxPayable` are null when the
 * ATO reported ≤0 (legislation forbids reporting a zero/negative amount).
 */
export const TaxTransparencySchema = z.object({
  incomeYear: z.string(),
  totalIncome: z.number(),
  taxableIncome: z.number().nullable(),
  taxPayable: z.number().nullable(),
});

/** ATO R&D Tax Incentive (1:0..1). The entity's notional R&D expenditure for the year. */
export const RdTaxIncentiveSchema = z.object({
  incomeYear: z.string(),
  totalRdExpenditure: z.number().nullable(),
});

/**
 * Derived convenience booleans — composed from the fields above, not a new source.
 * Every flag is always present (a true/false), so consumers can filter without
 * digging into nested null/empty objects.
 */
export const EntityFlagsSchema = z.object({
  /** Entity type is an individual / sole trader (`entityTypeCode === 'IND'`). */
  isIndividual: z.boolean(),
  /** Has an ASIC company record (`company != null`). */
  isCompany: z.boolean(),
  /** Is an ACNC-registered charity (`charity != null`). */
  isCharity: z.boolean(),
  /** Holds an ASIC AFS or credit licence. */
  isLicensed: z.boolean(),
  /** Has ≥1 ASIC banning/disqualification action. */
  hasEnforcementAction: z.boolean(),
  /** Has ≥1 Deductible Gift Recipient endorsement. */
  isDgr: z.boolean(),
  /** Has won ≥1 Australian Government contract (`govSpend != null`). */
  hasGovContracts: z.boolean(),
  /** Has received ≥1 Australian Government grant (`govGrants != null`). */
  receivesGovGrants: z.boolean(),
  /** Is a ≥$100M-income entity in the ATO tax-transparency report (`taxTransparency != null`). */
  isLargeCorporateTaxpayer: z.boolean(),
  /** Claimed the ATO R&D Tax Incentive (`rdTaxIncentive != null`). */
  claimsRdTaxIncentive: z.boolean(),
  /** Is an ASIC AFS authorised representative (`afsAuthorisedRep != null`). */
  isAfsAuthorisedRep: z.boolean(),
  /** Is an ASIC credit representative (`creditRep != null`). */
  isCreditRep: z.boolean(),
  /** Reports to WGEA — a 100+-staff employer (`wgeaReporter != null`). */
  isWgeaReporter: z.boolean(),
  /** Is an ASIC-approved SMSF auditor (`smsfAuditor != null`). */
  isSmsfAuditor: z.boolean(),
});

export const AbnDocumentSchema = z.object({
  /** The ABN — 11 digits, string (never numeric). */
  _id: z.string(),
  /** Data version (ABR TransferInfo/ExtractTime, e.g. "2026.06.28"). */
  _version: z.string(),
  abnStatus: z.enum(["ACT", "CAN"]),
  abnStatusFromDate: z.string().nullable(),
  entityName: z.string().nullable(),
  entityTypeCode: z.string(),
  entityTypeText: z.string().nullable(),
  givenName: z.string().nullable(),
  familyName: z.string().nullable(),
  /** ACN/ARBN/ARSN/ARFN number (the ASIC number, regardless of type). */
  acn: z.string().nullable(),
  acnType: z.enum(["ACN", "ARBN", "ARSN", "ARFN"]).nullable(),
  gstRegistered: z.boolean(),
  gstStatusFromDate: z.string().nullable(),
  recordLastUpdated: z.string().nullable(),
  state: z.string().nullable(),
  postcode: z.string().nullable(),
  businessNames: z.array(z.string()),
  tradingNames: z.array(z.string()),
  otherNames: z.array(z.string()),
  dgr: z.array(DgrSchema),
  registeredBusinessNames: z.array(RegisteredBusinessNameSchema),
  company: CompanyEnrichmentSchema.nullable(),
  charity: CharityEnrichmentSchema.nullable(),
  /** ASIC AFS licence held by this ABN, if any (regulatory/trust signal). */
  financialServicesLicence: AfsLicenceSchema.nullable(),
  /** ASIC credit licence held by this ABN, if any. */
  creditLicence: CreditLicenceSchema.nullable(),
  /** ASIC banning/disqualification actions against this entity (via ACN); empty if none. */
  bannedDisqualified: z.array(BannedDisqualifiedSchema),
  /** AusTender government-contract spend (as a supplier); null if none. */
  govSpend: GovSpendSchema.nullable(),
  /** GrantConnect grant awards received (as a recipient); null if none. */
  govGrants: GovGrantsSchema.nullable(),
  /** ATO Corporate Tax Transparency (≥$100M-income entities); null otherwise. */
  taxTransparency: TaxTransparencySchema.nullable(),
  /** ATO R&D Tax Incentive claim for the reported year; null otherwise. */
  rdTaxIncentive: RdTaxIncentiveSchema.nullable(),
  /** ASIC AFS authorised representative record; null if not an authorised rep. */
  afsAuthorisedRep: AfsAuthorisedRepSchema.nullable(),
  /** ASIC credit representative record; null if not a credit rep. */
  creditRep: CreditRepSchema.nullable(),
  /** WGEA reporting-organisation record (100+-staff employer); null otherwise. */
  wgeaReporter: WgeaReporterSchema.nullable(),
  /** ASIC-approved SMSF auditor record; null if not a registered SMSF auditor. */
  smsfAuditor: SmsfAuditorSchema.nullable(),
  /** Whole years since `abnStatusFromDate` relative to `_version`; null if no date. */
  ageYears: z.number().nullable(),
  /** `abnStatus === 'ACT'` — a convenience boolean. */
  isActive: z.boolean(),
  /** Derived convenience booleans (see EntityFlagsSchema). */
  flags: EntityFlagsSchema,
});

export type AbnDocument = z.infer<typeof AbnDocumentSchema>;
export type EntityFlags = z.infer<typeof EntityFlagsSchema>;
export type GovSpend = z.infer<typeof GovSpendSchema>;
export type GovGrants = z.infer<typeof GovGrantsSchema>;
export type TaxTransparency = z.infer<typeof TaxTransparencySchema>;
export type RdTaxIncentive = z.infer<typeof RdTaxIncentiveSchema>;
export type AfsAuthorisedRep = z.infer<typeof AfsAuthorisedRepSchema>;
export type CreditRep = z.infer<typeof CreditRepSchema>;
export type WgeaReporter = z.infer<typeof WgeaReporterSchema>;
export type SmsfAuditor = z.infer<typeof SmsfAuditorSchema>;
export type DgrEndorsement = z.infer<typeof DgrSchema>;
export type RegisteredBusinessName = z.infer<typeof RegisteredBusinessNameSchema>;
export type CompanyEnrichment = z.infer<typeof CompanyEnrichmentSchema>;
export type CharityEnrichment = z.infer<typeof CharityEnrichmentSchema>;
export type CharityFinancials = z.infer<typeof CharityFinancialsSchema>;
export type AfsLicence = z.infer<typeof AfsLicenceSchema>;
export type CreditLicence = z.infer<typeof CreditLicenceSchema>;
export type BannedDisqualified = z.infer<typeof BannedDisqualifiedSchema>;
