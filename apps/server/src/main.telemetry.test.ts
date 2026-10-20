import { createFakeProvider } from '@designroom/ai-gateway';
import { metrics, SpanStatusCode } from '@opentelemetry/api';
import { MeterProvider, MetricReader, type DataPoint } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from './core/logger.ts';
import { createApp } from './main.ts';

// One chat request as a trace (M1-26): the span tree you will see in Grafana and Phoenix, read
// here from an in-memory exporter. Own file: registering an SDK is global to the test file.

/** Reads metrics on demand: what the exporter would send, without sending it. */
class TestReader extends MetricReader {
  protected onForceFlush = () => Promise.resolve();
  protected onShutdown = () => Promise.resolve();
}

const exporter = new InMemorySpanExporter();
const reader = new TestReader();
beforeAll(() => {
  new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).register();
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
});

const config = {
  port: 3000,
  llm: { provider: 'fake', model: 'test-model', timeoutMs: 5_000, contextTokens: 16_384 },
  logLevel: 'info',
  errorTracking: null,
  telemetry: null,
  debugRoutes: false,
} as const;

const chat = async (script: Parameters<typeof createFakeProvider>[0], lines: string[] = []) => {
  exporter.reset();
  const app = createApp({
    config,
    logger: createLogger({ level: 'info', write: (l) => lines.push(l) }),
    llmProvider: createFakeProvider(script),
  });
  const res = await app.request('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      board: { nodes: [], edges: [] },
      messages: [{ role: 'user', content: 'Review it' }],
    }),
  });
  await res.text(); // the stream must end for its spans to end
  return exporter.getFinishedSpans();
};

describe('telemetry of a request', () => {
  it('HTTP → review board → agent → scope check and rounds → LLM calls, in one trace', async () => {
    const spans = await chat([
      [{ type: 'text', delta: 'DESIGN' }], // the scope guard's call
      [{ type: 'text', delta: 'Looks fine.' }],
    ]);

    const byName = (name: string) => spans.find((s) => s.name === name);
    const parentOf = (name: string) => {
      const parentId = byName(name)?.parentSpanContext?.spanId;
      return spans.find((s) => s.spanContext().spanId === parentId)?.name;
    };
    expect(byName('POST /api/chat')?.parentSpanContext).toBeUndefined(); // the root
    expect(parentOf('review board')).toBe('POST /api/chat');
    expect(parentOf('agent')).toBe('review board');
    expect(parentOf('scope check')).toBe('agent');
    expect(parentOf('agent round')).toBe('agent');
    const llmParents = spans
      .filter((s) => s.name === 'chat test-model')
      .map((s) => spans.find((p) => p.spanContext().spanId === s.parentSpanContext?.spanId)?.name);
    expect(llmParents.sort()).toEqual(['agent round', 'scope check']);
    expect(new Set(spans.map((s) => s.spanContext().traceId)).size).toBe(1);

    expect(byName('POST /api/chat')?.attributes).toMatchObject({
      'http.request.method': 'POST',
      'http.response.status_code': 200,
    });
    // The review span lasts the whole stream: chat duration and outcome live here, not in the
    // access log, which is written when the headers go out (M1-19 review).
    expect(byName('review board')?.attributes['designroom.chat.outcome']).toBe('done');
  });

  it('names the request span after the route, not the raw path: span names stay few', async () => {
    exporter.reset();
    const app = createApp({ config, logger: createLogger({ level: 'error', write: () => {} }) });

    await app.request('/api/no-such-thing-1234');

    const [span] = exporter.getFinishedSpans();
    expect(span?.name).not.toContain('1234');
    expect(span?.attributes['url.path']).toBe('/api/no-such-thing-1234'); // still findable
    expect(span?.attributes['http.response.status_code']).toBe(404);
  });

  it('marks the review as failed when the model fails', async () => {
    const spans = await chat([[{ type: 'text', delta: 'DESIGN' }]]); // no script for the review

    const review = spans.find((s) => s.name === 'review board');
    expect(review?.attributes['designroom.chat.outcome']).toBe('error');
    expect(review?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('puts the trace id on every log line of the request', async () => {
    const lines: string[] = [];
    const spans = await chat(
      [[{ type: 'text', delta: 'DESIGN' }], [{ type: 'text', delta: 'Looks fine.' }]],
      lines,
    );

    const traceId = spans[0]?.spanContext().traceId;
    const logged = lines.map((l) => JSON.parse(l) as { msg: string; traceId?: string });
    expect(logged.find((l) => l.msg === 'agent round')?.traceId).toBe(traceId);
    expect(logged.find((l) => l.msg === 'request')?.traceId).toBe(traceId);
  });

  it('measures each request by route and status, for the dashboard', async () => {
    const app = createApp({ config, logger: createLogger({ level: 'error', write: () => {} }) });
    await app.request('/api/health');
    await app.request('/api/no-such-thing-1234');

    const { resourceMetrics } = await reader.collect();
    const metric = resourceMetrics.scopeMetrics
      .flatMap((s) => s.metrics)
      .find((m) => m.descriptor.name === 'http_server_request_duration_seconds');
    const labels = (metric?.dataPoints ?? []).map((p: DataPoint<unknown>) => p.attributes);
    expect(labels).toContainEqual({ method: 'GET', route: '/api/health', status: 200 });
    expect(labels).toContainEqual({ method: 'GET', route: '/*', status: 404 }); // not the raw path

    // Buckets in seconds, from a millisecond to a minute. OTel's defaults (0, 5, 10, 25…) are
    // meant for milliseconds: in seconds, every request landed in the first bucket, and every
    // route's p50/p95 read 2.5 s / 4.75 s, a fast /api/health included (M1-26e).
    const boundaries = (metric?.dataPoints[0]?.value as { buckets?: { boundaries: number[] } })
      ?.buckets?.boundaries;
    const underOneSecond = (boundaries ?? []).filter((b) => b > 0 && b < 1);
    expect(underOneSecond.length).toBeGreaterThanOrEqual(5); // tells a 2 ms route from a 300 ms one
    expect(boundaries?.at(-1)).toBeGreaterThanOrEqual(30); // and still bounds a long chat
    expect(boundaries?.at(-1)).toBeLessThanOrEqual(120);
  });
});
