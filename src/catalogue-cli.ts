/**
 * long-black — catalogue CLI: generate the static HTML release catalogue.
 *
 *   node dist/catalogue-cli.js --repo owner/repo [--out dist/catalogue/index.html]
 *
 * GITHUB_TOKEN (optional) raises the GitHub API rate limit.
 */

import { runCatalogue } from "./catalogue.js";

function parseArgs(argv: string[]): { repo: string; outPath: string } {
  let repo = "";
  let outPath = "dist/catalogue/index.html";
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--repo" && argv[i + 1]) repo = argv[++i];
    else if (argv[i] === "--out" && argv[i + 1]) outPath = argv[++i];
  }
  if (!repo) throw new Error("--repo owner/repo is required");
  return { repo, outPath };
}

async function main(): Promise<void> {
  const { repo, outPath } = parseArgs(process.argv);
  const now = new Date().toISOString().split("T")[0];
  const { releases } = await runCatalogue({
    repo,
    outPath,
    token: process.env.GITHUB_TOKEN,
    now,
  });
  console.log(`[catalogue] ${releases} release(s) → ${outPath}`);
}

main().catch((err) => {
  console.error("[catalogue] Fatal:", err);
  process.exit(1);
});
