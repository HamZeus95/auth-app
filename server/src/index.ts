// Must be first: registers the global tracer/meter providers before anything
// else imports @opentelemetry/api and captures a no-op provider.
import {
  SERVICE_NAME,
  SERVICE_VERSION,
  meterProvider,
  shutdownTelemetry,
  tracerProvider,
} from './telemetry'

import { existsSync } from 'node:fs'
import { httpInstrumentationMiddleware } from '@hono/otel'
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { cors } from 'hono/cors'
import type { ApiResponse } from 'shared'
import auth from './auth'
import { migrate } from './db'
import { env } from './env'
import { requestLogger } from './logging'
import { requireAuth, type AuthEnv } from './middleware'

await migrate()

const app = new Hono<AuthEnv>()

// Instrumented at the Hono layer rather than by patching node modules, so it
// behaves the same under Bun as it would under Node. Produces a server span
// per request plus the http.server.* metrics the RED dashboard is built on.
app.use(
  '*',
  httpInstrumentationMiddleware({
    tracerProvider,
    meterProvider,
    captureActiveRequests: true,
    // The middleware stamps its own service_name/service_version metric
    // attributes and defaults them to empty strings; it does not read them
    // off the provider's resource. Without these every series is labelled
    // service_name="" and the dashboard cannot filter by service.
    serviceName: SERVICE_NAME,
    serviceVersion: SERVICE_VERSION,
  }),
)
app.use('*', requestLogger)

// `credentials` is required for the httpOnly refresh cookie to travel.
app.use(
  '*',
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
  }),
)

app.get('/health', (c) => c.json({ status: 'ok' }))

app.get('/hello', async (c) => {
  const data: ApiResponse = {
    message: 'Hello BHVR!',
    success: true,
  }

  return c.json(data, { status: 200 })
})

app.route('/auth', auth)

// Example protected resource — only reachable with a valid access token.
app.get('/protected/secret', requireAuth, (c) => {
  const user = c.get('user')
  return c.json({
    message: `Hello ${user.name}, this data is only visible to authenticated users.`,
    servedAt: new Date().toISOString(),
  })
})

// Serve the built React app from the same origin, so the whole thing runs on
// one port and the refresh cookie needs no cross-site handling. Paths are
// relative to the process cwd, which is why `start` runs from the repo root.
// Skipped in dev, where Vite serves the client on :5173 instead.
const CLIENT_DIST = 'client/dist'

if (existsSync(CLIENT_DIST)) {
  app.use('/*', serveStatic({ root: CLIENT_DIST }))
  // SPA fallback: unknown paths are client routes (/login, /dashboard), so
  // hand back index.html and let the router resolve them.
  app.get('*', serveStatic({ path: `${CLIENT_DIST}/index.html` }))
} else {
  app.get('/', (c) => c.text('API is running. Client bundle not built.'))
}

// Without this the batch span processor is killed mid-flight on rollout and
// the final requests never reach Tempo.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    shutdownTelemetry().finally(() => process.exit(0))
  })
}

export default {
  port: env.PORT,
  fetch: app.fetch,
}
