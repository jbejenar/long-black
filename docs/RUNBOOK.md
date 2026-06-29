# Operational Runbook — long-black

## Overview

`build.yml` (monthly cron or `workflow_dispatch`) runs the full pipeline on a
disk-freed `ubuntu-latest` runner against a `postgres:16` service:

1. **download** the ABR ABN Bulk Extract (2 ZIPs → ~13 GB of XML)
2. **load** via streaming saxes → COPY into the `abn` staging table
3. **finalize** — add the primary key + indexes
4. **flatten + verify** — cursor-stream to NDJSON, validate every document
5. **output** — split per state, gzip, write `metadata.json`
6. **release** — publish the assets as a GitHub Release

A published build then dispatches `docker-publish.yml`, which builds the runtime
image, smoke-tests it, and only then pushes it to GHCR.

## Monitoring

```bash
gh run list --workflow build.yml
gh run view <run-id> --log
gh run view <run-id> --log-failed   # just the failed step
```

## Failure scenarios

### 1. Download / discovery failure

- **Symptoms:** the download step errors (CKAN 5xx, `ETIMEDOUT`, `fetch failed`),
  or "no ZIP resources found for package".
- **Diagnosis:** data.gov.au outage, or the `abn-bulk-extract` package changed
  shape. Check `curl https://data.gov.au/data/api/3/action/package_show?id=abn-bulk-extract`.
- **Resolution:** transient → re-run the workflow. Persistent → confirm the
  package id / ZIP resources in `src/sources.ts`.

### 2. Load failure (COPY / XML parse)

- **Symptoms:** the load step rejects with an XML parse error or a COPY error.
- **Diagnosis:** malformed/truncated download, or an ABR structural change.
  saxes throws on malformed XML, so the load rejects promptly (it does not hang).
- **Resolution:** re-run (re-downloads). If structural, update `src/load.ts` +
  the parser golden-record test against a sample `<ABR>`.

### 3. Flatten / verify failure

- **Symptoms:** `dist/cli.js` exits 3; `[verify] FAIL` with `schema:`/`dup:`/
  `checks:` counts; or `RangeError: Set maximum size exceeded`.
- **Diagnosis:** a real data/contract problem (checksum, schema, duplicate id),
  **or** the verify ran without `idsSorted` past ~16.7M docs (the id Set hits
  V8's cap). long-black passes `idsSorted: true` because `abn_full.sql` emits
  `ORDER BY abn`; if that ORDER BY is ever removed, verify will (correctly) report
  `orderViolations`.
- **Resolution:** reproduce locally with `build-local.sh`; inspect the sampled
  issues the verify prints. A genuine contract change means updating the schema +
  fixture together (see RELEASING.md).

### 4. Disk exhaustion

- **Symptoms:** "no space left on device" during download/load.
- **Diagnosis:** the ~13 GB extract plus Postgres data exceeds the runner disk.
  The build frees ~30 GB up front (removing preinstalled .NET/Android/etc.).
- **Resolution:** if it still doesn't fit, run on a larger/self-hosted runner.

### 5. Release creation failure

- **Symptoms:** the publish step fails (permission, asset too big), or aborts with
  "release `<tag>` is already PUBLISHED; refusing to overwrite".
- **Diagnosis:** the job has `contents: write`. The step is **non-destructive** —
  it never deletes a release/tag. A new tag is created; an existing draft is
  clobbered in place; an existing _published_ release is refused unless the run
  set `replace_existing=true`. Per-state files are < 2 GB.
- **Resolution:** re-runs are safe (assets clobber in place). To intentionally
  replace a published release, re-run with `-f replace_existing=true`. Inspect
  `gh release view <tag>`.

### 6. Docker publish failure

- **Symptoms:** `docker-publish.yml` fails at the build, smoke-test, or push step,
  or aborts with "release `<tag>` is a draft / not found".
- **Diagnosis:** the image is built locally and smoke-tested **before** any push,
  so a smoke-test failure means **nothing was pushed to GHCR** (no bad `latest`).
  A push failure is usually GHCR auth (`packages: write` + `GITHUB_TOKEN`). It only
  images a published tag (a draft is refused).
- **Resolution:** re-run `docker-publish.yml -f tag=<tag>` for a published tag.
  Reproduce locally: `docker build -f long-black/Dockerfile -t long-black ..` then
  `docker run --rm -v "$PWD/out:/output" long-black`.

## Manual operations

```bash
# Re-run a build for a specific extract, as a draft:
gh workflow run build.yml -f version=2026.06.24 -f publish=false

# Publish a draft after review:
gh release edit v2026.06.24 --draft=false

# Image a release manually:
gh workflow run docker-publish.yml -f tag=v2026.06.24

# Full local build (needs Docker + ~15 GB disk):
LONG_BLACK_VERSION=2026.06.24 ./scripts/build-local.sh
```

## Reference

| Need              | Where                                |
| ----------------- | ------------------------------------ |
| Release procedure | `docs/RELEASING.md`                  |
| Timings / memory  | `docs/PERFORMANCE.md`                |
| Output contract   | `docs/DOCUMENT-SCHEMA.md`            |
| Data sources      | `docs/DATA-SOURCES.md`               |
| Pipeline source   | `src/` + `sql/`; CLIs in `dist/*.js` |
