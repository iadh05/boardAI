import type { AiGateway, ChatInput, LlmChunk } from '@designroom/ai-gateway';
import { describe, expect, it } from 'vitest';
import { FALLBACK_PLAN, makePlan } from './planner.ts';

// The Planner (AV2-07, S2): reads the request, picks the flow and the specialists, and asks back
// only what changes the answer (D2). One call to make_plan; anything it gets wrong falls back to
// a full review — a bad plan never blocks an answer.

const plannerAnswering = (args: unknown) => {
  const calls: ChatInput[] = [];
  const llm: AiGateway = {
    async *chat(input) {
      calls.push(input);
      await Promise.resolve();
      const chunk: LlmChunk = {
        type: 'toolCall',
        call: { id: 'p1', name: 'make_plan', arguments: args },
      };
      yield chunk;
    },
  };
  return { llm, calls };
};

const ask = (llm: AiGateway, question: string, allowQuestions = true) =>
  makePlan(llm, {
    question,
    boardText: 'n1 [api] "Orders API" -> n2 [database] "Postgres"',
    allowQuestions,
  });

describe('makePlan', () => {
  it('a review: the flow and the specialists the planner chose', async () => {
    const { llm } = plannerAnswering({ flow: 'review', specialists: ['data', 'security'] });
    expect(await ask(llm, 'Review my design')).toEqual({
      flow: 'review',
      specialists: ['data', 'security'],
      questions: [],
      assumptions: [],
    });
  });

  it('a deep dive on one concern', async () => {
    const { llm } = plannerAnswering({ flow: 'deep-dive', specialists: ['security'] });
    expect(await ask(llm, 'Is it secure?')).toMatchObject({
      flow: 'deep-dive',
      specialists: ['security'],
    });
  });

  it('keeps at most 3 questions, and none once the chat has had its clarifying rounds (D2)', async () => {
    const questions = ['Users?', 'Peak?', 'Budget?', 'Region?'];
    const { llm } = plannerAnswering({ flow: 'review', specialists: ['data'], questions });

    expect((await ask(llm, 'Review my design')).questions).toEqual(['Users?', 'Peak?', 'Budget?']);
    expect((await ask(llm, 'Review my design', false)).questions).toEqual([]);
  });

  it('drops a specialist that does not exist', async () => {
    const { llm } = plannerAnswering({ flow: 'review', specialists: ['data', 'astrology'] });
    expect((await ask(llm, 'Review')).specialists).toEqual(['data']);
  });

  it('a plan it cannot read falls back to a full review', async () => {
    const { llm } = plannerAnswering({ flow: 'party' });
    expect(await ask(llm, 'Review my design')).toEqual(FALLBACK_PLAN);
  });

  it('a planner that answers in words, or fails, falls back too', async () => {
    const words: AiGateway = {
      async *chat() {
        await Promise.resolve();
        yield { type: 'text', delta: 'I think we should review it.' };
      },
    };
    const failing: AiGateway = {
      // eslint-disable-next-line require-yield -- a gateway that fails before answering
      async *chat() {
        await Promise.resolve();
        throw Object.assign(new Error('down'), { name: 'LlmError', code: 'UNAVAILABLE' });
      },
    };
    expect(await ask(words, 'Review')).toEqual(FALLBACK_PLAN);
    expect(await ask(failing, 'Review')).toEqual(FALLBACK_PLAN);
  });

  it('the board and the question go as data, after the planner’s instructions', async () => {
    const { llm, calls } = plannerAnswering({ flow: 'review', specialists: ['data'] });
    await ask(llm, 'Review my design');

    const [system, user] = calls[0]?.messages ?? [];
    expect(system?.role).toBe('system');
    expect(system?.content).not.toContain('Orders API');
    expect(user?.content).toMatch(
      /<board>[\s\S]*Orders API[\s\S]*<\/board>[\s\S]*Review my design/,
    );
    expect(calls[0]?.tools?.map((t) => t.name)).toEqual(['make_plan']);
  });
});
