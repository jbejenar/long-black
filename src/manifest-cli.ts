/**
 * long-black — manifest CLI: write a release manifest.json for an output dir.
 *
 *   LONG_BLACK_VERSION=2026.06.28 node dist/manifest-cli.js <outputDir>
 *
 * Reads metadata.json (per-state counts + version), checksums every per-state
 * NDJSON.gz shard (the canonical record files), and writes manifest.json via
 * crema's buildManifestV2. The full all-ABN `all.ndjson.gz` is a derived bundle
 * (a concatenation of these shards) published only to the S3 mirror — the mirror
 * adds it to the S3 manifest as an aggregate file, excluded from the record total
 * so the count is not doubled. Pipeline provenance comes from the GitHub Actions env.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { buildManifestV2, type ManifestFile, type ManifestV2 } from "crema";
import { SPLIT_PREFIX } from "./sources.js";

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

/**
 * Build the release manifest for an output dir. `metadata.version` is the
 * canonical version: the shards, counts, and manifest must all describe the same
 * build. `envVersion` (LONG_BLACK_VERSION), when given, must match it exactly —
 * a guard against a stale env pointing at another version's shards in a reused
 * output dir. The shard ↔ metadata.counts relationship is checked both ways so a
 * partial/stale dir can't yield a plausible-but-wrong manifest.
 */
export async function buildManifestForOutputDir(options: {
  outputDir: string;
  envVersion?: string;
  createdAt: string;
  pipeline: { repo: string; commit: string; run_id: string };
}): Promise<ManifestV2> {
  const { outputDir, envVersion, createdAt, pipeline } = options;

  const metadata = JSON.parse(
    readFileSync(resolve(outputDir, "metadata.json"), "utf-8"),
  ) as Metadata;

  const version = metadata.version;
  if (envVersion != null && envVersion !== version) {
    throw new Error(
      `LONG_BLACK_VERSION="${envVersion}" does not match metadata.version="${version}" in ${outputDir}`,
    );
  }

  const prefix = `${SPLIT_PREFIX}-${version}-`;
  const suffix = ".ndjson.gz";
  const shards = readdirSync(outputDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
    .sort();
  if (shards.length === 0) {
    throw new Error(`no per-state shards (${prefix}*${suffix}) in ${outputDir}`);
  }

  const files: ManifestFile[] = [];
  const shardKeys = new Set<string>();
  for (const name of shards) {
    const key = name.slice(prefix.length, -suffix.length); // the state bucket
    const records = metadata.counts[key];
    if (records == null) {
      throw new Error(`shard ${name} has no matching count for state "${key}" in metadata.json`);
    }
    shardKeys.add(key);
    const full = resolve(outputDir, name);
    files.push({ key: name, records, bytes: statSync(full).size, sha256: await sha256(full) });
  }

  // Bidirectional: every non-zero metadata bucket must have a shard, so a
  // partial/stale output dir (missing a state's file) can't pass.
  for (const [key, count] of Object.entries(metadata.counts)) {
    if (count > 0 && !shardKeys.has(key)) {
      throw new Error(
        `metadata bucket "${key}" (${count} records) has no matching shard in ${outputDir}`,
      );
    }
  }

  return buildManifestV2({
    product: "abn",
    version,
    createdAt,
    pipeline,
    source: {
      name: "ABR ABN Bulk Extract",
      release: version,
      url: "https://data.gov.au/data/dataset/abn-bulk-extract",
    },
    files,
    sourceKeys: files.map((f) => f.key),
  });
}

async function main(): Promise<void> {
  const outputDir = process.argv[2] ?? "output";
  const manifest = await buildManifestForOutputDir({
    outputDir,
    envVersion: process.env.LONG_BLACK_VERSION,
    createdAt: new Date().toISOString(),
    pipeline: {
      repo: process.env.GITHUB_REPOSITORY ?? "jbejenar/long-black",
      commit: process.env.GITHUB_SHA ?? "local",
      run_id: process.env.GITHUB_RUN_ID ?? "local",
    },
  });

  const out = resolve(outputDir, "manifest.json");
  writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  console.log(
    `[manifest] ${manifest.files.length} shard(s), ${manifest.total_records} records → ${out}`,
  );
}

const isEntry = process.argv[1] != null && resolve(process.argv[1]).endsWith("manifest-cli.js");
if (isEntry) {
  main().catch((err) => {
    console.error("[manifest] Fatal:", err);
    process.exit(1);
  });
}
