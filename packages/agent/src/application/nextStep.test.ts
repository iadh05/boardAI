import type { AiGateway, ChatInput, LlmChunk } from '@designroom/ai-gateway';
import { describe, expect, it } from 'vitest';
import { decideNext } from './nextStep.ts';

// The Planner orchestrates (ADR-011, AV2-11b): after the specialists ran, it decides whether one
// more check is worth it or the findings answer the request. Code validates what it decides; when
// there is nothing to decide, the model isn't asked at all.

const plannerAnswering = (answer: LlmChunk[] | 'fails') => {
  const calls: ChatInput[] = [];
  const llm: AiGateway = {
    async *chat(input) {
      calls.push(input);
      await Promise.resolve();
      if (answer === 'fails') throw new Error('model down');
      yield* answer;
    },
  };
  return { llm, calls };
};
const nextStep = (args: unknown): LlmChunk[] => [
  { type: 'toolCall', call: { id: 'n1', name: 'next_step', arguments: args } },
];

const after = (llm: AiGateway, ran: string[], budgetLeft = 4) =>
  decideNext(llm, {
    question: 'Is my database safe?',
    ran,
    findingsText: '- data: one copy of the data (Postgres), critical',
    budgetLeft,
  });

describe('decideNext', () => {
  it('adds a specialist that has not run yet when the Planner asks for it', async () => {
    const { llm } = plannerAnswering(
      nextStep({ action: 'add', specialists: ['security'], why: 'the DB may be reachable' }),
    );
    expect(await after(llm, ['data'])).toEqual({
      action: 'add',
      specialists: ['security'],
      why: 'the DB may be reachable',
    });
  });

  it('finishes when the Planner says the findings answer the request', async () => {
    const { llm } = plannerAnswering(nextStep({ action: 'finish', why: 'answered' }));
    expect(await after(llm, ['data'])).toEqual({ action: 'finish', why: 'answered' });
  });

  it('does not ask the model when every specialist already ran', async () => {
    const { llm, calls } = plannerAnswering(nextStep({ action: 'add', specialists: ['data'] }));
    expect(await after(llm, ['data', 'security'])).toMatchObject({ action: 'finish' });
    expect(calls).toHaveLength(0);
  });

  it('does not ask the model when the task budget is used up', async () => {
    const { llm, calls } = plannerAnswering(nextStep({ action: 'add', specialists: ['security'] }));
    expect(await after(llm, ['data'], 0)).toMatchObject({ action: 'finish' });
    expect(calls).toHaveLength(0);
  });

  it('drops specialists that already ran or do not exist; nothing left means finish', async () => {
    const { llm } = plannerAnswering(
      nextStep({ action: 'add', specialists: ['data', 'astrology'] }),
    );
    expect(await after(llm, ['data'])).toMatchObject({ action: 'finish' });
  });

  it('finishes when the answer cannot be read, or the model fails', async () => {
    expect(
      await after(plannerAnswering(nextStep({ action: 'dance' })).llm, ['data']),
    ).toMatchObject({ action: 'finish' });
    expect(await after(plannerAnswering('fails').llm, ['data'])).toMatchObject({
      action: 'finish',
    });
  });

  it('tells the model what already ran and what was found, as data', async () => {
    const { llm, calls } = plannerAnswering(nextStep({ action: 'finish' }));
    await after(llm, ['data']);
    const user = calls[0]?.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(user).toContain('Already ran: data');
    expect(user).toContain('<findings>');
    expect(user).toContain('one copy of the data');
  });
});
