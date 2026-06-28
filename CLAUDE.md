@AGENTS.md

# Claude Code — Session Rules

These supplement AGENTS.md (imported above).

## Read Discipline

- Start with **NEXT-WORK.md** for active tickets and DoD.
- Use **docs/DOCUMENT-SCHEMA.md** for the output contract and
  **fixtures/edge-cases.md** for what each fixture ABN guards.
- Read large files once; **grep before Read** when you need one value.

## crema dependency

`crema` is a sibling package wired via `file:../crema` (symlinked into
`node_modules/crema`). It's the pipeline spine — flatten engine, split, compress,
verify harness, download, metadata. **After changing crema, rebuild it**
(`npm run build` in `../crema`); long-black consumes its compiled `dist/`.
Do not duplicate crema's modules here.

## Branch Safety

Run `git branch --show-current` before your first commit. Never commit to `main`
of a shared remote without a branch + PR.

## Streaming & Memory

All Postgres reads are cursor-based (via crema's `streamFlatten`). Memory must
stay under 500 MB. The pre-commit hook rejects `sql.unsafe()` without `.cursor()`.
The COPY load path (`sql\`copy …\`.writable()`) is a distinct, allowed API.

## File Hygiene

- No temporary `.mjs`/`.js` workaround scripts.
- No empty (0-byte) files — the pre-commit hook rejects them.

## .gitignore Awareness

`*.ndjson` is git-ignored, but `fixtures/expected-output.ndjson` has a `!`
exception and IS committed (the regression baseline).
