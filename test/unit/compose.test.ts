/**
 * Unit tests for compose.ts — focused on `computeAgeYears`, whose calendar-year
 * boundaries (anniversaries, leap days, the dotted _version format) are exactly
 * where an elapsed-ms/365.25 approximation goes wrong.
 */

import { describe, it, expect } from "vitest";
import { composeAbnDocument, computeAgeYears } from "../../src/compose.js";

describe("computeAgeYears", () => {
  it("counts an exact one-year anniversary as 1 (the 365.25 bug)", () => {
    expect(computeAgeYears("2025-01-01", "2026-01-01")).toBe(1);
    expect(computeAgeYears("2025-01-01", "2026.01.01")).toBe(1); // dotted _version
  });

  it("does not count the day BEFORE an anniversary", () => {
    expect(computeAgeYears("2025-01-01", "2025-12-31")).toBe(0);
    expect(computeAgeYears("2000-06-15", "2026-06-14")).toBe(25);
    expect(computeAgeYears("2000-06-15", "2026-06-15")).toBe(26); // on the anniversary
  });

  it("handles many whole years", () => {
    expect(computeAgeYears("2003-05-01", "2026-06-28")).toBe(23);
    expect(computeAgeYears("2003-07-01", "2026-06-28")).toBe(22); // before the July anniversary
  });

  it("handles a leap-day start deterministically", () => {
    // 2024-02-29 → 2025-02-28: anniversary (Feb 29) not reached in a non-leap year.
    expect(computeAgeYears("2024-02-29", "2025-02-28")).toBe(0);
    expect(computeAgeYears("2024-02-29", "2025-03-01")).toBe(1);
    expect(computeAgeYears("2024-02-29", "2028-02-29")).toBe(4); // next leap day
  });

  it("clamps a future start date to 0 (never negative)", () => {
    expect(computeAgeYears("2030-01-01", "2026-06-28")).toBe(0);
  });

  it("returns null for a missing or malformed date", () => {
    expect(computeAgeYears(null, "2026-06-28")).toBeNull();
    expect(computeAgeYears("not-a-date", "2026-06-28")).toBeNull();
    expect(computeAgeYears("2026-13-01", "2026-06-28")).toBeNull(); // bad month
    expect(computeAgeYears("2026/01/01", "2026-06-28")).toBeNull(); // wrong separator
    expect(computeAgeYears("2020-01-01", "garbage")).toBeNull(); // bad version
  });
});

describe("composeAbnDocument derived fields", () => {
  const baseRow = { _id: "51000000761", abn_status: "ACT", entity_type_code: "PRV" };

  it("wires ageYears / isActive / flags from the row", () => {
    const doc = composeAbnDocument(
      { ...baseRow, abn_status_from_date: "2001-06-15", charity: { name: "X" } },
      "2026.06.28",
    );
    expect(doc.ageYears).toBe(25);
    expect(doc.isActive).toBe(true);
    expect(doc.flags.isCompany).toBe(false);
    expect(doc.flags.isCharity).toBe(true);
  });

  it("isActive is false for a cancelled ABN, and flags reflect enrichment", () => {
    const doc = composeAbnDocument(
      {
        ...baseRow,
        abn_status: "CAN",
        entity_type_code: "IND",
        company: { acn: "1" },
        financial_services_licence: { number: "240001" },
        dgr: [{ name: "F" }],
      },
      "2026.06.28",
    );
    expect(doc.isActive).toBe(false);
    expect(doc.flags.isIndividual).toBe(true);
    expect(doc.flags.isCompany).toBe(true);
    expect(doc.flags.isLicensed).toBe(true);
    expect(doc.flags.isDgr).toBe(true);
    expect(doc.flags.hasEnforcementAction).toBe(false);
  });

  it("ageYears is null when the ABN has no status-from date", () => {
    const doc = composeAbnDocument({ ...baseRow, abn_status_from_date: null }, "2026.06.28");
    expect(doc.ageYears).toBeNull();
  });

  it("derives distress flags from the ASIC company status (EXAD/SOFF/Deregistered)", () => {
    const flagsFor = (status: string | null) =>
      composeAbnDocument({ ...baseRow, company: status === null ? null : { status } }, "2026.06.28")
        .flags;

    const exad = flagsFor("EXAD");
    expect(exad.isExternalAdministration).toBe(true);
    expect(exad.isStrikeOffInProgress).toBe(false);
    expect(exad.isDeregistered).toBe(false);

    expect(flagsFor("SOFF").isStrikeOffInProgress).toBe(true);
    expect(flagsFor("Deregistered").isDeregistered).toBe(true);

    // A healthy registered company and a no-company entity trip none of them.
    const healthy = flagsFor("Registered");
    expect(healthy.isExternalAdministration).toBe(false);
    expect(healthy.isStrikeOffInProgress).toBe(false);
    expect(healthy.isDeregistered).toBe(false);
    const none = flagsFor(null);
    expect(none.isExternalAdministration).toBe(false);
    expect(none.isDeregistered).toBe(false);
  });
});
