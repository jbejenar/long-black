/**
 * Unit tests for buildManifestForOutputDir (manifest-cli) — metadata.version is
 * canonical, env-version must match, and shards ↔ counts are checked both ways.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManifestForOutputDir } from "../../src/manifest-cli.js";
import { SPLIT_PREFIX } from "../../src/sources.js";

const VERSION = "2026.06.28";
const pipeline = { repo: "jbejenar/long-black", commit: "abc", run_id: "1" };

let dir: string;
function writeMeta(counts: Record<string, number>, version = VERSION): void {
  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);
  writeFileSync(join(dir, "metadata.json"), JSON.stringify({ version, counts, totalCount }));
}
function writeShard(state: string): void {
  writeFileSync(join(dir, `${SPLIT_PREFIX}-${VERSION}-${state}.ndjson.gz`), "gz-bytes");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lb-mani-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("buildManifestForOutputDir", () => {
  it("builds a manifest keyed on metadata.version with each shard counted once", async () => {
    writeMeta({ nsw: 100, vic: 50 });
    writeShard("nsw");
    writeShard("vic");
    const m = await buildManifestForOutputDir({ outputDir: dir, createdAt: "t", pipeline });
    expect(m.product).toBe("abn");
    expect(m.version).toBe(VERSION);
    expect(m.total_records).toBe(150);
    expect(m.files.map((f) => f.key).sort()).toEqual([
      `${SPLIT_PREFIX}-${VERSION}-nsw.ndjson.gz`,
      `${SPLIT_PREFIX}-${VERSION}-vic.ndjson.gz`,
    ]);
  });

  it("rejects a LONG_BLACK_VERSION that does not match metadata.version", async () => {
    writeMeta({ nsw: 100 });
    writeShard("nsw");
    await expect(
      buildManifestForOutputDir({
        outputDir: dir,
        envVersion: "2099.01.01",
        createdAt: "t",
        pipeline,
      }),
    ).rejects.toThrow(/does not match metadata.version/);
  });

  it("rejects a non-zero metadata bucket with no shard (partial/stale dir)", async () => {
    writeMeta({ nsw: 100, vic: 50 });
    writeShard("nsw"); // vic shard missing
    await expect(
      buildManifestForOutputDir({ outputDir: dir, createdAt: "t", pipeline }),
    ).rejects.toThrow(/bucket "vic" \(50 records\) has no matching shard/);
  });

  it("rejects a shard with no matching count", async () => {
    writeMeta({ nsw: 100 });
    writeShard("nsw");
    writeShard("qld"); // no qld count
    await expect(
      buildManifestForOutputDir({ outputDir: dir, createdAt: "t", pipeline }),
    ).rejects.toThrow(/no matching count for state "qld"/);
  });

  it("ignores a zero-count bucket that has no shard", async () => {
    writeMeta({ nsw: 100, aat: 0 });
    writeShard("nsw");
    const m = await buildManifestForOutputDir({ outputDir: dir, createdAt: "t", pipeline });
    expect(m.total_records).toBe(100);
  });
});
