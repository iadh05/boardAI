import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { afterEach, describe, expect, it } from 'vitest';
import { startRuntimeMetrics } from './runtimeMetrics.ts';

/** Reads metrics on demand: what the exporter would send, without sending it. */
class TestReader extends MetricReader {
  protected onForceFlush = () => Promise.resolve();
  protected onShutdown = () => Promise.resolve();
}

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
});

describe('startRuntimeMetrics', () => {
  it('measures the process: event loop, heap, CPU and memory (the USE side of the overview)', async () => {
    const reader = new TestReader();
    stop = startRuntimeMetrics(new MeterProvider({ readers: [reader] }));

    // The event-loop delay figures appear once the monitor has samples: collect until then.
    const collectNames = async () => {
      const { resourceMetrics } = await reader.collect();
      return resourceMetrics.scopeMetrics.flatMap((s) => s.metrics.map((m) => m.descriptor.name));
    };
    let names = await collectNames();
    for (let tries = 0; !names.includes('nodejs.eventloop.delay.p99') && tries < 30; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      names = await collectNames();
    }

    expect(names).toEqual(
      expect.arrayContaining([
        'nodejs.eventloop.delay.p99', // a blocked event loop slows every route at once
        'v8js.memory.heap.used',
        'process.cpu.utilization',
        'process.memory.usage',
      ]),
    );
    // Process only: no per-core or per-network-card series.
    expect(names.some((n) => n.startsWith('system.'))).toBe(false);
  });
});
