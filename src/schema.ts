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

/** ACNC charity enrichment (1:0..1 on ABN). Null until the source is wired. */
export const CharityEnrichmentSchema = z.object({
  name: z.string(),
  status: z.string(),
  size: z.string().nullable(),
  subtype: z.string().nullable(),
  registrationDate: z.string().nullable(),
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
});

export type AbnDocument = z.infer<typeof AbnDocumentSchema>;
export type DgrEndorsement = z.infer<typeof DgrSchema>;
export type RegisteredBusinessName = z.infer<typeof RegisteredBusinessNameSchema>;
export type CompanyEnrichment = z.infer<typeof CompanyEnrichmentSchema>;
export type CharityEnrichment = z.infer<typeof CharityEnrichmentSchema>;
