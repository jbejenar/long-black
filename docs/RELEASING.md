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

### Re-running an existing tag (non-destructive)

The publish step never deletes a release or tag before its replacement exists:

- **New tag** → a release is created (draft when `publish=false`).
- **Existing draft** → its assets are clobbered in place and it moves to whatever
  `publish` requests.
- **Existing _published_ release** → refused unless you pass `replace_existing=true`;
  even then the assets are clobbered in place and the release is **never**
  downgraded to a draft. This protects a public dataset from being removed by a
  re-run or a network failure mid-replacement.

```bash
# Replace the assets of an already-published release (rare; opt-in):
gh workflow run build.yml -f version=2026.06.24 -f replace_existing=true
```

## Docker image

After a successful, **published** (non-draft) build, `build.yml` dispatches
`docker-publish.yml` with the exact tag it just released (`gh workflow run
docker-publish.yml -f tag=<tag>`). It is triggered explicitly with that tag — not
via `workflow_run` on "the latest release", which could image the wrong (previous)
release when a draft build completes. A draft build does not dispatch it.

`docker-publish.yml` checks out long-black at the released tag, builds the image
**locally** (`load: true`, not pushed), smoke-tests that exact image with its
in-container fixture build, and only then tags + pushes the _same_ image to
`ghcr.io/jbejenar/long-black:<version>` + `:latest`. A broken image therefore
never reaches GHCR. To image a published tag manually:

```bash
gh workflow run docker-publish.yml -f tag=v2026.06.24
```

## crema dependency pin

crema is a build dependency (`file:../crema`). Both `build.yml` and
`docker-publish.yml` check it out at a **pinned git tag** via `env.CREMA_REF`
(currently `v0.1.0`), not its moving `main`, so a long-black release is
reproducible and cannot change because crema's default branch moved. When
adopting a new crema:

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
