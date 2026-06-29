/**
 * long-black — download CLI: fetch + extract the ABN Bulk Extract, print the
 * extracted *.xml paths (one per line) for the build script to capture.
 *
 *   DATA_DIR=data node dist/download-cli.js
 */

import { downloadAbnExtract } from "./sources.js";

async function main(): Promise<void> {
  const dataDir = process.env.DATA_DIR ?? "data";
  const files = await downloadAbnExtract(dataDir);
  for (const file of files) console.log(file);
  console.error(`[download] ${files.length} XML file(s) extracted to ${dataDir}`);
}

main().catch((err) => {
  console.error("[download] Fatal:", err);
  process.exit(2);
});
