# long-black — self-contained ABN data pipeline.
#
# crema is a sibling `file:../crema` dependency, so the build CONTEXT must be the
# PARENT directory (which contains both crema/ and long-black/):
#
#   cd /path/to/address && docker build -f long-black/Dockerfile -t long-black .
#
# Bundles: Postgres 16 + Node 22 + crema + long-black. One container in, NDJSON out.

# ---------------------------------------------------------------------------
# Stage 1: builder — compile crema, then long-black (needs devDependencies)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /build

# crema first (the dependency)
COPY crema/package.json crema/package-lock.json ./crema/
RUN cd crema && npm ci --ignore-scripts
COPY crema/ ./crema/
RUN cd crema && npm run build

# long-black (resolves crema via file:../crema)
COPY long-black/package.json long-black/package-lock.json ./long-black/
RUN cd long-black && npm ci --ignore-scripts
COPY long-black/ ./long-black/
RUN cd long-black && npm run build

# ---------------------------------------------------------------------------
# Stage 2: prod-deps — production-only node_modules (no typescript/eslint/vitest)
# ---------------------------------------------------------------------------
# A separate `npm ci --omit=dev` into a clean tree, rather than pruning the
# builder's: a prune/`--omit=dev` in the builder re-triggers crema's `prepare`
# (`tsc`, which also wipes the just-built dist) once its tooling is gone, so we
# install fresh with `--ignore-scripts` and graft the already-built dist on top.
FROM node:22-bookworm-slim AS proddeps
WORKDIR /prod

# crema: prod deps only. Drop its `prepare` (a tsc build) first — npm runs a
# file:-dependency's `prepare` when long-black installs it below, even under
# `--ignore-scripts`, and tsc isn't present in this prod stage. The built dist is
# grafted on from the builder, so crema never needs to compile here.
COPY crema/package.json crema/package-lock.json ./crema/
RUN cd crema && npm pkg delete scripts.prepare && npm ci --omit=dev --ignore-scripts
COPY --from=builder /build/crema/dist ./crema/dist

# long-black: prod deps only; resolves crema via file:../crema → ./crema (which
# now has no `prepare`, so installing it just links the prebuilt package).
COPY long-black/package.json long-black/package-lock.json ./long-black/
RUN cd long-black && npm ci --omit=dev --ignore-scripts

# ---------------------------------------------------------------------------
# Stage 3: runtime — Postgres + Node + the built pipeline (prod deps only)
# ---------------------------------------------------------------------------
FROM postgres:16-bookworm AS runtime
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates unzip \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# crema lives at /crema so long-black's node_modules/crema -> ../../crema resolves
# (prod-only deps + built dist, no dev tooling).
COPY --from=proddeps /prod/crema /crema
WORKDIR /app
COPY --from=builder /build/long-black/dist ./dist
COPY --from=proddeps /prod/long-black/node_modules ./node_modules
COPY long-black/package.json ./
COPY long-black/sql ./sql
COPY long-black/fixtures ./fixtures
COPY long-black/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

VOLUME ["/output", "/data"]
ENTRYPOINT ["/docker-entrypoint.sh"]
