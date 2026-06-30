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
export type DgrEndorsement = z.infer<typeof DgrSchema>;
export type RegisteredBusinessName = z.infer<typeof RegisteredBusinessNameSchema>;
export type CompanyEnrichment = z.infer<typeof CompanyEnrichmentSchema>;
export type CharityEnrichment = z.infer<typeof CharityEnrichmentSchema>;
export type CharityFinancials = z.infer<typeof CharityFinancialsSchema>;
export type AfsLicence = z.infer<typeof AfsLicenceSchema>;
export type CreditLicence = z.infer<typeof CreditLicenceSchema>;
export type BannedDisqualified = z.infer<typeof BannedDisqualifiedSchema>;
