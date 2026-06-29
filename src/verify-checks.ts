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

// NOTE: there is no production "name must not equal an XML type code" check.
// It read well at fixture scale but is a false positive on real data: short
// genuine names legitimately coincide with the discriminator codes — the
// 2026.06.24 extract has 7 (in 20.3M), e.g. "DGR" is a trading name for *D*avid
// *G*raham *R*ote, "BN" for *B*alram *N*aipal, "IND" is a registered business
// name, and "TRD" appears as actual entity names. The invariant the check meant
// to guard — that load.ts routes by the `@type` attribute but never substitutes
// it for the element text — is enforced where it is actually decidable: the
// parser golden-record tests (incl. a code-shaped name that must survive) and
// the byte-for-byte fixture regression.

export const abnChecks: DocCheck<AbnDocument>[] = [
  {
    name: "abn-checksum",
    run: (doc) => (isValidAbn(doc._id) ? null : `invalid ABN checksum: ${doc._id}`),
  },
];
