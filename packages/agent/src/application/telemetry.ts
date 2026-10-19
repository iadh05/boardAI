import {
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
} from '@opentelemetry/api';

// The agent's spans (architecture §9): agent → scope check, rounds → tool calls. The gateway adds
// one LLM span inside the scope check and each round. Only the OpenTelemetry API is used: it does
// nothing until the server registers an SDK. `openinference.span.kind` lets Phoenix draw the tree
// as an agent trace (M1-26c).

const tracer = trace.getTracer('@designroom/agent');

type Kind = 'AGENT' | 'GUARDRAIL' | 'CHAIN' | 'TOOL';

/** A span under `parent`, and the context to run its children in. */
export const startSpan = (
  name: string,
  kind: Kind,
  parent: Context,
  attributes: Attributes = {},
) => {
  const span = tracer.startSpan(
    name,
    { attributes: { 'openinference.span.kind': kind, ...attributes } },
    parent,
  );
  return { span, inside: trace.setSpan(parent, span) };
};

export const markFailed = (span: Span, message: string) => {
  span.setStatus({ code: SpanStatusCode.ERROR, message });
};
