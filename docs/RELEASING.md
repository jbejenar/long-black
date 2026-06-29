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

The build fails (and does **not** publish) if `verify` finds any issue — invalid
ABN checksum, schema violation, duplicate or out-of-order `_id` — because
`dist/cli.js` exits non-zero, aborting the `set -e` step before the release.

## Docker image

`docker-publish.yml` chains off a successful **Build** (via `workflow_run` —
releases created with `GITHUB_TOKEN` do not fire `release`/`push` events) and
pushes `ghcr.io/jbejenar/long-black:<version>` + `:latest`, then smoke-tests the
image with its in-container fixture build. To image a tag manually:

```bash
gh workflow run docker-publish.yml -f tag=v2026.06.24
```

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
