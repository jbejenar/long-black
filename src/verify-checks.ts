/**
 * long-black — ABN-domain verify checks (injected into crema's verify harness).
 *
 * The generic harness (stream + report) lives in crema; these are the
 * domain-specific checks — the ABN-domain replacement for flat-white's
 * coordinate-bounds / postcode-range checks.
 */

import type { DocCheck } from "crema";
import type { AbnDocument } from "./schema.js";

const WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/** Validate an ABN's mod-89 weighted checksum. */
export function isValidAbn(abn: string): boolean {
  if (!/^\d{11}$/.test(abn)) return false;
  const digits = abn.split("").map((c) => Number(c));
  digits[0] -= 1;
  const sum = digits.reduce((acc, d, i) => acc + d * WEIGHTS[i], 0);
  return sum % 89 === 0;
}

/** XML name-type discriminators that must never leak into a name field. */
const NAME_TYPE_CODES = new Set(["MN", "TRD", "BN", "OTN", "DGR", "LGL", "IND"]);

export const abnChecks: DocCheck<AbnDocument>[] = [
  {
    name: "abn-checksum",
    run: (doc) => (isValidAbn(doc._id) ? null : `invalid ABN checksum: ${doc._id}`),
  },
  {
    name: "name-not-type-code",
    run: (doc) => {
      const names = [
        doc.entityName,
        ...doc.businessNames,
        ...doc.tradingNames,
        ...doc.otherNames,
      ].filter((n): n is string => typeof n === "string");
      const leak = names.find((n) => NAME_TYPE_CODES.has(n.trim().toUpperCase()));
      return leak ? `name field equals a raw type code: ${leak}` : null;
    },
  },
];
