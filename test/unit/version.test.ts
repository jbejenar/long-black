/**
 * Version drift guard. `src/index.ts` VERSION is the single source of truth for the
 * output-schema version stamped into `metadata.json` (`schemaVersion`). It MUST equal
 * `package.json` "version" — they had silently diverged (VERSION frozen at 0.6.0 while
 * package.json advanced), which shipped metadata under-reporting the schema version.
 * This test fails the build if they drift again.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../../src/index.js";

const pkg = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf-8"),
) as { version: string };

describe("schema version", () => {
  it("index.ts VERSION matches package.json version (the schemaVersion source of truth)", () => {
    expect(VERSION).toBe(pkg.version);
  });
});
