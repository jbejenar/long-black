# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities privately via GitHub Security Advisories
on this repository. **Do not open a public issue** for security vulnerabilities.

## Scope

long-black is a data-transformation tool — it downloads public government data,
loads it into an ephemeral Postgres, and writes NDJSON. The primary concerns are:

- **Supply chain** — dependencies (managed via dependabot; `crema` is a sibling
  package).
- **Credential handling** — the pipeline uses a local/ephemeral Postgres only;
  no secrets are embedded. Any S3/release credentials come from CI secrets.
- **Output integrity** — every document is Zod-validated and the build is
  byte-for-byte regression-gated.

The data itself is public (CC-BY 3.0 AU) and contains no non-public PII —
sole-trader names are already published by the ABR.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |
| older   | No        |
