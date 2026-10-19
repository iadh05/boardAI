import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const valid = { LLM_BASE_URL: 'http://localhost:11434/v1' };

describe('loadConfig', () => {
  it('reads a valid environment, with defaults for the rest', () => {
    expect(loadConfig(valid)).toEqual({
      port: 3000,
      llm: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'designroom-qwen',
      },
      logLevel: 'info',
    });
  });

  it('reads PORT as a number', () => {
    expect(loadConfig({ ...valid, PORT: '4000' }).port).toBe(4000);
  });

  it('says clearly which variable is missing', () => {
    expect(() => loadConfig({})).toThrow(/LLM_BASE_URL/);
  });

  it('rejects a base URL that is not a URL', () => {
    expect(() => loadConfig({ LLM_BASE_URL: 'localhost' })).toThrow(/LLM_BASE_URL/);
  });

  it('the fake LLM (tests, CI) needs no URL', () => {
    expect(loadConfig({ LLM_PROVIDER: 'fake' }).llm).toEqual({
      provider: 'fake',
      model: 'designroom-qwen',
    });
  });
});
