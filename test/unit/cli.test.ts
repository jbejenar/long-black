/**
 * Unit tests for cli.ts pure helpers — version derivation + coverage-profile
 * resolution (the production/fixture/off completeness-gate selector).
 */

import { describe, it, expect } from "vitest";
import { deriveSchemaVersion, resolveCoverageFloors } from "../../src/cli.js";
import { ABN_COVERAGE_FLOORS, FIXTURE_COVERAGE_FLOORS } from "../../src/coverage.js";

describe("deriveSchemaVersion", () => {
  it("turns a YYYY.MM.DD version into an 8-digit suffix", () => {
    expect(deriveSchemaVersion("2026.06.28")).toBe("20260628");
  });
  it("rejects a malformed version", () => {
    expect(() => deriveSchemaVersion("2026.6")).toThrow(/expected YYYY\.MM\.DD/);
  });
});

describe("resolveCoverageFloors", () => {
  it("defaults to the fixture floors (gate present, small volumes)", () => {
    expect(resolveCoverageFloors(undefined)).toBe(FIXTURE_COVERAGE_FLOORS);
  });
  it("selects production floors for the real build", () => {
    expect(resolveCoverageFloors("production")).toBe(ABN_COVERAGE_FLOORS);
  });
  it("disables the gate with 'off'", () => {
    expect(resolveCoverageFloors("off")).toBeNull();
  });
  it("is case-insensitive", () => {
    expect(resolveCoverageFloors("Production")).toBe(ABN_COVERAGE_FLOORS);
  });
  it("rejects an unknown profile", () => {
    expect(() => resolveCoverageFloors("loose")).toThrow(/Invalid LONG_BLACK_COVERAGE_PROFILE/);
  });
});
