/**
 * Unit tests for output-cli argv parsing — output-cli takes no flags (Parquet was
 * removed), so a removed/unknown flag must fail loudly rather than be silently ignored.
 */

import { describe, it, expect } from "vitest";
import { parseOutputArgs } from "../../src/output-cli.js";

describe("parseOutputArgs", () => {
  it("parses <ndjson> with the default output dir", () => {
    expect(parseOutputArgs(["out.ndjson"])).toEqual({
      ndjsonPath: "out.ndjson",
      outputDir: "output",
    });
  });

  it("parses <ndjson> <outDir>", () => {
    expect(parseOutputArgs(["out.ndjson", "dist-out"])).toEqual({
      ndjsonPath: "out.ndjson",
      outputDir: "dist-out",
    });
  });

  it("rejects the removed --parquet flag with a clear message (not a silent no-op)", () => {
    expect(() => parseOutputArgs(["out.ndjson", "--parquet"])).toThrow(
      /--parquet is no longer supported/i,
    );
  });

  it("rejects any unknown flag as a usage error", () => {
    expect(() => parseOutputArgs(["out.ndjson", "--nope"])).toThrow(/unknown flag/i);
  });

  it("requires the ndjson path", () => {
    expect(() => parseOutputArgs([])).toThrow(/usage/i);
  });
});
