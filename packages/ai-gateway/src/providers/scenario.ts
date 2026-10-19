// The fake model for whole-system runs (e2e in CI, offline work): plays scripted conversations
// from a JSON file (LLM_PROVIDER=fake + LLM_SCENARIO_FILE). The unit-test fake (fake.ts) replays
// one script in order; this one has to serve a long-running server and parallel tests, so it is
// stateless: the scenario comes from the latest user message, the round from the conversation.

import { z } from 'zod';
import { LlmError, type LlmErrorCode } from '../errors.ts';
import type { LlmMessage, LlmProvider, ProviderChunk } from '../types.ts';

const ERROR_CODES = [
  'UNAVAILABLE',
  'TIMEOUT',
  'BAD_REQUEST',
  'BAD_RESPONSE',
] as const satisfies readonly LlmErrorCode[];

const ScenarioStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({
    type: z.literal('toolCall'),
    name: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal('error'), code: z.enum(ERROR_CODES), message: z.string() }),
]);

const ScenarioSchema = z.object({
  name: z.string().min(1),
  /** Plays when the latest user message contains this text (case-insensitive). */
  when: z.string(),
  /** One model answer per round; a round's tool results come back before the next one. */
  rounds: z.array(z.array(ScenarioStepSchema)),
});

export const ScenarioFileSchema = z.object({
  scenarios: z
    .array(ScenarioSchema)
    .min(1)
    // The first match wins, and an empty trigger matches everything: only last makes sense.
    .refine((list) => list.every((s, i) => s.when !== '' || i === list.length - 1), {
      message: 'A catch-all scenario (empty "when") must be the last one, or it hides the others',
    }),
});
export type ScenarioFile = z.infer<typeof ScenarioFileSchema>;

/** How the agent closes the board listing (packages/agent prompt.ts). */
const BOARD_END = '</board>';

/** Rounds already played since the latest user message = assistant turns after it. */
const roundIndex = (messages: readonly LlmMessage[]) => {
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  return messages.slice(lastUser + 1).filter((m) => m.role === 'assistant').length;
};

export const createScenarioProvider = (file: ScenarioFile): LlmProvider => ({
  async *stream({ messages }) {
    await Promise.resolve(); // a provider answers asynchronously
    const latest = messages.findLast((m) => m.role === 'user')?.content ?? '';
    // The agent sends the board listing in the same message: match only what follows it, so a
    // box labelled "Outage alerts" can't pick the outage scenario.
    const boardEnd = latest.lastIndexOf(BOARD_END);
    const question = (
      boardEnd < 0 ? latest : latest.slice(boardEnd + BOARD_END.length)
    ).toLowerCase();
    const scenario = file.scenarios.find((s) => question.includes(s.when.toLowerCase()));
    if (!scenario) {
      const triggers = file.scenarios.map((s) => `"${s.when}"`).join(', ');
      yield {
        type: 'text',
        delta: `(fake model) No scenario matches this message. Try: ${triggers}.`,
      };
      return;
    }

    const round = roundIndex(messages);
    let call = 0;
    for (const step of scenario.rounds[round] ?? []) {
      if (step.type === 'error') throw new LlmError(step.code, step.message);
      const chunk: ProviderChunk =
        step.type === 'text'
          ? step
          : {
              type: 'toolCall',
              call: {
                id: `call_${round + 1}_${++call}`,
                name: step.name,
                arguments: step.arguments,
              },
            };
      yield chunk;
    }
  },
});
