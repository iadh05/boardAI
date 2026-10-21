// What the scripts that run the real model (local Qwen) share: building sample boards, checking
// that the model runs on the GPU, and running one review. Never part of `pnpm test`.

import { randomUUID } from 'node:crypto';
import { createAgent } from '../../packages/agent/src/index.ts';
import {
  createAnthropicProvider,
  createGateway,
  createOpenAiCompatibleProvider,
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
 * Where a model runs (AV2-02). Hosted keys come from the environment, e.g.
 * `node --env-file=apps/server/.env scripts/review-samples.ts --provider groq --model qwen/qwen3.8-27b`.
 */
export const PROVIDERS = {
  ollama: { baseUrl: `${OLLAMA}/v1`, key: undefined },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', key: 'GROQ_API_KEY' },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    key: 'GEMINI_API_KEY',
  },
  // Claude through its own SDK (AV2-03): Haiku and Sonnet only, a daily $ cap in the provider.
  claude: { baseUrl: 'https://api.anthropic.com', key: 'CLAUDE_API_KEY' },
} as const;
export type ProviderName = keyof typeof PROVIDERS;

/** Thinking off, as each model takes it: gpt-oss can't turn it off; Gemini refuses "none". */
const reasoningEffortOf = (provider: ProviderName, model: string): string | null =>
  provider === 'gemini' ? null : model.startsWith('openai/gpt-oss') ? 'low' : 'none';

/** The model, through the same gateway and agent the server uses. */
export const connectRealModel = (model: string, provider: ProviderName = 'ollama') => {
  const where = PROVIDERS[provider];
  const apiKey = where.key ? process.env[where.key] : undefined;
  if (where.key && !apiKey) throw new Error(`${where.key} is not set (use --env-file).`);
  const llm = createGateway({
    provider:
      provider === 'claude' && apiKey
        ? createAnthropicProvider({ apiKey, model })
        : createOpenAiCompatibleProvider({
            baseUrl: where.baseUrl,
            model,
            reasoningEffort: reasoningEffortOf(provider, model),
            ...(apiKey ? { apiKey } : {}),
          }),
    timeoutMs: 60_000,
    // Hosted free tiers answer 429 with a wait (Groq up to ~25 s, Gemini ~31 s, measured): an eval
    // can wait a whole minute for one; the server doesn't (the gateway's 20 s default).
    retries: provider === 'ollama' ? 1 : 4,
    ...(provider === 'ollama' ? {} : { maxRetryWaitMs: 65_000 }),
  });
  // A canary, like the server's: the measured agent is the one users get.
  const canary = `dr-${randomUUID().slice(0, 8)}`;
  return { llm, agent: createAgent({ llm, newId: randomUUID, canary }) };
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
  agent: ReturnType<typeof createAgent>,
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
