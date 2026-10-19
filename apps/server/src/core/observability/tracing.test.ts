import { describe, expect, it } from 'vitest';
import { otlpTracesUrl, startTracing } from './tracing.ts';

describe('startTracing', () => {
  it('registers nothing without an endpoint: tests and offline work pay nothing', async () => {
    const flush = startTracing(null, { warn: () => {} });
    await expect(flush()).resolves.toBeUndefined();
  });
});

describe('otlpTracesUrl', () => {
  it('is the OTLP/HTTP traces path under the endpoint, with or without a trailing slash', () => {
    expect(otlpTracesUrl('http://localhost:4318')).toBe('http://localhost:4318/v1/traces');
    expect(otlpTracesUrl('http://localhost:4318/')).toBe('http://localhost:4318/v1/traces');
  });
});
