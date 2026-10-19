import {
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
} from '@opentelemetry/api';
import { LlmError } from './errors.ts';
import type { Usage } from './types.ts';

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
