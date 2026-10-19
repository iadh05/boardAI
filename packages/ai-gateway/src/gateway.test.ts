import { context, metrics, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { MeterProvider, MetricReader, type DataPoint } from '@opentelemetry/sdk-metrics';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmError } from './errors.ts';
import { createGateway, type GatewayOptions } from './gateway.ts';
import { createFakeProvider, type FakeStep } from './providers/fake.ts';
import type { ChatInput, LlmChunk, LlmProvider, ProviderChunk } from './types.ts';

const input: ChatInput = { messages: [{ role: 'user', content: 'Review my design' }] };
const text = (delta: string): ProviderChunk => ({ type: 'text', delta });
const down = () => new LlmError('UNAVAILABLE', 'down');

/** A provider from a plain generator, so a test can act between chunks (move the clock…). */
const providerOf = (
  steps: (input: ChatInput & { signal: AbortSignal }) => Iterable<ProviderChunk>,
): LlmProvider => ({
  async *stream(input) {
    for (const chunk of steps(input)) {
      await Promise.resolve(); // chunks arrive asynchronously, as from a network
      yield chunk;
    }
  },
});

/** A gateway whose waits are recorded instead of slept, and whose clock the test moves. */
const setup = (provider: LlmProvider, options: Partial<GatewayOptions> = {}) => {
  const clock = { t: 0 };
  const sleeps: number[] = [];
  const gateway = createGateway({
    provider,
    timeoutMs: 30_000,
    retries: 2,
    backoffMs: 500,
    now: () => clock.t,
    sleep: (ms) => {
      sleeps.push(ms);
      clock.t += ms;
      return Promise.resolve();
    },
    ...options,
  });
  return { gateway, clock, sleeps };
};

const drain = async (stream: AsyncIterable<LlmChunk>) => {
  const chunks: LlmChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
};

const usageOf = (chunks: LlmChunk[]) => {
  const last = chunks.at(-1);
  if (last?.type !== 'usage') throw new Error('the stream must end with usage');
  return last.usage;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('gateway — passing the answer through', () => {
  it('passes text and tool calls through, then reports usage exactly once', async () => {
    const call = { id: 'c1', name: 'add_node', arguments: { kind: 'cache' } };
    const { gateway } = setup(
      createFakeProvider([
        [
          text('Add a cache.'),
          { type: 'toolCall', call },
          { type: 'tokens', inputTokens: 300, outputTokens: 40 },
        ],
      ]),
    );

    const chunks = await drain(gateway.chat(input));

    expect(chunks.slice(0, 2)).toEqual([
      { type: 'text', delta: 'Add a cache.' },
      { type: 'toolCall', call },
    ]);
    expect(chunks.filter((c) => c.type === 'usage')).toHaveLength(1);
    expect(usageOf(chunks)).toMatchObject({ inputTokens: 300, outputTokens: 40, attempts: 1 });
  });

  it('measures latency and time to first token on the injected clock', async () => {
    const clock = { t: 0 };
    const provider = providerOf(function* () {
      clock.t = 250; // the model takes 250 ms to start…
      yield text('Hi');
      clock.t = 1_000; // …and finishes at 1 s
      yield { type: 'tokens', inputTokens: 1, outputTokens: 1 };
    });
    const gateway = createGateway({ provider, timeoutMs: 30_000, retries: 0, now: () => clock.t });

    const usage = usageOf(await drain(gateway.chat(input)));

    expect(usage.timeToFirstTokenMs).toBe(250);
    expect(usage.latencyMs).toBe(1_000);
  });

  it('reports zero tokens and no first token when the provider sent neither', async () => {
    const { gateway } = setup(createFakeProvider([[]]));
    expect(usageOf(await drain(gateway.chat(input)))).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      timeToFirstTokenMs: null,
    });
  });
});

describe('gateway — retries', () => {
  it('retries a transient failure with exponential backoff, then succeeds', async () => {
    const { gateway, sleeps } = setup(
      createFakeProvider([
        [{ type: 'error', error: down() }],
        [{ type: 'error', error: down() }],
        [text('ok')],
      ]),
    );

    const chunks = await drain(gateway.chat(input));

    expect(sleeps).toEqual([500, 1_000]);
    expect(chunks[0]).toEqual({ type: 'text', delta: 'ok' });
    expect(usageOf(chunks).attempts).toBe(3);
  });

  it('gives up after the allowed retries with the last error', async () => {
    const answers: FakeStep[][] = [1, 2, 3].map(() => [{ type: 'error', error: down() }]);
    const { gateway, sleeps } = setup(createFakeProvider(answers));

    await expect(drain(gateway.chat(input))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(sleeps).toHaveLength(2);
  });

  it('does not retry an error that will not go away', async () => {
    const fake = createFakeProvider([
      [{ type: 'error', error: new LlmError('BAD_REQUEST', 'no such model') }],
    ]);
    const { gateway, sleeps } = setup(fake);

    await expect(drain(gateway.chat(input))).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(sleeps).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  });

  it('does not retry once part of the answer was sent: the user would see it twice', async () => {
    const fake = createFakeProvider([
      [text('Half an ans'), { type: 'error', error: down() }],
      [text('again')],
    ]);
    const { gateway } = setup(fake);

    const seen: LlmChunk[] = [];
    await expect(async () => {
      for await (const chunk of gateway.chat(input)) seen.push(chunk);
    }).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(seen).toEqual([{ type: 'text', delta: 'Half an ans' }]);
    expect(fake.calls).toHaveLength(1);
  });

  it('lets bugs through unchanged and unretried', async () => {
    const bug = new Error('provider bug');
    const { gateway, sleeps } = setup(
      providerOf(() => {
        throw bug; // fails before its first chunk
      }),
    );

    await expect(drain(gateway.chat(input))).rejects.toBe(bug);
    expect(sleeps).toEqual([]);
  });
});

describe('gateway — timeouts and cancellation', () => {
  it('times out when the model goes silent, cancels the call, and does not retry', async () => {
    vi.useFakeTimers();
    const fake = createFakeProvider([[text('Thinking about'), { type: 'hang' }]]);
    const providerSignals: AbortSignal[] = [];
    const spy: LlmProvider = {
      stream: (i) => {
        providerSignals.push(i.signal);
        return fake.stream(i);
      },
    };
    const { gateway, sleeps } = setup(spy, { timeoutMs: 30_000, retries: 2 });

    const result = drain(gateway.chat(input));
    const assertion = expect(result).rejects.toMatchObject({ code: 'TIMEOUT', transient: false });
    await vi.advanceTimersByTimeAsync(30_000);

    await assertion;
    expect(providerSignals[0]?.aborted).toBe(true);
    // A silent model is busy or stuck: asking again would make the user wait another 30 s.
    expect(sleeps).toEqual([]);
    expect(providerSignals).toHaveLength(1);
  });

  it('measures silence, not total time: a slow but steady stream is fine', async () => {
    vi.useFakeTimers();
    const provider: LlmProvider = {
      async *stream() {
        for (let i = 0; i < 4; i++) {
          await new Promise((resolve) => setTimeout(resolve, 20_000)); // 80 s in total
          yield text(`${i}`);
        }
      },
    };
    const { gateway } = setup(provider, { timeoutMs: 30_000, retries: 0 });

    const result = drain(gateway.chat(input));
    await vi.advanceTimersByTimeAsync(80_000);

    expect((await result).filter((c) => c.type === 'text')).toHaveLength(4);
  });

  it('stops the model when the caller cancels, without retrying', async () => {
    const controller = new AbortController();
    const fake = createFakeProvider([[text('Start'), { type: 'hang' }]]);
    const { gateway, sleeps } = setup(fake);

    const seen: LlmChunk[] = [];
    const run = (async () => {
      for await (const chunk of gateway.chat({ ...input, signal: controller.signal })) {
        seen.push(chunk);
        controller.abort();
      }
    })();

    await expect(run).rejects.toMatchObject({ code: 'ABORTED' });
    expect(sleeps).toEqual([]);
  });

  it('does not even call the model when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = createFakeProvider([[text('never')]]);
    const { gateway } = setup(fake);

    await expect(
      drain(gateway.chat({ ...input, signal: controller.signal })),
    ).rejects.toMatchObject({
      code: 'ABORTED',
    });
    expect(fake.calls).toHaveLength(0);
  });

  it('cancels the model when the consumer stops reading early', async () => {
    const signals: AbortSignal[] = [];
    const provider = providerOf(function* (i) {
      signals.push(i.signal);
      yield text('a');
      yield text('b');
    });
    const { gateway } = setup(provider);

    const reader = gateway.chat(input)[Symbol.asyncIterator]();
    await reader.next(); // read "a"…
    await reader.return?.(); // …then stop, like a client that went away

    expect(signals[0]?.aborted).toBe(true);
  });
});

describe('gateway — defaults', () => {
  it('stops waiting to retry as soon as the caller cancels', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fake = createFakeProvider([[{ type: 'error', error: down() }], [text('never')]]);
    const gateway = createGateway({
      provider: fake,
      timeoutMs: 30_000,
      retries: 1,
      backoffMs: 10_000,
    });

    const result = drain(gateway.chat({ ...input, signal: controller.signal }));
    const assertion = expect(result).rejects.toMatchObject({ code: 'ABORTED' });
    await vi.advanceTimersByTimeAsync(1); // the first attempt failed; now waiting 10 s to retry
    controller.abort();

    await assertion; // without the 10 s passing
    expect(fake.calls).toHaveLength(1);
  });

  it('waits on real timers and reads the real clock when none are injected', async () => {
    vi.useFakeTimers(); // fakes both setTimeout and performance.now
    const gateway = createGateway({
      provider: createFakeProvider([[{ type: 'error', error: down() }], [text('ok')]]),
      timeoutMs: 30_000,
      retries: 1,
    });

    const result = drain(gateway.chat(input));
    await vi.advanceTimersByTimeAsync(500); // the default first backoff

    const usage = usageOf(await result);
    expect(usage).toMatchObject({ attempts: 2, latencyMs: 500 });
  });
});

describe('gateway — tracing', () => {
  // The SDK the server registers, here with an in-memory exporter: spans are read, not sent.
  const exporter = new InMemorySpanExporter();
  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    trace.setGlobalTracerProvider(
      new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
    );
  });
  afterEach(() => {
    exporter.reset();
  });

  it('records one LLM span per call, with the model, tokens and timings', async () => {
    const { gateway, clock } = setup(
      providerOf(function* () {
        clock.t += 200;
        yield text('Add a cache.');
        clock.t += 800;
        yield { type: 'tokens', inputTokens: 300, outputTokens: 40 };
      }),
      { model: 'qwen' },
    );

    await drain(gateway.chat(input));

    const [span] = exporter.getFinishedSpans();
    expect(exporter.getFinishedSpans()).toHaveLength(1);
    expect(span?.name).toBe('chat qwen');
    expect(span?.attributes).toMatchObject({
      'openinference.span.kind': 'LLM',
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': 'qwen',
      'gen_ai.usage.input_tokens': 300,
      'gen_ai.usage.output_tokens': 40,
      'llm.token_count.prompt': 300,
      'llm.token_count.completion': 40,
      'llm.token_count.total': 340,
      'designroom.llm.time_to_first_token_ms': 200,
      'designroom.llm.attempts': 1,
    });
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('names the span after the model the call asked for', async () => {
    const { gateway } = setup(createFakeProvider([[text('ok')]]), { model: 'qwen' });

    await drain(gateway.chat({ ...input, model: 'other' }));

    expect(exporter.getFinishedSpans()[0]?.name).toBe('chat other');
  });

  it('marks a failed call as an error, with its code', async () => {
    const { gateway } = setup(
      providerOf(() => {
        throw new LlmError('BAD_REQUEST', 'no such model');
      }),
    );

    await expect(drain(gateway.chat(input))).rejects.toThrow('no such model');

    const [span] = exporter.getFinishedSpans();
    expect(span?.status).toEqual({ code: SpanStatusCode.ERROR, message: 'no such model' });
    expect(span?.attributes['error.type']).toBe('BAD_REQUEST');
  });

  it('does not mark a cancelled call as an error: closing the tab is normal use', async () => {
    const { gateway } = setup(createFakeProvider([[text('ok')]]));
    const cancel = new AbortController();
    cancel.abort();

    await expect(drain(gateway.chat({ ...input, signal: cancel.signal }))).rejects.toThrow();

    const [span] = exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
    expect(span?.attributes['error.type']).toBe('ABORTED');
  });

  it('ends the span when the consumer stops reading early', async () => {
    const { gateway } = setup(createFakeProvider([[text('a'), text('b')]]));

    for await (const chunk of gateway.chat(input)) {
      expect(chunk).toEqual({ type: 'text', delta: 'a' });
      break;
    }

    expect(exporter.getFinishedSpans()).toHaveLength(1);
  });

  it('is a child of the span active when chat() is called, not when the stream is first read', async () => {
    const { gateway } = setup(createFakeProvider([[text('ok')]]));
    const tracer = trace.getTracer('test');
    const round = tracer.startSpan('agent round');

    // Async generators run on first read, in the reader's context: here, outside the round.
    const stream = context.with(trace.setSpan(context.active(), round), () => gateway.chat(input));
    await drain(stream);
    round.end();

    const [llm] = exporter.getFinishedSpans();
    expect(llm?.parentSpanContext?.spanId).toBe(round.spanContext().spanId);
  });
});

/** Reads metrics on demand: what the server's exporter would send, without sending it. */
class TestReader extends MetricReader {
  protected onForceFlush = () => Promise.resolve();
  protected onShutdown = () => Promise.resolve();
}

describe('gateway — metrics', () => {
  let reader: TestReader;
  beforeEach(() => {
    // A fresh SDK per test, registered before the gateway is built: instruments are created then.
    metrics.disable();
    reader = new TestReader();
    metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
  });

  /** Each data point of `name`: its labels and its value (a number, or a histogram's sum/count). */
  const points = async (name: string) => {
    const { resourceMetrics } = await reader.collect();
    const metric = resourceMetrics.scopeMetrics
      .flatMap((s) => s.metrics)
      .find((m) => m.descriptor.name === name);
    return (metric?.dataPoints ?? []).map((p: DataPoint<unknown>) => ({
      attributes: p.attributes,
      value: p.value,
    }));
  };

  it('measures each call: duration, time to first token, tokens in and out', async () => {
    const { gateway, clock } = setup(
      providerOf(function* () {
        clock.t += 250;
        yield text('Add a cache.');
        clock.t += 750;
        yield { type: 'tokens', inputTokens: 300, outputTokens: 40 };
      }),
      { model: 'qwen' },
    );

    await drain(gateway.chat(input));

    const ok = { model: 'qwen', outcome: 'ok' };
    expect(await points('llm_request_duration_seconds')).toEqual([
      { attributes: ok, value: expect.objectContaining({ count: 1, sum: 1 }) as unknown },
    ]);
    expect(await points('llm_time_to_first_token_seconds')).toEqual([
      { attributes: ok, value: expect.objectContaining({ count: 1, sum: 0.25 }) as unknown },
    ]);
    expect(await points('llm_tokens_total')).toEqual([
      { attributes: { model: 'qwen', direction: 'input' }, value: 300 },
      { attributes: { model: 'qwen', direction: 'output' }, value: 40 },
    ]);
  });

  it('counts a failed call by its error code, and how long it took to fail', async () => {
    const { gateway, clock } = setup(
      providerOf(() => {
        clock.t += 2000;
        throw new LlmError('BAD_REQUEST', 'no such model');
      }),
      { model: 'qwen' },
    );

    await expect(drain(gateway.chat(input))).rejects.toThrow();

    expect(await points('llm_request_duration_seconds')).toEqual([
      {
        attributes: { model: 'qwen', outcome: 'BAD_REQUEST' },
        value: expect.objectContaining({ count: 1, sum: 2 }) as unknown,
      },
    ]);
    expect(await points('llm_time_to_first_token_seconds')).toEqual([]);
  });
});
