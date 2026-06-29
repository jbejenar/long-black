/**
 * long-black — compare CLI: build-over-build anomaly check.
 *
 *   node dist/compare-cli.js <current-metadata.json> <prior-metadata.json> [--threshold 1.0]
 *
 * Prints + writes a markdown/JSON report. Exit 2 if any per-state or total count
 * moved by more than the threshold (or a state appeared/retired) — the release
 * workflow keeps such a build as a draft for human review.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { compareMetadata, formatComparisonReport, type BuildMetadata } from "crema";

function main(): void {
  const currentPath = process.argv[2];
  const priorPath = process.argv[3];
  if (!currentPath || !priorPath) {
    console.error(
      "Usage: node dist/compare-cli.js <current-metadata.json> <prior-metadata.json> [--threshold 1.0]",
    );
    process.exit(1);
  }
  const ti = process.argv.indexOf("--threshold");
  const threshold = ti !== -1 ? parseFloat(process.argv[ti + 1]) : 1.0;

  const current = JSON.parse(readFileSync(currentPath, "utf-8")) as BuildMetadata;
  const prior = JSON.parse(readFileSync(priorPath, "utf-8")) as BuildMetadata;

  const result = compareMetadata(current, prior, threshold);
  const markdown = formatComparisonReport(result, { noun: "businesses", keyLabel: "State" });
  console.log(markdown);

  const base = `comparison-${result.currentVersion}-vs-${result.priorVersion}`;
  writeFileSync(`${base}.md`, markdown, "utf-8");
  writeFileSync(`${base}.json`, JSON.stringify(result, null, 2), "utf-8");
  console.log(`\nReports written: ${base}.md, ${base}.json`);

  if (result.hasAnomalies) {
    console.error("\n⚠️  Anomalies detected — review before publishing.");
    process.exit(2);
  }
}

main();
