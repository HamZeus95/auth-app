import { PrometheusExporter } from '@opentelemetry/exporter-prometheus'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { MeterProvider } from '@opentelemetry/sdk-metrics'
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'

/**
 * Traces go to Tempo over OTLP/HTTP; metrics are exposed on a second port for
 * Prometheus to scrape.
 *
 * Deliberately not using @opentelemetry/sdk-node or the auto-instrumentations:
 * those patch modules at require time via require-in-the-middle, which is not
 * reliable under Bun. Instrumentation is applied explicitly at the Hono layer
 * instead (see index.ts), which works on any runtime.
 */

const SERVICE_NAME = Bun.env.OTEL_SERVICE_NAME ?? 'auth-app'
const SERVICE_VERSION = Bun.env.APP_VERSION ?? 'dev'

/** Unset means "telemetry off", so the app still runs outside the cluster. */
const OTLP_ENDPOINT = Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT

/** Port the Prometheus scrape endpoint listens on. 0 disables it. */
const METRICS_PORT = Number(Bun.env.METRICS_PORT ?? 9464)

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: SERVICE_NAME,
  [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
})

let tracerProvider: NodeTracerProvider | undefined
let meterProvider: MeterProvider | undefined

if (OTLP_ENDPOINT) {
  tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${OTLP_ENDPOINT}/v1/traces` }),
      ),
    ],
  })
  // Registers as the global provider so trace.getActiveSpan() works anywhere,
  // which is what the log correlation below relies on.
  tracerProvider.register()
  console.log(`[telemetry] traces -> ${OTLP_ENDPOINT}/v1/traces`)
}

if (METRICS_PORT > 0) {
  meterProvider = new MeterProvider({
    resource,
    readers: [new PrometheusExporter({ port: METRICS_PORT, endpoint: '/metrics' })],
  })
  console.log(`[telemetry] metrics on :${METRICS_PORT}/metrics`)
}

export { meterProvider, tracerProvider, SERVICE_NAME, SERVICE_VERSION }

/** Flush pending spans on shutdown, or the last requests are lost. */
export async function shutdownTelemetry(): Promise<void> {
  await Promise.allSettled([
    tracerProvider?.shutdown(),
    meterProvider?.shutdown(),
  ])
}
