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
  `qld`, `wa`, `sa`, `tas`, `act`, `nt`, plus `other` for null/empty/`AAT` state).
- `metadata.json` — per-state counts, build timestamp, schema version, and the
  CC-BY 3.0 AU source attribution.

All assets are well under GitHub's 2 GB per-asset limit (largest state ≈ 308 MB).

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

## crema dependency pin

crema is a build dependency (`file:../crema`). Both `build.yml` and
`docker-publish.yml` check it out at a **pinned git tag** via `env.CREMA_REF`
(currently `v0.2.0` — adds `convertToParquet`), not its moving `main`, so a
long-black release is reproducible and cannot change because crema's default
branch moved. When adopting a new crema:

1. Tag the reviewed crema commit (e.g. `git tag v0.2.0 && git push origin v0.2.0`).
2. Bump `env.CREMA_REF` in **both** workflows to that tag in one PR.
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
