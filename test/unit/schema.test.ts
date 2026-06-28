/**
 * Unit tests for schema.ts — the AbnDocument contract.
 */

import { describe, it, expect } from "vitest";
import { AbnDocumentSchema, type AbnDocument } from "../../src/schema.js";

function validDoc(overrides: Partial<AbnDocument> = {}): AbnDocument {
  return {
    _id: "51824753556",
    _version: "2026.06.28",
    abnStatus: "ACT",
    abnStatusFromDate: "2000-01-01",
    entityName: "ACME PTY LTD",
    entityTypeCode: "PRV",
    entityTypeText: "Australian Private Company",
    givenName: null,
    familyName: null,
    acn: "824753556",
    acnType: "ACN",
    gstRegistered: true,
    gstStatusFromDate: "2000-07-01",
    recordLastUpdated: "2026-06-01",
    state: "NSW",
    postcode: "2000",
    businessNames: ["ACME"],
    tradingNames: [],
    otherNames: [],
    dgr: [],
    registeredBusinessNames: [],
    company: null,
    charity: null,
    ...overrides,
  };
}

describe("AbnDocumentSchema", () => {
  it("accepts a valid company document", () => {
    expect(AbnDocumentSchema.safeParse(validDoc()).success).toBe(true);
  });

  it("accepts a sole trader (individual) with given/family name", () => {
    const doc = validDoc({
      entityTypeCode: "IND",
      entityName: "JOHN SMITH",
      givenName: "JOHN",
      familyName: "SMITH",
      acn: null,
      acnType: null,
      gstRegistered: false,
      gstStatusFromDate: null,
    });
    expect(AbnDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects an invalid abnStatus", () => {
    const r = AbnDocumentSchema.safeParse(validDoc({ abnStatus: "WAT" as unknown as "ACT" }));
    expect(r.success).toBe(false);
  });

  it("rejects an invalid acnType", () => {
    const r = AbnDocumentSchema.safeParse(validDoc({ acnType: "XYZ" as unknown as "ACN" }));
    expect(r.success).toBe(false);
  });

  it("requires array name fields (not null)", () => {
    const r = AbnDocumentSchema.safeParse(validDoc({ businessNames: null as unknown as string[] }));
    expect(r.success).toBe(false);
  });

  it("accepts a populated dgr array", () => {
    const doc = validDoc({ dgr: [{ name: "ACME FOUNDATION", statusFromDate: "2010-01-01" }] });
    expect(AbnDocumentSchema.safeParse(doc).success).toBe(true);
  });
});
