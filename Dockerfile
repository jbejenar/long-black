# long-black — self-contained ABN data pipeline.
#
# crema is a sibling `file:../crema` dependency, so the build CONTEXT must be the
# PARENT directory (which contains both crema/ and long-black/):
#
#   cd /path/to/address && docker build -f long-black/Dockerfile -t long-black .
#
# Bundles: Postgres 16 + Node 22 + crema + long-black. One container in, NDJSON out.

# ---------------------------------------------------------------------------
# Stage 1: build crema, then long-black
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
# Stage 2: runtime — Postgres + Node + the built pipeline
# ---------------------------------------------------------------------------
FROM postgres:16-bookworm AS runtime
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates unzip \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# crema lives at /crema so long-black's node_modules/crema -> ../../crema resolves.
COPY --from=builder /build/crema /crema
WORKDIR /app
COPY --from=builder /build/long-black/dist ./dist
COPY --from=builder /build/long-black/node_modules ./node_modules
COPY long-black/package.json ./
COPY long-black/sql ./sql
COPY long-black/fixtures ./fixtures
COPY long-black/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

VOLUME ["/output", "/data"]
ENTRYPOINT ["/docker-entrypoint.sh"]
