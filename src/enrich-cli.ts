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
import { downloadGovSpend, loadGovSpend } from "./gov-spend.js";
import { XLSX_SOURCES, downloadXlsxSource, loadXlsxSource } from "./xlsx-sources.js";
import { downloadGovGrants, loadGovGrants } from "./gov-grants.js";

/**
 * AusTender government spend is loaded by a dedicated JSON-aggregation step (not a
 * CSV COPY), so it sits alongside the CSV sources rather than in ENRICHMENT_SOURCES.
 * Its key/label/floor mirror the CSV-source shape so the orchestration is uniform.
 */
const GOV_SPEND_KEY = "gov_spend";
const GOV_SPEND_LABEL = "AusTender government spend";
const GOV_SPEND_MIN_ROWS = 30_000; // distinct supplier ABNs, all history (~14k/year)

/**
 * GrantConnect grant awards — a dedicated authenticated report download
 * (src/gov-grants.ts), so like gov-spend it sits alongside the CSV sources. It needs
 * a registered-user login: GRANTCONNECT_USERNAME / GRANTCONNECT_PASSWORD (repo secrets
 * in CI). Absent creds → the source is skipped (a credless local/fixture build), which
 * the production coverage gate then catches; present creds → it must clear the floor.
 */
const GOV_GRANTS_KEY = "gov_grants";
const GOV_GRANTS_LABEL = "GrantConnect grant awards";
const GOV_GRANTS_MIN_ROWS = 15_000; // distinct recipient ABNs, all history

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL ?? DEFAULT_DB_URL;
  const version = process.env.LONG_BLACK_VERSION ?? DEFAULT_VERSION;
  const schemaVersion = deriveSchemaVersion(version);
  const dataDir = process.env.DATA_DIR ?? "data";

  const xlsxKeys = XLSX_SOURCES.map((s) => s.key);
  const validKeys = [
    ...ENRICHMENT_SOURCES.map((s) => s.key),
    GOV_SPEND_KEY,
    GOV_GRANTS_KEY,
    ...xlsxKeys,
  ];
  const requested = process.argv.slice(2);
  const unknown = requested.filter((k) => !validKeys.includes(k));
  if (unknown.length > 0) {
    console.error(`[enrich] unknown source key(s): ${unknown.join(", ")}`);
    console.error(`[enrich] valid keys: ${validKeys.join(", ")}`);
    process.exit(2);
  }
  const sources: EnrichmentSource[] =
    requested.length === 0
      ? ENRICHMENT_SOURCES
      : ENRICHMENT_SOURCES.filter((s) => requested.includes(s.key));
  const runGovSpend = requested.length === 0 || requested.includes(GOV_SPEND_KEY);
  const gcUser = process.env.GRANTCONNECT_USERNAME;
  const gcPass = process.env.GRANTCONNECT_PASSWORD;
  const gcExplicit = requested.includes(GOV_GRANTS_KEY); // named directly on the CLI
  const gcRequested = requested.length === 0 || gcExplicit; // all-sources run or explicit
  const gcHasCreds = Boolean(gcUser && gcPass);
  const runGovGrants = gcRequested && gcHasCreds;
  const xlsxSources =
    requested.length === 0 ? XLSX_SOURCES : XLSX_SOURCES.filter((s) => requested.includes(s.key));
  // Count grant awards whenever requested — running OR required-but-uncredentialed —
  // so the total is honest and a missing-creds all-sources run registers as a failure.
  const totalSources =
    sources.length + (runGovSpend ? 1 : 0) + (gcRequested ? 1 : 0) + xlsxSources.length;

  // An explicit single/multi-source request that names gov_grants but has no creds is a
  // usage error → hard exit (nothing to fall back to).
  if (gcExplicit && !gcHasCreds) {
    console.error(
      `[enrich] ${GOV_GRANTS_LABEL}: FAILED — GRANTCONNECT_USERNAME/PASSWORD not set (required for this source)`,
    );
    process.exit(2);
  }

  let failures = 0;
  // In an all-sources run without creds, grant awards is a REQUIRED source that did not
  // load → count it as a failure so `enrich-cli` exits non-zero. The build wrapper then
  // decides consistently: abort by default, or (with allow_partial_enrichment=true)
  // disable the coverage gate and ship degraded — the documented emergency path. Never
  // a silent success that leaves the coverage gate to fail an intentional partial run.
  if (gcRequested && !gcHasCreds) {
    failures++;
    console.error(
      `[enrich] ${GOV_GRANTS_LABEL}: FAILED — no GrantConnect creds (set GRANTCONNECT_USERNAME/PASSWORD, or allow_partial_enrichment to ship without grants)`,
    );
  }
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

  if (runGovSpend) {
    try {
      console.error(`[enrich] ${GOV_SPEND_LABEL}: downloading…`);
      const file = await downloadGovSpend(dataDir);
      console.error(`[enrich] ${GOV_SPEND_LABEL}: aggregating ${file}…`);
      const inserted = await loadGovSpend({ connectionString, schemaVersion, file });
      if (inserted < GOV_SPEND_MIN_ROWS) {
        failures++;
        console.error(
          `[enrich] ${GOV_SPEND_LABEL}: FAILED — only ${inserted} ABN(s), below floor ${GOV_SPEND_MIN_ROWS} (incomplete source)`,
        );
      } else {
        console.log(`[enrich] ${GOV_SPEND_LABEL}: ${inserted} ABN(s) → ${GOV_SPEND_KEY}`);
      }
    } catch (err) {
      failures++;
      console.error(`[enrich] ${GOV_SPEND_LABEL}: FAILED — ${(err as Error).message}`);
    }
  }

  if (runGovGrants) {
    try {
      console.error(`[enrich] ${GOV_GRANTS_LABEL}: logging in + downloading (all history)…`);
      const endIso = version.replace(/\./g, "-"); // build date = report range end
      const { aggregate, totalRows } = await downloadGovGrants({
        dataDir,
        username: gcUser as string,
        password: gcPass as string,
        endIso,
        log: (m) => console.error(`[enrich]   ${m}`),
      });
      const inserted = await loadGovGrants({ connectionString, schemaVersion, aggregate });
      if (inserted < GOV_GRANTS_MIN_ROWS) {
        failures++;
        console.error(
          `[enrich] ${GOV_GRANTS_LABEL}: FAILED — only ${inserted} ABN(s), below floor ${GOV_GRANTS_MIN_ROWS} (incomplete source)`,
        );
      } else {
        console.log(
          `[enrich] ${GOV_GRANTS_LABEL}: ${totalRows} awards → ${inserted} ABN(s) → ${GOV_GRANTS_KEY}`,
        );
      }
    } catch (err) {
      failures++;
      console.error(`[enrich] ${GOV_GRANTS_LABEL}: FAILED — ${(err as Error).message}`);
    }
  }

  for (const source of xlsxSources) {
    try {
      console.error(`[enrich] ${source.label}: downloading…`);
      const file = await downloadXlsxSource(source, dataDir);
      console.error(`[enrich] ${source.label}: parsing ${file}…`);
      const inserted = await loadXlsxSource({ connectionString, schemaVersion, source, file });
      if (inserted < source.minRows) {
        failures++;
        console.error(
          `[enrich] ${source.label}: FAILED — only ${inserted} row(s), below floor ${source.minRows} (incomplete source)`,
        );
      } else {
        console.log(`[enrich] ${source.label}: ${inserted} row(s) → ${source.key}`);
      }
    } catch (err) {
      failures++;
      console.error(`[enrich] ${source.label}: FAILED — ${(err as Error).message}`);
    }
  }

  if (failures > 0) {
    console.error(`[enrich] ${failures}/${totalSources} source(s) failed`);
    process.exit(1);
  }
  console.error(`[enrich] all ${totalSources} source(s) loaded`);
}

main().catch((err) => {
  console.error("[enrich] Fatal:", err);
  process.exit(2);
});
