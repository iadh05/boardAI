import {
  metrics,
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

/**
 * A tool name fit for a span name or a metric label. The model can call a tool that doesn't exist,
 * under any name: each made-up name would be a new label, so it becomes "unknown".
 */
export const toolLabel = (name: string, known: readonly string[]) =>
  known.includes(name) ? name : 'unknown';

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

/**
 * The agent's metrics (architecture §9). Created by createAgent, not at import: the metrics API has
 * no proxy, so a meter taken before the server registers its SDK would stay a no-op for good.
 */
export const createAgentMetrics = () => {
  const meter = metrics.getMeter('@designroom/agent');
  const rounds = meter.createHistogram('agent_rounds', {
    description: 'Model calls in one review: many means the model keeps fixing its tool calls.',
    unit: '{round}',
    advice: { explicitBucketBoundaries: [1, 2, 3, 4, 5, 6] },
  });
  const toolCalls = meter.createCounter('agent_tool_calls_total', {
    description: 'Tool calls by tool and outcome: errors are calls the draft refused.',
    unit: '{call}',
  });
  const scopeChecks = meter.createCounter('agent_scope_checks_total', {
    description: 'Scope guard verdicts: "out" questions got the fixed reply.',
    unit: '{check}',
  });
  return {
    review: (count: number) => rounds.record(count),
    toolCall: (tool: string, ok: boolean) =>
      toolCalls.add(1, { tool, outcome: ok ? 'ok' : 'error' }),
    scope: (verdict: 'in' | 'out') => scopeChecks.add(1, { verdict }),
  };
};
