import {
  metrics,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
} from '@opentelemetry/api';
import { LlmError } from './errors.ts';
import type { LlmMessage, LlmToolCall, Usage } from './types.ts';

// One span per LLM call (architecture §9). Only the OpenTelemetry *API* is used here: it does
// nothing until the server registers an SDK, so tests and other users of this package pay nothing.
// Attribute names follow two conventions on purpose: OTel GenAI (`gen_ai.*`, read by Grafana/Tempo)
// and OpenInference (`openinference.*`, `llm.*`, read by Phoenix, M1-26c).

const tracer = trace.getTracer('@designroom/ai-gateway');

/** Starts the call's span under `parent`: the context active when chat() was called. */
export const startLlmSpan = (model: string | undefined, parent: Context): Span =>
  tracer.startSpan(
    model ? `chat ${model}` : 'chat',
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'openinference.span.kind': 'LLM',
        'gen_ai.operation.name': 'chat',
        ...(model ? { 'gen_ai.request.model': model, 'llm.model_name': model } : {}),
      },
    },
    parent,
  );

export const usageAttributes = (usage: Usage): Attributes => ({
  'gen_ai.usage.input_tokens': usage.inputTokens,
  'gen_ai.usage.output_tokens': usage.outputTokens,
  'llm.token_count.prompt': usage.inputTokens,
  'llm.token_count.completion': usage.outputTokens,
  'llm.token_count.total': usage.inputTokens + usage.outputTokens,
  'designroom.llm.attempts': usage.attempts,
  ...(usage.timeToFirstTokenMs === null
    ? {}
    : { 'designroom.llm.time_to_first_token_ms': usage.timeToFirstTokenMs }),
});

/**
 * What was sent, as OpenInference attributes (M1-26c): Phoenix shows them as the call's messages.
 * Recorded only when the server turns content on (local Phoenix): they hold prompts and boards.
 */
export const inputAttributes = (messages: readonly LlmMessage[]): Attributes => {
  const attributes: Attributes = {};
  messages.forEach((m, i) => {
    attributes[`llm.input_messages.${i}.message.role`] = m.role;
    attributes[`llm.input_messages.${i}.message.content`] = m.content;
  });
  const question = messages.findLast((m) => m.role === 'user');
  if (question) attributes['input.value'] = question.content;
  return attributes;
};

/** What came back: the text and the tool calls (M1-26c). */
export const outputAttributes = (text: string, toolCalls: readonly LlmToolCall[]): Attributes => {
  const out = 'llm.output_messages.0.message';
  const attributes: Attributes = {
    [`${out}.role`]: 'assistant',
    [`${out}.content`]: text,
    'output.value': text,
  };
  toolCalls.forEach((call, i) => {
    attributes[`${out}.tool_calls.${i}.tool_call.function.name`] = call.name;
    attributes[`${out}.tool_calls.${i}.tool_call.function.arguments`] = JSON.stringify(
      call.arguments,
    );
  });
  return attributes;
};

/** A failure marks the span as an error, except a cancel: a closed tab is normal use. */
export const recordFailure = (span: Span, error: unknown) => {
  const code = error instanceof LlmError ? error.code : undefined;
  span.setAttribute('error.type', code ?? (error instanceof Error ? error.name : 'unknown'));
  if (code === 'ABORTED') return;
  if (error instanceof Error) span.recordException(error);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : String(error),
  });
};

/** Seconds: a local model answers in 1–60 s; the default buckets stop at 10 ms resolution. */
const SECONDS_BUCKETS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120];

/**
 * The gateway's metrics (architecture §9): what Grafana's "AI reviewer" dashboard plots.
 * Created by createGateway, not at import: the metrics API has no proxy, so a meter taken before
 * the server registers its SDK would stay a no-op for good.
 */
export const createLlmMetrics = () => {
  const meter = metrics.getMeter('@designroom/ai-gateway');
  const duration = meter.createHistogram('llm_request_duration_seconds', {
    description: 'One model call, from the request to the last chunk, retries included.',
    unit: 's',
    advice: { explicitBucketBoundaries: SECONDS_BUCKETS },
  });
  const firstToken = meter.createHistogram('llm_time_to_first_token_seconds', {
    description: 'From the request to the first text or tool call: what the user waits for.',
    unit: 's',
    advice: { explicitBucketBoundaries: SECONDS_BUCKETS },
  });
  const tokens = meter.createCounter('llm_tokens_total', {
    description: 'Tokens sent to (input) and produced by (output) the model.',
    unit: '{token}',
  });
  return {
    succeeded: (model: string, usage: Usage) => {
      const labels = { model, outcome: 'ok' };
      duration.record(usage.latencyMs / 1000, labels);
      if (usage.timeToFirstTokenMs !== null)
        firstToken.record(usage.timeToFirstTokenMs / 1000, labels);
      tokens.add(usage.inputTokens, { model, direction: 'input' });
      tokens.add(usage.outputTokens, { model, direction: 'output' });
    },
    /** The reader stopped before the end: no usage was reported, the duration is still known. */
    stopped: (model: string, ms: number) => {
      duration.record(ms / 1000, { model, outcome: 'stopped' });
    },
    failed: (model: string, error: unknown, ms: number) => {
      const outcome = error instanceof LlmError ? error.code : 'BUG';
      duration.record(ms / 1000, { model, outcome });
    },
  };
};
