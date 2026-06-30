/**
 * long-black — compose an AbnDocument from a flat SQL row.
 *
 * Injected into crema's streamFlatten. Maps snake_case columns from
 * sql/abn_full.sql onto the AbnDocument contract. Dates arrive as ISO text
 * (cast in SQL); record_last_updated arrives as an int YYYYMMDD and is
 * converted here. Empty/whitespace state & postcode are coerced to null.
 */

import type {
  AbnDocument,
  DgrEndorsement,
  CompanyEnrichment,
  CharityEnrichment,
  RegisteredBusinessName,
  AfsLicence,
  CreditLicence,
  BannedDisqualified,
} from "./schema.js";

function emptyToNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** int YYYYMMDD → ISO "YYYY-MM-DD" (null if absent/malformed). */
function isoFromYyyymmdd(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  if (!/^\d{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

function dgrArray(value: unknown): DgrEndorsement[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    return {
      name: nullableString(o.name),
      statusFromDate: nullableString(o.statusFromDate),
    };
  });
}

const ACN_TYPES = new Set(["ACN", "ARBN", "ARSN", "ARFN"]);

function acnType(value: unknown): AbnDocument["acnType"] {
  if (value === null || value === undefined) return null;
  const s = String(value).toUpperCase();
  return ACN_TYPES.has(s) ? (s as AbnDocument["acnType"]) : null;
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/**
 * Whole years from `abnStatusFromDate` to the data version date — a deterministic
 * "ABN age" signal (years since the ABN entered its current status; for an active
 * ABN this is effectively its registration age). Computed against the build's
 * `_version` (NOT wall-clock) so the output stays byte-deterministic for the
 * regression baseline. Null when the from-date is absent/unparseable; clamped to 0
 * if the from-date somehow post-dates the version.
 */
function ageYears(abnStatusFromDate: string | null, version: string): number | null {
  if (abnStatusFromDate === null) return null;
  const start = Date.parse(abnStatusFromDate);
  const end = Date.parse(version.replace(/\./g, "-"));
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (end <= start) return 0;
  return Math.floor((end - start) / MS_PER_YEAR);
}

export function composeAbnDocument(row: Record<string, unknown>, version: string): AbnDocument {
  const status = String(row.abn_status) === "CAN" ? "CAN" : "ACT";
  const abnStatusFromDate = nullableString(row.abn_status_from_date);
  const entityTypeCode = String(row.entity_type_code ?? "");
  const dgr = dgrArray(row.dgr);
  const company = (row.company as CompanyEnrichment | null) ?? null;
  const charity = (row.charity as CharityEnrichment | null) ?? null;
  const financialServicesLicence = (row.financial_services_licence as AfsLicence | null) ?? null;
  const creditLicence = (row.credit_licence as CreditLicence | null) ?? null;
  const bannedDisqualified = Array.isArray(row.banned_disqualified)
    ? (row.banned_disqualified as BannedDisqualified[])
    : [];

  return {
    _id: String(row._id),
    _version: version,
    abnStatus: status,
    abnStatusFromDate,
    entityName: nullableString(row.entity_name),
    entityTypeCode,
    entityTypeText: nullableString(row.entity_type_text),
    givenName: nullableString(row.given_names),
    familyName: nullableString(row.family_name),
    acn: nullableString(row.acn),
    acnType: acnType(row.acn_type),
    gstRegistered: row.gst_registered === true,
    gstStatusFromDate: nullableString(row.gst_status_from_date),
    recordLastUpdated: isoFromYyyymmdd(row.record_last_updated),
    state: emptyToNull(row.state),
    postcode: emptyToNull(row.postcode),
    businessNames: stringArray(row.business_names),
    tradingNames: stringArray(row.trading_names),
    otherNames: stringArray(row.other_names),
    dgr,
    // SQL builds these nested shapes (camelCase) or null/[]; Zod validates them.
    registeredBusinessNames: Array.isArray(row.registered_business_names)
      ? (row.registered_business_names as RegisteredBusinessName[])
      : [],
    company,
    charity,
    financialServicesLicence,
    creditLicence,
    bannedDisqualified,
    // Derived signals — computed here from the fields above, no extra source.
    ageYears: ageYears(abnStatusFromDate, version),
    isActive: status === "ACT",
    flags: {
      isIndividual: entityTypeCode === "IND",
      isCompany: company !== null,
      isCharity: charity !== null,
      isLicensed: financialServicesLicence !== null || creditLicence !== null,
      hasEnforcementAction: bannedDisqualified.length > 0,
      isDgr: dgr.length > 0,
    },
  };
}
