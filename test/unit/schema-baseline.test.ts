/**
 * Gates the output contract: the current AbnDocument schema must have no BREAKING
 * changes vs the committed baseline. Additive (minor) changes pass; removals /
 * type changes / nullable→non-nullable fail until the baseline is regenerated and
 * the major version bumped.
 *
 * Regenerate: node --input-type=module -e "import {snapshotSchemas} from 'crema';
 *   import {AbnDocumentSchema} from './dist/schema.js'; import {writeFileSync} from 'node:fs';
 *   writeFileSync('fixtures/schema-baseline.json',
 *     JSON.stringify(snapshotSchemas({AbnDocument:AbnDocumentSchema},'<date>'),null,2)+'\n');"
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotSchemas, compareSnapshots, type SchemaSnapshot } from "crema";
import { AbnDocumentSchema } from "../../src/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(
  readFileSync(resolve(__dirname, "../../fixtures/schema-baseline.json"), "utf-8"),
) as SchemaSnapshot;

describe("schema baseline", () => {
  it("has no breaking changes vs the committed baseline", () => {
    const current = snapshotSchemas({ AbnDocument: AbnDocumentSchema }, baseline.generatedAt);
    const { breaking } = compareSnapshots(baseline, current);
    if (breaking.length) {
      expect.fail(
        "breaking schema changes:\n" +
          breaking.map((c) => `  ${c.path}: ${c.description}`).join("\n") +
          "\nRegenerate fixtures/schema-baseline.json and bump the MAJOR version if intended.",
      );
    }
    expect(breaking).toHaveLength(0);
  });
});
