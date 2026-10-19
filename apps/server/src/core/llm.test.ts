import type { LlmProvider, ProviderChunk } from '@designroom/ai-gateway';
import { describe, expect, it } from 'vitest';
import { createLlmProvider } from './llm.ts';

const ask = async (provider: LlmProvider, content: string) => {
  const chunks: ProviderChunk[] = [];
  const input = {
    messages: [{ role: 'user' as const, content }],
    signal: new AbortController().signal,
  };
  for await (const chunk of provider.stream(input)) chunks.push(chunk);
  return chunks;
};

const scenarios = JSON.stringify({
  scenarios: [{ name: 'hello', when: 'hi', rounds: [[{ type: 'text', delta: 'Hello!' }]] }],
});

describe('createLlmProvider', () => {
  it('plays the scenario file for the fake model', async () => {
    const provider = createLlmProvider(
      {
        provider: 'fake',
        model: 'm',
        timeoutMs: 1_000,
        contextTokens: 16_384,
        scenarioFile: 'scenarios.json',
      },
      (path) => (path === 'scenarios.json' ? scenarios : ''),
    );
    expect(await ask(provider, 'hi')).toEqual([{ type: 'text', delta: 'Hello!' }]);
  });

  it('refuses to start with a scenario file that is not valid, naming the file', () => {
    expect(() =>
      createLlmProvider(
        {
          provider: 'fake',
          model: 'm',
          timeoutMs: 1_000,
          contextTokens: 16_384,
          scenarioFile: 'bad.json',
        },
        () => '{"scenarios": []}',
      ),
    ).toThrow(/bad\.json/);
    expect(() =>
      createLlmProvider(
        {
          provider: 'fake',
          model: 'm',
          timeoutMs: 1_000,
          contextTokens: 16_384,
          scenarioFile: 'broken.json',
        },
        () => '{not json',
      ),
    ).toThrow(/broken\.json/);
  });

  it('without a scenario file, the fake model says how to give it one', async () => {
    const provider = createLlmProvider(
      { provider: 'fake', model: 'm', timeoutMs: 1_000, contextTokens: 16_384 },
      () => '',
    );
    const [chunk] = await ask(provider, 'anything');
    expect(chunk).toMatchObject({
      type: 'text',
      delta: expect.stringMatching(/LLM_SCENARIO_FILE/) as unknown,
    });
  });

  it('talks to an OpenAI-compatible server otherwise', () => {
    const provider = createLlmProvider(
      {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'm',
        timeoutMs: 1_000,
        contextTokens: 16_384,
      },
      () => '',
    );
    expect(provider).toHaveProperty('stream');
  });
});
