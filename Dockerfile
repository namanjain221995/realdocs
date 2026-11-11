# syntax=docker/dockerfile:1
#
# RealtimeDocs server image: Fastify API + collaboration endpoint + built web app.
#
#   docker build -t realtimedocs .                          full product (default target)
#   docker build -t realtimedocs-api --target server-runtime .   API and collaboration only
#
# The server and CLI are bundled into dist/, so the runtime image carries no
# node_modules and no build tooling.

# The Node.js release of the pinned development toolchain (scripts/dev-env.sh),
# so the image runs exactly what the test suites ran.
ARG NODE_VERSION=24.22.2

FROM node:${NODE_VERSION}-trixie-slim AS base
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
ENV PATH=$PNPM_HOME:$PATH
# pnpm comes from Corepack in the version pinned by package.json ("packageManager").
RUN corepack enable
WORKDIR /repo

# ── Dependencies (cached while manifests and the lockfile do not change) ─────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/editor/package.json packages/editor/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=realtimedocs-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile \
      --filter @realtimedocs/server... \
      --filter @realtimedocs/web...

FROM deps AS source
COPY tsconfig.base.json ./
COPY packages ./packages

# ── Server bundle ────────────────────────────────────────────────────────────
FROM source AS server-build
# Only what the bundle is made of (no tests, no local scratch files).
COPY apps/server/build.mjs apps/server/tsconfig.json ./apps/server/
COPY apps/server/src ./apps/server/src
RUN pnpm --filter @realtimedocs/server run build

# ── Web application ──────────────────────────────────────────────────────────
FROM source AS web-build
# The in-app document reader bundles these pages at build time (`?raw` imports).
COPY README.md ./
COPY docs/windows-client.md docs/macos-client.md docs/security.md ./docs/
COPY apps/web ./apps/web
RUN pnpm --filter @realtimedocs/web run build

# ── Runtime without the web app (API + collaboration) ────────────────────────
FROM node:${NODE_VERSION}-trixie-slim AS server-runtime
ENV NODE_ENV=production \
    RD_HOST=0.0.0.0 \
    RD_PORT=4310 \
    ASSET_DIR=/data/assets
WORKDIR /app
# Operator commands: `docker compose exec server realtimedocs <command>`.
RUN printf '#!/bin/sh\nexec node --enable-source-maps /app/server/dist/cli.js "$@"\n' \
      > /usr/local/bin/realtimedocs \
 && chmod 0755 /usr/local/bin/realtimedocs \
 && mkdir -p /data/assets \
 && chown -R node:node /data
COPY --from=server-build /repo/apps/server/dist ./server/dist
COPY apps/server/migrations ./server/migrations
COPY apps/server/assets ./server/assets
# Unprivileged user (uid 1000) from the base image.
USER node
VOLUME ["/data/assets"]
EXPOSE 4310
HEALTHCHECK --interval=15s --timeout=4s --start-period=30s --start-interval=2s --retries=4 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.RD_PORT || 4310) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "server/dist/main.js"]

# ── Full product ─────────────────────────────────────────────────────────────
FROM server-runtime AS runtime
ENV WEB_DIST_DIR=/app/web
COPY --from=web-build /repo/apps/web/dist ./web
