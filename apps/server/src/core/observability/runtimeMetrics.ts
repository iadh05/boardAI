import type { MeterProvider } from '@opentelemetry/api';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HostMetricsInstrumentation } from '@opentelemetry/instrumentation-host-metrics';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';

// The server's own health (M1-26e): the "saturation" golden signal, USE for the process. Request
// metrics say a route is slow; these say why — a blocked event loop (one long synchronous task
// slows every route at once), a growing heap, or a busy CPU. Official OpenTelemetry
// instrumentations, so the names follow the semantic conventions (nodejs.*, v8js.*, process.*).

/** Starts collecting into `meterProvider`; returns how to stop. */
export const startRuntimeMetrics = (meterProvider: MeterProvider): (() => void) =>
  registerInstrumentations({
    meterProvider,
    instrumentations: [
      // Event-loop delay and utilization, heap, garbage collection.
      new RuntimeNodeInstrumentation(),
      // CPU and memory of this process only: system-wide groups would add a series per core and
      // per network card, and say more about the PC than about the server.
      new HostMetricsInstrumentation({ metricGroups: ['process.cpu', 'process.memory'] }),
    ],
  });
