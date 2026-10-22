import type { LlmProvider, ProviderChunk } from '@designroom/ai-gateway';
import { describe, expect, it, vi } from 'vitest';
import { createLlmProvider, createRoleProviders } from './llm.ts';

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

describe('createRoleProviders (AV2-04)', () => {
  const local: LlmProvider = {
    async *stream() {
      await Promise.resolve();
      yield { type: 'text', delta: 'local answer' };
    },
  };
  const noRoles = { main: null, planner: null, specialist: null, critic: null };
  const offline = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('fetch failed')));

  it('a role with no model of its own runs on the local model', async () => {
    const roles = createRoleProviders(noRoles, local, { fetch: offline });
    expect(await ask(roles.planner, 'hi')).toEqual([{ type: 'text', delta: 'local answer' }]);
  });

  it('a hosted role that cannot answer falls back to the local model, and says which role', async () => {
    const onFallback = vi.fn();
    const roles = createRoleProviders(
      {
        ...noRoles,
        planner: { provider: 'groq', model: 'qwen/qwen3.8-27b', thinking: true, apiKey: 'k' },
        critic: { provider: 'claude', model: 'claude-haiku-5-5', thinking: false, apiKey: 'k' },
      },
      local,
      { fetch: offline, onFallback },
    );

    expect(await ask(roles.planner, 'hi')).toEqual([{ type: 'text', delta: 'local answer' }]);
    expect(await ask(roles.critic, 'hi')).toEqual([{ type: 'text', delta: 'local answer' }]);
    expect(onFallback.mock.calls.map(([role]) => role as string)).toEqual(['planner', 'critic']);
    expect(offline).toHaveBeenCalled(); // the hosted model was asked first
  });
});
