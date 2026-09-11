import { trace } from '@opentelemetry/api'
import type { MiddlewareHandler } from 'hono'

/**
 * One structured line per request, carrying the active trace and span ids.
 *
 * The trace_id is what ties the two halves of the observability stack
 * together: Grafana's Loki datasource has a derived field matching
 * `trace_id"…"<32 hex>` that links a log line straight to its trace in Tempo,
 * and the Tempo datasource links back the other way.
 */
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = performance.now()

  await next()

  const spanContext = trace.getActiveSpan()?.spanContext()
  const status = c.res.status

  console.log(
    JSON.stringify({
      time: new Date().toISOString(),
      level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      method: c.req.method,
      path: c.req.path,
      status,
      duration_ms: Math.round(performance.now() - start),
      // Undefined keys are dropped by JSON.stringify, so lines emitted before
      // the tracer is registered simply carry no ids rather than nulls.
      trace_id: spanContext?.traceId,
      span_id: spanContext?.spanId,
    }),
  )
}
