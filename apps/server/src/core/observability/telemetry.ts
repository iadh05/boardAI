import { diag, DiagLogLevel, metrics, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import type { Logger } from '../logger.ts';

// Traces and metrics (architecture §9). Traces: one request = one trace, HTTP → use case → agent →
// LLM calls. Metrics: numbers over time for Grafana's dashboard (latency, tokens, errors). The
// packages record both through the OpenTelemetry API only; this file is the one place that picks
// the SDK and where data goes. Vendor-neutral: Grafana today (OTLP), Azure Monitor in M6 is another
// exporter, not new instrumentation.

export type TelemetryConfig = { endpoint: string } | null;

const ignore = () => {};

/** Where OTLP/HTTP expects one kind of data (a "signal"), under the collector's base URL. */
export const otlpUrl = (endpoint: string, signal: 'traces' | 'metrics') =>
  `${endpoint.replace(/\/+$/, '')}/v1/${signal}`;

/**
 * Registers the SDKs, once, at startup (index.ts), before the app is built: the packages create
 * their metric instruments then. Without an endpoint nothing is registered: the API stays a no-op,
 * so tests and offline work pay nothing. Returns a flush for shutdown.
 */
export const startTelemetry = (
  config: TelemetryConfig,
  logger: Pick<Logger, 'warn'>,
): (() => Promise<void>) => {
  if (!config) return () => Promise.resolve();
  // The SDK reports its own trouble (collector unreachable…) through `diag`, silent by default:
  // without this, a stopped Grafana container just means empty dashboards and no clue why.
  const warn = (message: string) => logger.warn('telemetry', { message });
  diag.setLogger(
    { error: warn, warn, info: ignore, debug: ignore, verbose: ignore },
    DiagLogLevel.WARN,
  );
  const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'designroom-server' });

  const tracerProvider = new NodeTracerProvider({
    resource,
    // Batches spans in memory and sends them every few seconds, off the request path.
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: otlpUrl(config.endpoint, 'traces') })),
    ],
  });
  tracerProvider.register(); // also the AsyncLocalStorage context manager: spans find their parent

  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: otlpUrl(config.endpoint, 'metrics') }),
        // Every 15 s (default 60 s): a dashboard you watch while testing should move.
        exportIntervalMillis: 15_000,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  return async () => {
    await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
  };
};

const tracer = trace.getTracer('@designroom/server');

/**
 * For each request: its root span and its duration metric, both named by route (`/api/chat`, later
 * `/room/:id`) — never the raw path, or every id and every 404 probe would be a new name. For the
 * chat, both end when the headers go out; the stream is measured by the use case's span below it
 * (reviewBoard). Instruments are made here, when the app is built, after the SDK is registered.
 */
export const observeRequests = (): MiddlewareHandler => {
  const duration = metrics
    .getMeter('@designroom/server')
    .createHistogram('http_server_request_duration_seconds', {
      description: 'Time to answer a request (for the chat: until the stream starts).',
      unit: 's',
    });
  return (c, next) =>
    tracer.startActiveSpan(
      c.req.method, // renamed once the route is known
      {
        kind: SpanKind.SERVER,
        attributes: { 'http.request.method': c.req.method, 'url.path': c.req.path },
      },
      async (span) => {
        const started = performance.now();
        try {
          await next(); // Hono's onError has already turned a throw into a response here
          const route = routePath(c, -1); // the handler's route; this middleware's ('/*') if none
          span.updateName(`${c.req.method} ${route}`);
          span.setAttribute('http.route', route);
          span.setAttribute('http.response.status_code', c.res.status);
          if (c.res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
          duration.record((performance.now() - started) / 1000, {
            method: c.req.method,
            route,
            status: c.res.status,
          });
        } finally {
          span.end();
        }
      },
    );
};
