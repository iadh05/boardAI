import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { diag, metrics, trace } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { afterEach, describe, expect, it } from 'vitest';
import { otlpUrl, startTelemetry } from './telemetry.ts';

/** A stand-in collector on a free port: answers 200 to everything, remembers the paths. */
const fakeCollector = async () => {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url ?? '');
    req
      .resume()
      .on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end('{}'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, paths, endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};

let collector: Server | undefined;
afterEach(() => {
  collector?.close();
});

describe('startTelemetry', () => {
  it('registers nothing without an endpoint: tests and offline work pay nothing', async () => {
    const flush = startTelemetry(null, { warn: () => {} });
    await expect(flush()).resolves.toBeUndefined();
  });

  it('with an endpoint, records spans and metrics, logs its own trouble, and sends on shutdown', async () => {
    const fake = await fakeCollector();
    collector = fake.server;
    const warnings: unknown[] = [];
    const flush = startTelemetry(
      { endpoint: fake.endpoint },
      { warn: (_msg, fields) => warnings.push(fields) },
    );

    expect(trace.getTracer('test').startSpan('unsent').isRecording()).toBe(true);
    expect(metrics.getMeterProvider()).toBeInstanceOf(MeterProvider);
    diag.warn('collector unreachable'); // how the exporter reports a failed send
    expect(warnings).toEqual([{ message: 'collector unreachable' }]); // and nothing else to say
    await expect(flush()).resolves.toBeUndefined();
    // The runtime metrics (event loop, memory…) were collected and sent with the last batch.
    expect(fake.paths).toContain('/v1/metrics');
  });
});

describe('otlpUrl', () => {
  it('is the OTLP/HTTP path of a signal under the endpoint, with or without a trailing slash', () => {
    expect(otlpUrl('http://localhost:4318', 'traces')).toBe('http://localhost:4318/v1/traces');
    expect(otlpUrl('http://localhost:4318/', 'metrics')).toBe('http://localhost:4318/v1/metrics');
  });
});
