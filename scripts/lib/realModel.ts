// What the scripts that run the real model (local Qwen) share: building sample boards, checking
// that the model runs on the GPU, and running one review. Never part of `pnpm test`.

import { randomUUID } from 'node:crypto';
import { createAgent } from '../../packages/agent/src/index.ts';
import {
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

/** The model, through the same gateway and agent the server uses. */
export const connectRealModel = (model: string) => {
  const llm = createGateway({
    provider: createOpenAiCompatibleProvider({ baseUrl: `${OLLAMA}/v1`, model }),
    timeoutMs: 60_000,
    retries: 1,
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
