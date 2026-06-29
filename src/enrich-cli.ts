/**
 * long-black — enrichment CLI: download + load the ASIC/ACNC enrichment sources
 * into the existing abn_<version> schema (created by staging-schema.sql).
 *
 *   DATA_DIR=data DATABASE_URL=… LONG_BLACK_VERSION=YYYY.MM.DD \
 *     node dist/enrich-cli.js [asic_company asic_business_name acnc_charity]
 *
 * With no source-key args, all sources are loaded. Each source is independent:
 * one failing (e.g. a 404 from data.gov.au) is reported and the rest continue;
 * the CLI exits non-zero if any source failed, so the build can decide whether a
 * partial enrichment is acceptable. Enrichment is purely additive — the typed
 * tables start empty, so a skipped source just leaves its nested object null.
 */

import { deriveSchemaVersion, DEFAULT_DB_URL, DEFAULT_VERSION } from "./cli.js";
import {
  ENRICHMENT_SOURCES,
  downloadEnrichmentSource,
  loadEnrichmentSource,
  type EnrichmentSource,
} from "./enrich.js";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL ?? DEFAULT_DB_URL;
  const version = process.env.LONG_BLACK_VERSION ?? DEFAULT_VERSION;
  const schemaVersion = deriveSchemaVersion(version);
  const dataDir = process.env.DATA_DIR ?? "data";

  const requested = process.argv.slice(2);
  const unknown = requested.filter((k) => !ENRICHMENT_SOURCES.some((s) => s.key === k));
  if (unknown.length > 0) {
    console.error(`[enrich] unknown source key(s): ${unknown.join(", ")}`);
    console.error(`[enrich] valid keys: ${ENRICHMENT_SOURCES.map((s) => s.key).join(", ")}`);
    process.exit(2);
  }
  const sources: EnrichmentSource[] =
    requested.length === 0
      ? ENRICHMENT_SOURCES
      : ENRICHMENT_SOURCES.filter((s) => requested.includes(s.key));

  let failures = 0;
  for (const source of sources) {
    try {
      console.error(`[enrich] ${source.label}: downloading…`);
      const file = await downloadEnrichmentSource(source, dataDir);
      console.error(`[enrich] ${source.label}: loading ${file}…`);
      const inserted = await loadEnrichmentSource({
        connectionString,
        schemaVersion,
        source,
        file,
      });
      // Completeness floor: a load far below the known volume means an empty/
      // truncated CSV, the wrong resource, or a normalize that dropped rows.
      // Treat it as a failure so the build can't ship a hollow source of truth.
      if (inserted < source.minRows) {
        failures++;
        console.error(
          `[enrich] ${source.label}: FAILED — only ${inserted} row(s), below floor ${source.minRows} (incomplete source)`,
        );
        continue;
      }
      console.log(`[enrich] ${source.label}: ${inserted} row(s) → ${source.key}`);
    } catch (err) {
      failures++;
      console.error(`[enrich] ${source.label}: FAILED — ${(err as Error).message}`);
    }
  }

  if (failures > 0) {
    console.error(`[enrich] ${failures}/${sources.length} source(s) failed`);
    process.exit(1);
  }
  console.error(`[enrich] all ${sources.length} source(s) loaded`);
}

main().catch((err) => {
  console.error("[enrich] Fatal:", err);
  process.exit(2);
});
