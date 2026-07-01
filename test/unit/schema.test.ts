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
    financialServicesLicence: null,
    creditLicence: null,
    bannedDisqualified: [],
    govSpend: null,
    taxTransparency: null,
    rdTaxIncentive: null,
    afsAuthorisedRep: null,
    creditRep: null,
    wgeaReporter: null,
    ageYears: 26,
    isActive: true,
    flags: {
      isIndividual: false,
      isCompany: false,
      isCharity: false,
      isLicensed: false,
      hasEnforcementAction: false,
      isDgr: false,
      hasGovContracts: false,
      isLargeCorporateTaxpayer: false,
      claimsRdTaxIncentive: false,
      isAfsAuthorisedRep: false,
      isCreditRep: false,
      isWgeaReporter: false,
    },
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

  it("accepts regulated & risk enrichment (AFS/credit licence + banned)", () => {
    const doc = validDoc({
      financialServicesLicence: {
        number: "240001",
        name: "ACME PTY LTD",
        startDate: "2003-05-01",
        conditions: null,
      },
      creditLicence: {
        number: "390001",
        name: "ACME PTY LTD",
        status: "APPR",
        startDate: "2011-03-01",
        endDate: null,
      },
      bannedDisqualified: [
        { type: "AFS banning", startDate: "2019-07-01", endDate: null, comment: null },
      ],
    });
    expect(AbnDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("requires bannedDisqualified to be an array (not null)", () => {
    const r = AbnDocumentSchema.safeParse(validDoc({ bannedDisqualified: null as unknown as [] }));
    expect(r.success).toBe(false);
  });

  it("accepts a charity with AIS financials (numbers, not strings)", () => {
    const doc = validDoc({
      charity: {
        name: "GIVING CO",
        status: "Registered",
        size: "Medium",
        subtype: "Advancing education",
        registrationDate: "2012-06-01",
        financials: {
          reportingPeriodStart: "2023-07-01",
          reportingPeriodEnd: "2024-06-30",
          totalRevenue: 1250000,
          totalExpenses: 1180000,
          totalAssets: 3400000,
          totalLiabilities: 420000,
          staffFullTimeEquivalent: 12.5,
          volunteers: 45,
        },
      },
    });
    expect(AbnDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("accepts a charity that has not filed an AIS (financials null)", () => {
    const doc = validDoc({
      charity: {
        name: "NO AIS TRUST",
        status: "Registered",
        size: "Small",
        subtype: null,
        registrationDate: "2011-01-01",
        financials: null,
      },
    });
    expect(AbnDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects a charity missing the financials key (now required, nullable)", () => {
    const charity = {
      name: "X",
      status: "Registered",
      size: null,
      subtype: null,
      registrationDate: null,
    };
    const r = AbnDocumentSchema.safeParse(
      validDoc({ charity: charity as unknown as AbnDocument["charity"] }),
    );
    expect(r.success).toBe(false);
  });

  it("accepts a govSpend object (numbers) with hasGovContracts flag", () => {
    const doc = validDoc({
      govSpend: {
        totalValueAud: 1500000.5,
        contractCount: 3,
        firstContractDate: "2018-03-15",
        lastContractDate: "2024-09-01",
      },
      flags: {
        isIndividual: false,
        isCompany: true,
        isCharity: false,
        isLicensed: false,
        hasEnforcementAction: false,
        isDgr: false,
        hasGovContracts: true,
        isLargeCorporateTaxpayer: false,
        claimsRdTaxIncentive: false,
        isAfsAuthorisedRep: false,
        isCreditRep: false,
        isWgeaReporter: false,
      },
    });
    expect(AbnDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects govSpend with a string totalValueAud", () => {
    const doc = validDoc({
      govSpend: {
        totalValueAud: "1500000.50" as unknown as number,
        contractCount: 3,
        firstContractDate: null,
        lastContractDate: null,
      },
    });
    expect(AbnDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("accepts a null ageYears (no abnStatusFromDate)", () => {
    expect(AbnDocumentSchema.safeParse(validDoc({ ageYears: null })).success).toBe(true);
  });

  it("requires isActive to be a boolean", () => {
    const r = AbnDocumentSchema.safeParse(validDoc({ isActive: "yes" as unknown as boolean }));
    expect(r.success).toBe(false);
  });

  it("requires every flag (rejects a partial flags object)", () => {
    const r = AbnDocumentSchema.safeParse(
      validDoc({ flags: { isIndividual: true } as unknown as AbnDocument["flags"] }),
    );
    expect(r.success).toBe(false);
  });

  it("rejects non-numeric charity financials (revenue as string)", () => {
    const doc = validDoc({
      charity: {
        name: "X",
        status: "Registered",
        size: null,
        subtype: null,
        registrationDate: null,
        financials: {
          reportingPeriodStart: null,
          reportingPeriodEnd: null,
          totalRevenue: "1250000" as unknown as number,
          totalExpenses: null,
          totalAssets: null,
          totalLiabilities: null,
          staffFullTimeEquivalent: null,
          volunteers: null,
        },
      },
    });
    expect(AbnDocumentSchema.safeParse(doc).success).toBe(false);
  });
});
