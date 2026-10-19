import { diag, DiagLogLevel, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import type { Logger } from '../logger.ts';

// Traces (architecture §9): one request = one trace, HTTP → use case → agent → LLM calls. The
// packages create their spans through the OpenTelemetry API only; this file is the one place that
// picks the SDK and where spans go. Vendor-neutral: Grafana today (OTLP), Azure Monitor in M6 is
// another exporter, not new instrumentation.

export type TracingConfig = { endpoint: string } | null;

/** Where OTLP/HTTP expects traces, under the collector's base URL. */
export const otlpTracesUrl = (endpoint: string) => `${endpoint.replace(/\/+$/, '')}/v1/traces`;

/**
 * Registers the SDK, once, at startup (index.ts). Without an endpoint nothing is registered: the
 * API stays a no-op, so tests and offline work pay nothing. Returns a flush for shutdown.
 */
export const startTracing = (
  config: TracingConfig,
  logger: Pick<Logger, 'warn'>,
): (() => Promise<void>) => {
  if (!config) return () => Promise.resolve();
  // The SDK reports its own trouble (collector unreachable…) through `diag`, silent by default:
  // without this, a stopped Grafana container just means an empty Tempo and no clue why.
  const warn = (message: string) => logger.warn('telemetry', { message });
  diag.setLogger(
    { error: warn, warn, info: () => {}, debug: () => {}, verbose: () => {} },
    DiagLogLevel.WARN,
  );
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'designroom-server' }),
    // Batches spans in memory and sends them every few seconds, off the request path.
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: otlpTracesUrl(config.endpoint) })),
    ],
  });
  provider.register(); // also the AsyncLocalStorage context manager: spans find their parent
  return () => provider.shutdown();
};

const tracer = trace.getTracer('@designroom/server');

/**
 * The root span of each request, named "METHOD route" (`/api/chat`, later `/room/:id`) — never the
 * raw path, or every id and every 404 probe would be a new span name. For the chat, it ends when
 * the headers go out; the stream is measured by the use case's span below it (reviewBoard).
 */
export const traceRequests = (): MiddlewareHandler => (c, next) =>
  tracer.startActiveSpan(
    c.req.method, // renamed once the route is known
    {
      kind: SpanKind.SERVER,
      attributes: { 'http.request.method': c.req.method, 'url.path': c.req.path },
    },
    async (span) => {
      try {
        await next(); // Hono's onError has already turned a throw into a response here
        const route = routePath(c, -1); // the handler's route; this middleware's ('/*') if none
        span.updateName(`${c.req.method} ${route}`);
        span.setAttribute('http.route', route);
        span.setAttribute('http.response.status_code', c.res.status);
        if (c.res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      } finally {
        span.end();
      }
    },
  );
