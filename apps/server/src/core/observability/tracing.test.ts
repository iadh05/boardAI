import { diag, trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { otlpTracesUrl, startTracing } from './tracing.ts';

describe('startTracing', () => {
  it('registers nothing without an endpoint: tests and offline work pay nothing', async () => {
    const flush = startTracing(null, { warn: () => {} });
    await expect(flush()).resolves.toBeUndefined();
  });

  it('with an endpoint, records spans and logs the SDK’s own trouble as warnings', async () => {
    const warnings: unknown[] = [];
    // Nothing listens on port 9: fine, no span is ended, so nothing is sent.
    const flush = startTracing(
      { endpoint: 'http://127.0.0.1:9' },
      { warn: (_msg, fields) => warnings.push(fields) },
    );

    expect(trace.getTracer('test').startSpan('unsent').isRecording()).toBe(true);
    diag.warn('collector unreachable'); // how the exporter reports a failed send
    expect(warnings).toEqual([{ message: 'collector unreachable' }]);
    await expect(flush()).resolves.toBeUndefined();
  });
});

describe('otlpTracesUrl', () => {
  it('is the OTLP/HTTP traces path under the endpoint, with or without a trailing slash', () => {
    expect(otlpTracesUrl('http://localhost:4318')).toBe('http://localhost:4318/v1/traces');
    expect(otlpTracesUrl('http://localhost:4318/')).toBe('http://localhost:4318/v1/traces');
  });
});
