/**
 * long-black — ABN document → Parquet schema + row mapper.
 *
 * The domain layer for crema's generic `convertToParquet`: scalar AbnDocument
 * fields become native Parquet columns; the nested/array fields (names, dgr,
 * registeredBusinessNames, company, charity) are serialized to JSON strings for
 * maximum reader compatibility — the same shape consumers get from the NDJSON.
 */

import { ParquetSchema, type ParquetRowMapper } from "crema";

/** Parquet schema mirroring AbnDocument (see docs/DOCUMENT-SCHEMA.md). */
export const ABN_PARQUET_SCHEMA: ParquetSchema = new ParquetSchema({
  _id: { type: "UTF8" },
  _version: { type: "UTF8" },
  abnStatus: { type: "UTF8" },
  abnStatusFromDate: { type: "UTF8", optional: true },
  entityName: { type: "UTF8", optional: true },
  entityTypeCode: { type: "UTF8" },
  entityTypeText: { type: "UTF8", optional: true },
  givenName: { type: "UTF8", optional: true },
  familyName: { type: "UTF8", optional: true },
  acn: { type: "UTF8", optional: true },
  acnType: { type: "UTF8", optional: true },
  gstRegistered: { type: "BOOLEAN" },
  gstStatusFromDate: { type: "UTF8", optional: true },
  recordLastUpdated: { type: "UTF8", optional: true },
  state: { type: "UTF8", optional: true },
  postcode: { type: "UTF8", optional: true },
  // Non-nullable arrays — always present, serialized to JSON.
  businessNames: { type: "UTF8" },
  tradingNames: { type: "UTF8" },
  otherNames: { type: "UTF8" },
  dgr: { type: "UTF8" },
  registeredBusinessNames: { type: "UTF8" },
  // Nullable nested objects — JSON when present, omitted (→ null) when not.
  company: { type: "UTF8", optional: true },
  charity: { type: "UTF8", optional: true },
});

/** Scalar fields that are nullable in the contract (omit when null). */
const NULLABLE_SCALARS = [
  "abnStatusFromDate",
  "entityName",
  "entityTypeText",
  "givenName",
  "familyName",
  "acn",
  "acnType",
  "gstStatusFromDate",
  "recordLastUpdated",
  "state",
  "postcode",
] as const;

/** Map an AbnDocument (parsed from NDJSON) to a flat Parquet row. */
export const abnParquetRow: ParquetRowMapper = (doc) => {
  const row: Record<string, unknown> = {
    _id: doc._id,
    _version: doc._version,
    abnStatus: doc.abnStatus,
    entityTypeCode: doc.entityTypeCode,
    gstRegistered: doc.gstRegistered,
    // Arrays (always present) → JSON strings.
    businessNames: JSON.stringify(doc.businessNames ?? []),
    tradingNames: JSON.stringify(doc.tradingNames ?? []),
    otherNames: JSON.stringify(doc.otherNames ?? []),
    dgr: JSON.stringify(doc.dgr ?? []),
    registeredBusinessNames: JSON.stringify(doc.registeredBusinessNames ?? []),
  };
  for (const field of NULLABLE_SCALARS) {
    if (doc[field] != null) row[field] = doc[field];
  }
  // Nullable nested objects → JSON only when present (omit → parquet null).
  if (doc.company != null) row.company = JSON.stringify(doc.company);
  if (doc.charity != null) row.charity = JSON.stringify(doc.charity);
  return row;
};
