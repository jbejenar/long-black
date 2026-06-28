/**
 * Regression: every line of fixtures/expected-output.ndjson must validate
 * against the AbnDocument contract and pass the ABN-domain invariants.
 * The byte-for-byte baseline itself is enforced by build-fixture-only.sh.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AbnDocumentSchema, type AbnDocument } from "../../src/schema.js";
import { isValidAbn } from "../../src/verify-checks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, "../../fixtures/expected-output.ndjson");

const lines = readFileSync(FIXTURE, "utf-8")
  .split("\n")
  .filter((l) => l.trim());
const docs = lines.map((l) => JSON.parse(l) as AbnDocument);

const NAME_TYPE_CODES = new Set(["MN", "TRD", "BN", "OTN", "DGR", "LGL", "IND"]);

describe("expected-output.ndjson regression", () => {
  it("has the expected line count", () => {
    expect(lines.length).toBe(20);
  });

  it("validates every line against AbnDocumentSchema", () => {
    const failures: string[] = [];
    docs.forEach((doc, i) => {
      const r = AbnDocumentSchema.safeParse(doc);
      if (!r.success) failures.push(`line ${i + 1} (${doc._id}): ${r.error.message}`);
    });
    if (failures.length) expect.fail(failures.join("\n"));
  });

  it("has unique _id values", () => {
    const ids = docs.map((d) => d._id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every _id is a checksum-valid ABN", () => {
    expect(docs.filter((d) => !isValidAbn(d._id)).map((d) => d._id)).toEqual([]);
  });

  it("no name field equals a raw XML type code", () => {
    const leaks: string[] = [];
    for (const d of docs) {
      const names = [d.entityName, ...d.businessNames, ...d.tradingNames, ...d.otherNames].filter(
        (n): n is string => typeof n === "string",
      );
      for (const n of names) {
        if (NAME_TYPE_CODES.has(n.trim().toUpperCase())) leaks.push(`${d._id}: ${n}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("composes entityName for an individual with only a family name (concat_ws guard)", () => {
    expect(docs.find((d) => d._id === "51000001765")?.entityName).toBe("MONONYM");
  });

  it("labels a foreign company's number as ARBN, not ACN (acnType fidelity)", () => {
    expect(docs.find((d) => d._id === "51000001797")?.acnType).toBe("ARBN");
  });

  it("coerces empty-string state/postcode to null", () => {
    const d = docs.find((x) => x._id === "51000001652");
    expect(d?.state).toBeNull();
    expect(d?.postcode).toBeNull();
  });

  it("treats GST status CAN as not registered", () => {
    expect(docs.find((d) => d._id === "51000000987")?.gstRegistered).toBe(false);
  });

  it("populates company{} for an ASIC-matched ABN (the join seam)", () => {
    const c = docs.find((d) => d._id === "51000000761")?.company;
    expect(c?.name).toBe("ACME PRIVATE PTY LTD");
    expect(c?.status).toBe("Registered");
    expect(c?.acn).toBe("000000761");
  });

  it("leaves company null for an ABN with no ASIC match", () => {
    expect(docs.find((d) => d._id === "51000000680")?.company).toBeNull();
  });

  it("captures deregistration for a deregistered company", () => {
    const c = docs.find((d) => d._id === "51000001846")?.company;
    expect(c?.status).toBe("Deregistered");
    expect(c?.deregistrationDate).toBe("2024-05-01");
  });

  it("aggregates multiple ASIC registered business names (1:N, ordered)", () => {
    const rbn = docs.find((d) => d._id === "51000001571")?.registeredBusinessNames;
    expect(rbn?.map((n) => n.name)).toEqual(["MANY NAMES CONSULTING", "MANY NAMES TRADING"]);
    expect(rbn?.every((n) => n.status === "Registered")).toBe(true);
  });

  it("keeps ABR business names separate from ASIC registered ones", () => {
    const d = docs.find((x) => x._id === "51000000761");
    expect(d?.businessNames).toEqual(["ACME"]); // from ABR OtherEntity
    expect(d?.registeredBusinessNames.map((n) => n.name)).toEqual(["ACME BRANDS"]); // from ASIC
  });
});
