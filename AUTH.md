# Auth

JWT auth with a short-lived **access token** and a rotating **refresh token**, backed by the
`auth-app-pg` Postgres container.

## Running it

```bash
bun db:up && bun db:seed && bun dev
```

Client on http://localhost:5173, server on http://localhost:3000.

## Seeded users

| Email | Password |
| --- | --- |
| alice@example.com | password123 |
| bob@example.com | password456 |

`bun db:seed` is idempotent — re-running it resets these two users' names and passwords rather
than failing on the unique email constraint.

## How the two tokens work

**Access token** — a 15-minute JWT signed with `ACCESS_TOKEN_SECRET`. Returned in the login
response body and held **in memory only** on the client, so an XSS bug can't read it back out of
`localStorage`. Sent as `Authorization: Bearer <token>` on protected requests.

**Refresh token** — a 7-day JWT signed with a *separate* `REFRESH_TOKEN_SECRET`, delivered as an
`httpOnly` cookie so JavaScript can never touch it. Every issued token is also recorded in the
`refresh_tokens` table as a SHA-256 hash, which buys two things a plain JWT can't do:

- **Revocation.** Logout marks the row revoked, so the token dies immediately instead of staying
  valid until its `exp`.
- **Rotation.** `/auth/refresh` revokes the presented token as it issues a new one. A replayed or
  stolen token stops working the moment the real client refreshes.

Storing only the hash means a database leak doesn't hand out usable tokens.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/login` | — | Email + password → access token, sets refresh cookie |
| POST | `/auth/refresh` | refresh cookie | Rotates the refresh token, returns a new access token |
| POST | `/auth/logout` | refresh cookie | Revokes the refresh token and clears the cookie |
| GET | `/auth/me` | access token | Current user from the token claims |
| GET | `/protected/secret` | access token | Example protected resource |

Login returns the same `401 Invalid email or password` for an unknown email as for a wrong
password, so the endpoint doesn't leak which accounts exist. Passwords are hashed with
`Bun.password` (argon2id).

## Client behaviour

`client/src/lib/api.ts` wraps `fetch`:

- A `401` triggers one refresh, then replays the original request — an expired access token is
  invisible to the UI.
- Concurrent 401s share a single in-flight refresh, so parallel requests can't rotate the token
  out from under each other.
- On page load the access token is gone (memory only), so `AuthProvider` trades the surviving
  refresh cookie for a fresh session before rendering — that's what keeps you logged in across
  reloads.
- A background timer refreshes every 10 minutes, ahead of the 15-minute expiry.

## Layout

```
server/src/
  env.ts         validated config
  db.ts          postgres client + migrate()
  tokens.ts      sign/verify/rotate/revoke
  middleware.ts  requireAuth
  auth.ts        /auth routes
  seed.ts        the two demo users
client/src/
  lib/api.ts     fetch wrapper, in-memory token, auto-refresh
  lib/auth.tsx   AuthProvider / useAuth
  routes/        login, dashboard (protected), index redirect
shared/src/types/  User, LoginRequest, AuthResponse
```

## Config

`server/.env` (see `.env.example`; secrets are generated dev values):

```
DATABASE_URL="postgres://postgres:devpass@localhost:5434/app"
ACCESS_TOKEN_SECRET=...
REFRESH_TOKEN_SECRET=...
CLIENT_URL="http://localhost:5173"
PORT=3000
```

`CLIENT_URL` is the CORS origin — it must be exact (not `*`) because the refresh cookie requires
`credentials: true`. The cookie is marked `secure` when `NODE_ENV=production`, so deploy over
HTTPS. Generate real secrets with `openssl rand -hex 32`.

Tables are created on server boot via `migrate()`, so no migration step is needed to get started.

## Docker — running the whole app

One command builds the image and starts the container:

```bash
bun run app
```

Then open **http://localhost:3001** — that's the React app, not just the API. It starts the
database, builds, replaces the container, waits for health, and seeds the two users.
`bun run app:logs` follows logs, `bun run app:stop` removes the container.

The image serves **both halves from one origin**: Hono handles `/auth/*`, `/protected/*` and
`/health`, and everything else falls through to the compiled Vite bundle in `client/dist`, with
unknown paths returning `index.html` so client routes like `/dashboard` survive a refresh. One
origin means no CORS on the refresh cookie.

The client bundle is built with `VITE_SERVER_URL=""`, so it calls whatever host served it rather
than a baked-in `localhost:3000` — that's what makes the image portable. `.dockerignore` excludes
`client/.env`, which would otherwise override it with the dev value.

Four stages: `deps` (cached install) → `build` (shared + server + client) → `prod-deps` (runtime
dependencies only) → `runtime` on `bun:1-slim`, non-root, ~306 MB (74.5 MB compressed).

> **`--network=host` is required on this machine.** Under BuildKit's default network, Bun's
> parallel downloads corrupt at ~310s with `integrity check failed` / `Fail extracting tarball`.
> The same install succeeds in seconds via `docker run`, so it's a BuildKit networking issue, not
> a lockfile or Dockerfile problem. The install also caps `--network-concurrency=8`. The `app`
> script passes the flag for you.

### Configuration

`scripts/docker-up.sh` generates `.env.docker` on first run (gitignored) and reuses it, so
restarting doesn't invalidate refresh tokens already issued. Delete it to rotate secrets.
`PORT=4000 bun run app` changes the published port.

`host.docker.internal` is how the container reaches `auth-app-pg` — containers can't reach each
other over `localhost`, so it goes through the port Postgres publishes on the host.

Secrets are never baked into a layer: `.dockerignore` excludes `.env*`, and the container fails
fast on boot if any are missing.

`COOKIE_SECURE=false` is set for local HTTP. Browsers withhold `Secure` cookies from non-HTTPS
origins, which would break refresh on `http://localhost`. **Behind TLS, drop it** — it defaults to
on whenever `NODE_ENV=production`.

### Running it manually

```bash
docker build --network=host -t auth-app-server .
docker run -d --name auth-app-api -p 3001:3000 \
  --add-host=host.docker.internal:host-gateway \
  --env-file .env.docker auth-app-server
docker exec auth-app-api bun run server/dist/seed.js
```

`src/` isn't shipped, so the seed runs from compiled output. `HEALTHCHECK` polls `/health`, so a
container that boots but can't reach Postgres reports unhealthy rather than looking fine.
