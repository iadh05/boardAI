import { metrics } from '@opentelemetry/api';
import { MeterProvider, MetricReader, type DataPoint } from '@opentelemetry/sdk-metrics';
import { describe, expect, it, vi } from 'vitest';
import { countErrors, createErrorReporter, noErrorReporter } from './errorReporter.ts';

/** Reads metrics on demand: what the exporter would send, without sending it. */
class TestReader extends MetricReader {
  protected onForceFlush = () => Promise.resolve();
  protected onShutdown = () => Promise.resolve();
}

describe('countErrors', () => {
  it('starts both counts at 0, so the very first bug shows as an increase (dashboard, alert)', async () => {
    metrics.disable();
    const reader = new TestReader();
    metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));

    countErrors({ report: () => {} });

    const { resourceMetrics } = await reader.collect();
    const metric = resourceMetrics.scopeMetrics
      .flatMap((s) => s.metrics)
      .find((m) => m.descriptor.name === 'server_errors_reported_total');
    expect((metric?.dataPoints ?? []).map((p) => [p.attributes, p.value])).toEqual([
      [{ where: 'http' }, 0],
      [{ where: 'chat_stream' }, 0],
    ]);
  });

  it('counts every reported bug by where it happened, and still reports it', async () => {
    metrics.disable();
    const reader = new TestReader();
    metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
    const reported: unknown[] = [];

    const reporter = countErrors({ report: (e) => reported.push(e) });
    reporter.report(new Error('a'), { where: 'chat stream', requestId: 'r1' });
    reporter.report(new Error('b'), { path: '/api/chat' }); // from the HTTP error handler
    reporter.report(new Error('c'));

    const { resourceMetrics } = await reader.collect();
    const metric = resourceMetrics.scopeMetrics
      .flatMap((s) => s.metrics)
      .find((m) => m.descriptor.name === 'server_errors_reported_total');
    const points = (metric?.dataPoints ?? []).map((p: DataPoint<unknown>) => [
      p.attributes,
      p.value,
    ]);
    // Counted even without a DSN: the overview shows bugs whether or not GlitchTip is running.
    expect(points).toEqual([
      [{ where: 'http' }, 2],
      [{ where: 'chat_stream' }, 1],
    ]);
    expect(reported).toHaveLength(3);
  });
});

const fakeSentry = () => ({ init: vi.fn(), captureException: vi.fn() });

describe('createErrorReporter', () => {
  it('does nothing without a DSN: tests and offline work need no Sentry', () => {
    const sentry = fakeSentry();

    const reporter = createErrorReporter(null, sentry);
    reporter.report(new Error('x'));

    expect(reporter).toBe(noErrorReporter);
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('starts Sentry for errors only, sending no board, chat or prompt, and reports with context', () => {
    const sentry = fakeSentry();
    const bug = new Error('boom');

    createErrorReporter(
      { dsn: 'https://key@o1.ingest.sentry.io/1', environment: 'development' },
      sentry,
    ).report(bug, { requestId: 'abc' });

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@o1.ingest.sentry.io/1',
        environment: 'development',
        tracesSampleRate: 0,
        enableOpenTelemetrySetup: false, // telemetry.ts registers the one OpenTelemetry provider
        dataCollection: expect.objectContaining({
          httpBodies: [], // the chat request carries the whole board and conversation
          genAI: { inputs: false, outputs: false },
          stackFrameVariables: false, // local variables can hold the prompt
          userInfo: false,
        }) as unknown,
      }),
    );
    expect(sentry.captureException).toHaveBeenCalledWith(bug, { extra: { requestId: 'abc' } });
  });
});
