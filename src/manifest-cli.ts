/**
 * long-black — manifest CLI: write a release manifest.json for an output dir.
 *
 *   LONG_BLACK_VERSION=2026.06.28 node dist/manifest-cli.js <outputDir>
 *
 * Reads metadata.json (per-state counts + version), checksums every per-state
 * NDJSON.gz shard (the canonical record files), and writes manifest.json via
 * crema's buildManifestV2. The all-ABN Parquet is a derived convenience asset
 * and is intentionally not a manifest source file (it would double the record
 * total). Pipeline provenance comes from the GitHub Actions env.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { buildManifestV2, type ManifestFile } from "crema";
import { SPLIT_PREFIX } from "./sources.js";
import { DEFAULT_VERSION } from "./cli.js";

function sha256(path: string): Promise<string> {
  return new Promise((res, rej) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => res(hash.digest("hex")))
      .on("error", rej);
  });
}

interface Metadata {
  version: string;
  counts: Record<string, number>;
}

async function main(): Promise<void> {
  const outputDir = process.argv[2] ?? "output";
  const version = process.env.LONG_BLACK_VERSION ?? DEFAULT_VERSION;

  const metadata = JSON.parse(
    readFileSync(resolve(outputDir, "metadata.json"), "utf-8"),
  ) as Metadata;

  const prefix = `${SPLIT_PREFIX}-${version}-`;
  const suffix = ".ndjson.gz";
  const shards = readdirSync(outputDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
    .sort();
  if (shards.length === 0) {
    throw new Error(`no per-state shards (${prefix}*${suffix}) in ${outputDir}`);
  }

  const files: ManifestFile[] = [];
  for (const name of shards) {
    const key = name.slice(prefix.length, -suffix.length); // the state bucket
    const records = metadata.counts[key];
    if (records == null) {
      throw new Error(`shard ${name} has no matching count for state "${key}" in metadata.json`);
    }
    const full = resolve(outputDir, name);
    files.push({ key: name, records, bytes: statSync(full).size, sha256: await sha256(full) });
  }

  const manifest = buildManifestV2({
    product: "abn",
    version,
    createdAt: new Date().toISOString(),
    pipeline: {
      repo: process.env.GITHUB_REPOSITORY ?? "jbejenar/long-black",
      commit: process.env.GITHUB_SHA ?? "local",
      run_id: process.env.GITHUB_RUN_ID ?? "local",
    },
    source: {
      name: "ABR ABN Bulk Extract",
      release: version,
      url: "https://data.gov.au/data/dataset/abn-bulk-extract",
    },
    files,
    sourceKeys: files.map((f) => f.key),
  });

  const out = resolve(outputDir, "manifest.json");
  writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  console.log(`[manifest] ${files.length} shard(s), ${manifest.total_records} records → ${out}`);
}

main().catch((err) => {
  console.error("[manifest] Fatal:", err);
  process.exit(1);
});
