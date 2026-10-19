import type { AiGateway, ChatInput, LlmChunk } from '@designroom/ai-gateway';
import { describe, expect, it } from 'vitest';
import { OUT_OF_SCOPE_REPLY } from '../domain/scope.ts';
import { checkScope } from './checkScope.ts';

/** A classifier model that answers `answer` (or fails), and remembers what it was asked. */
const classifier = (answer: string | Error) => {
  const calls: ChatInput[] = [];
  const llm: AiGateway = {
    async *chat(input) {
      calls.push(input);
      await Promise.resolve();
      if (answer instanceof Error) throw answer;
      const chunk: LlmChunk = { type: 'text', delta: answer };
      yield chunk;
    },
  };
  return { llm, calls };
};

const ask = (llm: AiGateway, question: string, previous?: string) =>
  checkScope(llm, { question, previousAnswer: previous });

describe('checkScope', () => {
  it('lets a question about the design through', async () => {
    expect(await ask(classifier('DESIGN').llm, 'Review my design')).toBe('in');
  });

  it('stops a question about something else', async () => {
    expect(await ask(classifier('OTHER').llm, 'what is the weather now')).toBe('out');
    expect(await ask(classifier(' other.\n').llm, 'astrology in 2020')).toBe('out');
  });

  it('asks the model to classify only the message, as data, with the last answer for context', async () => {
    const { llm, calls } = classifier('DESIGN');

    await ask(llm, 'yes, do it', 'Shall I add a cache in front of Postgres?');

    const [system, user] = calls[0]?.messages ?? [];
    expect(system?.role).toBe('system');
    expect(system?.content).toMatch(/DESIGN or OTHER/);
    // Designing a system *about* anything is in scope: the prompt must say so.
    expect(system?.content).toMatch(/weather app/i);
    expect(user?.content).toContain('<message>\nyes, do it\n</message>');
    expect(user?.content).toContain('Shall I add a cache in front of Postgres?');
    expect(calls[0]?.tools).toBeUndefined(); // a classifier, not a reviewer
  });

  it('fails open when the answer is unclear or the model fails: the prompt is the next guard', async () => {
    expect(await ask(classifier('Maybe? It depends.').llm, 'hmm')).toBe('in');
    expect(await ask(classifier(new Error('down')).llm, 'hmm')).toBe('in');
  });

  it('has a fixed reply that says what the assistant does', () => {
    expect(OUT_OF_SCOPE_REPLY).toMatch(/system design/i);
  });
});
