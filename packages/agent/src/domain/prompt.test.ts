import { describe, expect, it } from 'vitest';
import { buildMessages, SYSTEM_PROMPT } from './prompt.ts';

describe('buildMessages', () => {
  it('puts the board with the latest user message, never in the system prompt', () => {
    const messages = buildMessages('n1 [api] "API"', [{ role: 'user', content: 'Review it' }]);

    expect(messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(SYSTEM_PROMPT).not.toContain('<board>');
    expect(messages[1]?.content).toMatch(/<board>\nn1 \[api\] "API"\n<\/board>\n\nReview it$/);
  });

  // Context test: the Planner named the dual write, the Architect never saw it: 0/5, and 5/5 with it.
  it('puts the plan after the board and before the findings, the question last', () => {
    const chat = [{ role: 'user' as const, content: 'Can we lose an order?' }];
    const messages = buildMessages('n1', chat, undefined, {
      plan: '- "two separate writes"',
      findings: '- [warn] no cache',
    });

    expect(messages[1]?.content).toMatch(
      /<\/board>\n[\s\S]*<plan>\n- "two separate writes"\n<\/plan>\n[\s\S]*<findings>[\s\S]*<\/findings>\n\nCan we lose an order\?$/,
    );
  });

  it('sends no plan block without a plan', () => {
    const messages = buildMessages('n1', [{ role: 'user', content: 'Review it' }]);
    expect(messages[1]?.content).not.toContain('<plan>');
  });

  it('still sends the board when the chat ends with an assistant message', () => {
    const messages = buildMessages('(empty board)', [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ]);

    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages.at(-1)?.content).toMatch(
      /<board>\n\(empty board\)\n<\/board>\n\nReview the design\.$/,
    );
  });
});
