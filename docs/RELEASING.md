# Releasing long-black

long-black publishes a fresh dataset monthly as a GitHub Release: one NDJSON
document per ABN, split per state and gzip-compressed, plus `metadata.json`.

## Cadence & versioning

- **Schedule:** `build.yml` runs on the 5th of each month (03:00 UTC). The ABR
  ABN Bulk Extract refreshes weekly, so any week's snapshot is current; a monthly
  artifact cadence avoids 52 sets/year.
- **`_version`** = the ABR extract date, `vYYYY.MM.DD` (e.g. `v2026.06.24`),
  derived from the CKAN resource `last_modified` (auto-discovered when the
  `version` input is blank). The schema suffix is the digits only (`abn_20260624`).
- **`schemaVersion`** (the output contract) is independent semver in
  `package.json`, bumped per the table below — not tied to the data version.

## What a release contains

- `long-black-<version>-<state>.ndjson.gz` — one file per state (`nsw`, `vic`,
  `qld`, `wa`, `sa`, `tas`, `act`, `nt`, plus `aat` for the Australian Antarctic
  Territory, and `other` for null/empty state). The ABR `StateEnum` is closed, so
  this bucket set is exhaustive.
- `long-black-<version>.parquet` — the all-ABN dataset as a single Parquet file
  (a derived convenience encoding; scalars are columns, nested fields are JSON
  strings). Not a manifest source file — it duplicates the NDJSON records.
- `metadata.json` — per-state counts, build timestamp, schema version, and the
  per-source CC-BY attribution (mostly 3.0 AU; the ATO R&D dataset is CC-BY 2.5 AU).
- `manifest.json` — the release provenance document (crema `buildManifestV2`,
  product `abn`): per-shard sha256 + record counts + the build pipeline
  (repo/commit/run). Its source files are the per-state NDJSON.gz shards, whose
  records sum to `total_records`; the Parquet is intentionally excluded so the
  total is counted once.

All assets are well under GitHub's 2 GB per-asset limit (largest state ≈ 308 MB).

The release notes carry a machine-readable `**<n>** businesses` line and a
per-state `| STATE | count |` table (emitted from `metadata.json` via `jq`). This
format is load-bearing: the catalogue (`src/catalogue.ts` `ABN_BRANDING`) parses
it back, so changing it requires updating the branding's `keyPattern`.

## Running a release

Scheduled monthly, or on demand:

```bash
# Auto-discover the current extract, build, and publish:
gh workflow run build.yml

# Pin a specific extract date and build a draft for review first:
gh workflow run build.yml -f version=2026.06.24 -f publish=false
```

The resolved version (from the `version` input or CKAN auto-discovery) is
validated against a strict `YYYY.MM.DD` pattern **before** it is reused in any
shell step, schema name, file name, or tag; a malformed value fails the build
early rather than flowing into a privileged step.

The build fails (and does **not** publish) if `verify` finds any issue — invalid
ABN checksum, schema violation, duplicate or out-of-order `_id` — because
`dist/cli.js` exits non-zero, aborting the `set -e` step before the release.

### Data completeness (the data must be complete before shipping)

A clean, schema-valid output is not sufficient: the join is across fifteen sources
of truth, and a silently-missing enrichment source would still produce valid (but
hollow) documents. Three gates make incompleteness fatal rather than invisible:

1. **Per-source load floor.** `enrich-cli` fails if any source loads fewer than
   its `minRows` (company / business-names 1,000,000, charities 20,000, AIS 20,000,
   AFS/credit licensees 1,000, banned orgs 5, AusTender suppliers 30,000, ATO
   tax-transparency 2,000, ATO R&D 5,000, ASIC AFS reps 50,000, ASIC credit reps
   5,000, WGEA 5,000, SMSF auditors 300 — ≈⅓ of the real volumes in
   `docs/PERFORMANCE.md`, except the tiny volatile banned register + niche SMSF
   auditors). Catches an empty/truncated or wrong-resource load.
2. **Enrichment required.** `build.yml` treats an enrichment failure as fatal — no
   silent partial release. A deliberate manual run may set
   `allow_partial_enrichment=true` to ship with a degraded source (which also
   disables gate 3); the scheduled monthly build never does.
3. **Output coverage gate.** After verify, `cli.js`
   (`LONG_BLACK_COVERAGE_PROFILE=production`) streams the output and fails unless
   each nested source populated at least its floor (`company` ≥ 1,000,000,
   `registeredBusinessNames` ≥ 1,000,000, `charity` ≥ 20,000, `charityFinancials`
   ≥ 20,000, `financialServicesLicence` ≥ 1,000, `creditLicence` ≥ 1,000,
   `bannedDisqualified` ≥ 5, `govSpend` ≥ 30,000, `taxTransparency` ≥ 2,000,
   `rdTaxIncentive` ≥ 5,000, `afsAuthorisedRep` ≥ 40,000, `creditRep` ≥ 5,000,
   `wgeaReporter` ≥ 3,000, `smsfAuditor` ≥ 300). Catches a broken join even when the
   load itself succeeded.

The fixture loop runs the same coverage gate at fixture scale
(`LONG_BLACK_COVERAGE_PROFILE=fixture` → each source ≥ 1 document), so a broken
join is caught in CI, not only in production.

### Anomaly gate (build-over-build)

Before publishing, `build.yml` downloads the prior published release's
`metadata.json` and runs `compare-cli` against the new build. A per-state or total
count that moved past the threshold (`compare_threshold`, default `0.25` = 25 %),
or a state appearing/retiring, **holds the release as a draft** for human review
(it does not block — the assets still upload, and the comparison reports are
attached as a workflow artifact). The first release (no prior) is a no-op. Run it
manually too:

```bash
node dist/compare-cli.js output/metadata.json prior-metadata.json --threshold 0.25
```

### Release identity + atomicity (one contract)

Publishing treats _release identity_ and _publication atomicity_ as a single
invariant, so a release can never point at a different source than the assets it
ships, and consumers never see a partial or changing public release:

- **The tag is the build commit.** New releases are created as a **draft pinned to
  `$GITHUB_SHA`** (`--target`), so the tag can't drift onto the moving default
  branch during the multi-hour build. If a tag of that name already exists at a
  _different_ commit, the build **refuses** (cut a new version for corrected data).
- **Atomic publish.** A new release is a draft until every expected asset is
  uploaded and **verified present with a nonzero size** (by exact name, not just a
  count); only then is it promoted (when `publish=true`). A mid-upload failure
  leaves an invisible draft — never a public release with missing files.
- **A live published release is never mutated.** Re-running a build whose tag is
  already published **fails** with a clear message: corrected data must go out
  under a **new version tag**, not by clobbering a live public dataset.
- **An existing _draft_** (e.g. from a prior `publish=false` run) is reused: it is
  retargeted to the current build commit, its assets are replaced and verified,
  then it is promoted per `publish`.

## Docker image

After a successful, **published** (non-draft) build, `build.yml` dispatches
`docker-publish.yml` with the exact tag it just released (`gh workflow run
docker-publish.yml -f tag=<tag>`). It is triggered explicitly with that tag — not
via `workflow_run` on "the latest release", which could image the wrong (previous)
release when a draft build completes. A draft build does not dispatch it.

The dispatch passes `expected_sha=$GITHUB_SHA`; `docker-publish.yml` checks out
long-black at the released tag and **asserts it resolves to that exact Build
commit** before imaging, so the image can only be built from the same source that
produced and verified the dataset. (Because the tag is pinned to the build commit
on every publish path, this assertion always holds for an automated release.)

`docker-publish.yml` then builds the image **locally** (`load: true`, not pushed),
smoke-tests that exact image with its in-container fixture build, and only then
tags + pushes the _same_ image to `ghcr.io/jbejenar/long-black:<version>`. The
`:latest` tag is moved **only when imaging the actual latest published release**,
so a manual re-image of an older tag can never clobber `:latest` with stale
source. A broken image never reaches GHCR. To image a published tag manually:

```bash
gh workflow run docker-publish.yml -f tag=v2026.06.24
# (optionally assert the source: -f expected_sha=<commit>)
```

## Catalogue (GitHub Pages)

`catalogue.yml` renders a static HTML catalogue of all published releases and
deploys it to GitHub Pages. It runs on `workflow_run` after a successful **Build**
(a `release: published` trigger would never fire — Actions suppresses release
events from GITHUB_TOKEN-created releases), plus manual `workflow_dispatch` for
backfills. Drafts and prereleases are excluded twice: the workflow exits early if
the latest release is a draft, and crema's `processReleases` filters them from the
API response. The page content (name, tagline, coffee accent, per-state counts) is
driven by `ABN_BRANDING` in `src/catalogue.ts`.

Regenerate manually (e.g. after editing a release):

```bash
gh workflow run catalogue.yml
```

The build-over-build comparison that gates publication is documented under
[Anomaly gate](#anomaly-gate-build-over-build) above.

## crema dependency pin

crema is a build dependency (`file:../crema`). `build.yml`, `docker-publish.yml`,
and `catalogue.yml` check it out at a **pinned git tag** via `env.CREMA_REF`
(currently `v0.3.0` — adds the generic catalogue/manifest/compare engines), not its
moving `main`, so a long-black release is reproducible and cannot change because
crema's default branch moved. When adopting a new crema:

1. Tag the reviewed crema commit (e.g. `git tag v0.3.0 && git push origin v0.3.0`).
2. Bump `env.CREMA_REF` in **all three** workflows to that tag in one PR.
3. Let CI build long-black against the new crema before merging.

## Schema versioning

The output schema is the contract. Change `src/schema.ts`,
`docs/DOCUMENT-SCHEMA.md`, and `fixtures/expected-output.ndjson` **together**.

| Change                                   | Version bump |
| ---------------------------------------- | ------------ |
| Add a nullable/optional field            | minor        |
| Remove or rename a field                 | major        |
| Change a field's type                    | major        |
| Fix a value bug (output changes, no API) | patch        |

## Local dry run

`./scripts/build-local.sh` runs the identical pipeline against a local Docker
Postgres (needs ~15 GB free disk for the extract); see `docs/PERFORMANCE.md` for
measured timings. The fixture loop (`./scripts/build-fixture-only.sh`) exercises
the pipeline shape in <30 s with no download.
