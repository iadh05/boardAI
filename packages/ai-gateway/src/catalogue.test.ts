import { describe, expect, it, vi } from 'vitest';
import { HOSTED_PROVIDERS, MODELS, reasoningEffortFor } from './catalogue.ts';
import { createHostedProvider } from './providers/hosted.ts';

// The model catalogue (review of the AV2 PRs): every hosted provider and model we know, as data in
// one place — code never branches on a model's name.

describe('reasoningEffortFor', () => {
  it('thinking off, as each model takes it — from the catalogue, not from the name', () => {
    expect(reasoningEffortFor('groq', 'qwen/qwen3.8-27b', false)).toBe('none');
    expect(reasoningEffortFor('groq', 'openai/gpt-oss-120b', false)).toBe('low'); // can't be off
    expect(reasoningEffortFor('gemini', 'gemini-3.5-flash-lite', false)).toBeNull(); // refuses "none"
  });

  it('a model the catalogue does not know gets its provider’s default', () => {
    expect(reasoningEffortFor('groq', 'some/new-model', false)).toBe('none');
    expect(reasoningEffortFor('gemini', 'gemini-9-ultra', false)).toBeNull();
  });

  it('thinking on: the effort the catalogue gives', () => {
    expect(reasoningEffortFor('groq', 'qwen/qwen3.8-27b', true)).toBe('medium');
  });

  it('every model names a provider the catalogue knows', () => {
    for (const profile of Object.values(MODELS))
      expect(Object.keys(HOSTED_PROVIDERS)).toContain(profile.provider);
  });
});

describe('createHostedProvider', () => {
  it('talks to the provider’s URL from the catalogue, with its key and the model’s thinking setting', async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('data: [DONE]\n\n', { status: 200 })),
    );
    const provider = createHostedProvider({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      apiKey: 'test-key',
      fetch: fetchFn,
    });

    for await (const chunk of provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      signal: new AbortController().signal,
    }))
      void chunk;

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(`${HOSTED_PROVIDERS.groq.baseUrl}/chat/completions`);
    expect(init?.headers).toMatchObject({ authorization: 'Bearer test-key' });
    expect(JSON.parse(init?.body as string)).toMatchObject({ reasoning_effort: 'low' });
  });
});
