import { diag, metrics, trace } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { describe, expect, it } from 'vitest';
import { otlpUrl, startTelemetry } from './telemetry.ts';

describe('startTelemetry', () => {
  it('registers nothing without an endpoint: tests and offline work pay nothing', async () => {
    const flush = startTelemetry(null, { warn: () => {} });
    await expect(flush()).resolves.toBeUndefined();
  });

  it('with an endpoint, records spans and metrics, and logs the SDK’s own trouble as warnings', async () => {
    const warnings: unknown[] = [];
    // Nothing listens on port 9: fine, no span is ended, so nothing is sent.
    const flush = startTelemetry(
      { endpoint: 'http://127.0.0.1:9' },
      { warn: (_msg, fields) => warnings.push(fields) },
    );

    expect(trace.getTracer('test').startSpan('unsent').isRecording()).toBe(true);
    expect(metrics.getMeterProvider()).toBeInstanceOf(MeterProvider);
    diag.warn('collector unreachable'); // how the exporter reports a failed send
    expect(warnings).toEqual([{ message: 'collector unreachable' }]);
    await expect(flush()).resolves.toBeUndefined();
  });
});

describe('otlpUrl', () => {
  it('is the OTLP/HTTP path of a signal under the endpoint, with or without a trailing slash', () => {
    expect(otlpUrl('http://localhost:4318', 'traces')).toBe('http://localhost:4318/v1/traces');
    expect(otlpUrl('http://localhost:4318/', 'metrics')).toBe('http://localhost:4318/v1/metrics');
  });
});
