import { describe, expect, it } from 'vitest';
import { buildMessages, SYSTEM_PROMPT } from './prompt.ts';

describe('buildMessages', () => {
  it('puts the board with the latest user message, never in the system prompt', () => {
    const messages = buildMessages('n1 [api] "API"', [{ role: 'user', content: 'Review it' }]);

    expect(messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(SYSTEM_PROMPT).not.toContain('<board>');
    expect(messages[1]?.content).toMatch(/<board>\nn1 \[api\] "API"\n<\/board>\n\nReview it$/);
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
