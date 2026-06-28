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
  RegisteredBusinessName,
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

export function composeAbnDocument(row: Record<string, unknown>, version: string): AbnDocument {
  const status = String(row.abn_status) === "CAN" ? "CAN" : "ACT";

  return {
    _id: String(row._id),
    _version: version,
    abnStatus: status,
    abnStatusFromDate: nullableString(row.abn_status_from_date),
    entityName: nullableString(row.entity_name),
    entityTypeCode: String(row.entity_type_code ?? ""),
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
    dgr: dgrArray(row.dgr),
    // SQL builds these nested shapes (camelCase) or null/[]; Zod validates them.
    registeredBusinessNames: Array.isArray(row.registered_business_names)
      ? (row.registered_business_names as RegisteredBusinessName[])
      : [],
    company: (row.company as CompanyEnrichment | null) ?? null,
    charity: null, // wired in P3.03
  };
}
