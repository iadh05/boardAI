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
        timeoutMs: 60_000,
        contextTokens: 131_072, // designroom-qwen's num_ctx
      },
      logLevel: 'info',
      errorTracking: null, // off unless SENTRY_DSN is set
      telemetry: null, // off unless OTEL_EXPORTER_OTLP_ENDPOINT is set
      debugRoutes: false, // ENABLE_DEBUG_ROUTES=true turns /api/debug/* on
    });
  });

  it('reads the model’s context window, which sizes the chat budget', () => {
    expect(loadConfig({ ...valid, LLM_CONTEXT_TOKENS: '65536' }).llm.contextTokens).toBe(65_536);
    expect(() => loadConfig({ ...valid, LLM_CONTEXT_TOKENS: '1000' })).toThrow(
      /LLM_CONTEXT_TOKENS/,
    );
  });

  it('turns error tracking on with a Sentry DSN', () => {
    expect(
      loadConfig({ ...valid, SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1' }).errorTracking,
    ).toEqual({ dsn: 'https://key@o1.ingest.sentry.io/1', environment: 'development' });
    expect(() => loadConfig({ ...valid, SENTRY_DSN: 'not a url' })).toThrow(/SENTRY_DSN/);
  });

  it('exports traces when an OTLP endpoint is set', () => {
    expect(
      loadConfig({ ...valid, OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' }).telemetry,
    ).toEqual({ endpoint: 'http://localhost:4318' });
    expect(() => loadConfig({ ...valid, OTEL_EXPORTER_OTLP_ENDPOINT: 'grafana' })).toThrow(
      /OTEL_EXPORTER_OTLP_ENDPOINT/,
    );
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
      timeoutMs: 60_000,
      contextTokens: 131_072,
    });
  });

  it('reads the fake model’s scenario file', () => {
    expect(
      loadConfig({ LLM_PROVIDER: 'fake', LLM_SCENARIO_FILE: 'scenarios.json' }).llm,
    ).toMatchObject({
      provider: 'fake',
      scenarioFile: 'scenarios.json',
    });
  });

  it('reads the model timeout in milliseconds, and refuses one too short to load a model', () => {
    expect(loadConfig({ ...valid, LLM_TIMEOUT_MS: '90000' }).llm.timeoutMs).toBe(90_000);
    expect(() => loadConfig({ ...valid, LLM_TIMEOUT_MS: '10' })).toThrow(/LLM_TIMEOUT_MS/);
  });
});
