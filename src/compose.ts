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

/** Strict `YYYY-MM-DD` → calendar parts (with basic range checks), else null. */
function parseYmd(value: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m === null) return null;
  const parts = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  if (parts.m < 1 || parts.m > 12 || parts.d < 1 || parts.d > 31) return null;
  return parts;
}

/**
 * Whole CALENDAR years from `abnStatusFromDate` to the data version date — a
 * deterministic "ABN age" signal (years since the ABN entered its current status;
 * for an active ABN this is effectively its registration age). Uses date COMPONENTS
 * (year diff, minus one if the version's month/day is before the start's) — NOT
 * elapsed-ms / 365.25, which undercounts exact anniversaries (2025-01-01 →
 * 2026-01-01 is 1 year, but floor(365 / 365.25) = 0). Computed against the build's
 * `_version` (NOT wall-clock) and free of timezone/Date.parse ambiguity, so the
 * output stays byte-deterministic for the regression baseline. Null when either date
 * is absent or not a strict `YYYY-MM-DD`; clamped to 0 if the from-date post-dates
 * the version.
 */
export function computeAgeYears(abnStatusFromDate: string | null, version: string): number | null {
  if (abnStatusFromDate === null) return null;
  const start = parseYmd(abnStatusFromDate);
  const end = parseYmd(version.replace(/\./g, "-"));
  if (start === null || end === null) return null;
  let years = end.y - start.y;
  if (end.m < start.m || (end.m === start.m && end.d < start.d)) years -= 1;
  return years < 0 ? 0 : years;
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
    ageYears: computeAgeYears(abnStatusFromDate, version),
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
