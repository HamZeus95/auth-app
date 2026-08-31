# syntax=docker/dockerfile:1

# Builds the whole app into one image: Hono serves the API and the compiled
# React bundle from the same origin, on a single port.

# ---- deps: full install, used to compile ------------------------------------
FROM oven/bun:1 AS deps
WORKDIR /app

# Only the manifests, so this layer is cached until a dependency actually
# changes. Every workspace manifest is needed for bun to resolve `workspace:*`.
COPY package.json bun.lock ./
COPY server/package.json ./server/
COPY client/package.json ./client/
COPY shared/package.json ./shared/

# `--ignore-scripts` because the root postinstall runs `turbo build`, and the
# sources it compiles have not been copied yet.
# `--network-concurrency` is capped because bun's default of 48 corrupts
# tarballs ("integrity check failed") over BuildKit's network on this host.
# Build with `--network=host`; see AUTH.md.
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --network-concurrency=8 --frozen-lockfile --ignore-scripts

# ---- build: compile shared, server, and the client bundle -------------------
FROM deps AS build
WORKDIR /app

COPY tsconfig.json turbo.json ./
COPY shared ./shared
COPY server ./server
COPY client ./client

# Empty = same origin, so the bundle calls whatever host it was served from
# instead of a baked-in localhost:3000. `.dockerignore` keeps client/.env out,
# which would otherwise override this with the dev value.
ENV VITE_SERVER_URL=""

RUN bun run build

# ---- prod-deps: runtime dependencies only -----------------------------------
FROM oven/bun:1 AS prod-deps
WORKDIR /app

COPY package.json bun.lock ./
COPY server/package.json ./server/
COPY client/package.json ./client/
COPY shared/package.json ./shared/

RUN --mount=type=cache,target=/root/.bun/install/cache bun install --network-concurrency=8 --frozen-lockfile --ignore-scripts --production

# ---- runtime ----------------------------------------------------------------
FROM oven/bun:1-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# node_modules holds the workspace symlinks (shared -> ../shared), so the
# package.json + dist of each workspace must land where they point.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

# The base image ships an unprivileged `bun` user; don't run the API as root.
USER bun

EXPOSE 3000

# Fails fast if the process is up but not serving (e.g. Postgres unreachable).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "const r = await fetch('http://localhost:' + (Bun.env.PORT ?? 3000) + '/health'); process.exit(r.ok ? 0 : 1)"

CMD ["bun", "run", "start"]
