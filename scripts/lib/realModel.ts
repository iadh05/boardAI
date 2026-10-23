// What the scripts that run the real model (local Qwen) share: building sample boards, checking
// that the model runs on the GPU, and running one review. Never part of `pnpm test`.

import { randomUUID } from 'node:crypto';
import {
  createAgent,
  createReviewerV2,
  RULE_SPECIALISTS,
  type ReviewerV2Event,
} from '../../packages/agent/src/index.ts';
import {
  createGateway,
  createHostedProvider,
  createOpenAiCompatibleProvider,
  HOSTED_PROVIDER_NAMES,
  HOSTED_PROVIDERS,
  type AiGateway,
} from '../../packages/ai-gateway/src/index.ts';
import type { AgentOp, Board, ChatMessage, NodeKind } from '../../packages/domain/src/index.ts';

const OLLAMA = 'http://localhost:11434';

/** A board from boxes (laid out left to right) and arrows between them, by label. */
export const boardOf = (
  boxes: [NodeKind, string][],
  arrows: [from: string, to: string, label?: string, mode?: 'async'][],
): { board: Board; idOf: (label: string) => string } => {
  const nodes = boxes.map(([kind, label], i) => ({
    id: randomUUID(),
    kind,
    label,
    position: { x: i * 300, y: (i % 2) * 120 },
  }));
  const idOf = (label: string) => nodes.find((n) => n.label === label)?.id ?? label;
  const edges = arrows.map(([from, to, label, mode]) => ({
    id: randomUUID(),
    source: idOf(from),
    target: idOf(to),
    ...(label ? { label } : {}),
    ...(mode ? { mode } : {}),
  }));
  return { board: { nodes, edges }, idOf };
};

/**
 * Where a model runs: the local Ollama, or a hosted provider from the gateway's catalogue (AV2-02).
 * Hosted keys come from the environment: `node --env-file=apps/server/.env scripts/… --provider …`.
 */
export const PROVIDER_NAMES = ['ollama', ...HOSTED_PROVIDER_NAMES] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

const isProviderName = (name: string): name is ProviderName =>
  (PROVIDER_NAMES as readonly string[]).includes(name);

const providerOf = (provider: ProviderName, model: string, thinking: boolean) => {
  if (provider === 'ollama')
    return createOpenAiCompatibleProvider({
      baseUrl: `${OLLAMA}/v1`,
      model,
      ...(thinking ? { reasoningEffort: null } : {}),
    });
  const { keyVar } = HOSTED_PROVIDERS[provider];
  const apiKey = process.env[keyVar];
  if (!apiKey) throw new Error(`${keyVar} is not set (use --env-file).`);
  return createHostedProvider({ provider, model, apiKey, thinking });
};

/** One model through the same gateway the server uses; `thinking` turns it on (level 2, D13). */
export const gatewayOf = (model: string, provider: ProviderName = 'ollama', thinking = false) =>
  createGateway({
    provider: providerOf(provider, model, thinking),
    timeoutMs: thinking ? 120_000 : 60_000,
    // Hosted free tiers answer 429 with a wait (Groq up to ~25 s, Gemini ~31 s, measured): an eval
    // can wait a whole minute for one; the server doesn't (the gateway's 20 s default).
    retries: provider === 'ollama' ? 1 : 4,
    ...(provider === 'ollama' ? {} : { maxRetryWaitMs: 65_000 }),
  });

/** A canary, like the server's: the measured agent is the one users get. */
const canary = () => `dr-${randomUUID().slice(0, 8)}`;

/**
 * Wraps a role's gateway, e.g. to record every call it makes (ladder-eval). `role` says which:
 * "local" (V1, or V2's Main and Architect) or "planner".
 */
export type GatewayWrap = (role: 'local' | 'planner', llm: AiGateway) => AiGateway;
const unwrapped: GatewayWrap = (_, llm) => llm;

/** The model, through the same gateway and agent the server uses. */
export const connectRealModel = (
  model: string,
  provider: ProviderName = 'ollama',
  wrap: GatewayWrap = unwrapped,
) => {
  const llm = wrap('local', gatewayOf(model, provider));
  return { llm, agent: createAgent({ llm, newId: randomUUID, canary: canary() }) };
};

const THINK_SUFFIX = '+think';

/** "provider:model+think" → where a role runs (the server's LLM_ROLE_* format). */
export const parseRole = (spec: string) => {
  const at = spec.indexOf(':');
  const provider = spec.slice(0, at);
  if (!isProviderName(provider))
    throw new Error(`"${spec}": the provider must be one of ${PROVIDER_NAMES.join(', ')}`);
  const rest = spec.slice(at + 1);
  const thinking = rest.endsWith(THINK_SUFFIX);
  return { provider, model: thinking ? rest.slice(0, -THINK_SUFFIX.length) : rest, thinking };
};

/**
 * Agent V2 as the server builds it with AGENT_MODE=v2 (AV2-09): Main and the Architect on the
 * local model, the Planner on its own (`planner`, e.g. hosted with thinking), the rule specialists,
 * the Critic when asked (code checks; its LLM on `critic` when given).
 */
export const connectV2 = (
  model: string,
  provider: ProviderName = 'ollama',
  options: {
    planner?: string;
    critic?: boolean;
    criticModel?: string;
    wrap?: GatewayWrap;
    /** The Planner as a ready gateway (e.g. plans written by hand), instead of `planner`. */
    plannerGateway?: AiGateway;
  } = {},
) => {
  const wrap = options.wrap ?? unwrapped;
  const local = wrap('local', gatewayOf(model, provider));
  const role = (spec?: string) => {
    if (!spec) return local;
    const r = parseRole(spec);
    return gatewayOf(r.model, r.provider, r.thinking);
  };
  const given = options.plannerGateway;
  const planner = given
    ? wrap('planner', given)
    : options.planner
      ? wrap('planner', role(options.planner))
      : local;
  const agent = createReviewerV2({
    main: local,
    planner,
    architect: createAgent({ llm: local, newId: randomUUID, canary: canary() }),
    specialists: RULE_SPECIALISTS,
    ...(options.critic
      ? { critic: options.criticModel ? { llm: role(options.criticModel) } : {} }
      : {}),
  });
  return { llm: local, agent };
};

/** Measure on the GPU or not at all: on the CPU a run takes minutes and times out (M1-24). */
export const assertOnGpu = async (model: string) => {
  await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    body: JSON.stringify({ model, prompt: 'hi', stream: false, options: { num_predict: 1 } }),
  }).catch(() => {
    throw new Error(
      `Ollama is not running: start the Ollama app (not \`ollama serve\` from a shell).`,
    );
  });
  const ps = (await (await fetch(`${OLLAMA}/api/ps`)).json()) as {
    models: { name: string; size: number; size_vram: number }[];
  };
  const loaded = ps.models.find((m) => m.name.startsWith(model));
  if (!loaded || loaded.size_vram < loaded.size)
    throw new Error(
      `${model} is not fully on the GPU (ollama ps): results would be too slow to trust.`,
    );
};

export type Run = { text: string; ops: AgentOp[]; summary: string; ms: number; error?: string };

/** One review, as the browser would receive it: the streamed text, the proposal, any error. */
export const runReview = async (
  agent: { run(input: { board: Board; messages: ChatMessage[] }): AsyncIterable<ReviewerV2Event> },
  board: Board,
  messages: ChatMessage[],
): Promise<Run> => {
  const started = performance.now();
  let text = '';
  let ops: AgentOp[] = [];
  let summary = '';
  let error: string | undefined;
  for await (const event of agent.run({ board, messages })) {
    if (event.type === 'text') text += event.delta;
    else if (event.type === 'proposal') ({ ops, summary } = event.proposal);
    else if (event.type === 'error') error = `${event.code}: ${event.message}`;
  }
  return { text, ops, summary, ms: performance.now() - started, ...(error ? { error } : {}) };
};

export const oneLine = (s: string, max = 220) => s.replace(/\s+/g, ' ').trim().slice(0, max);
