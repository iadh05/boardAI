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
      traceContent: false, // prompts and boards stay out of traces unless TRACE_CONTENT=true
      debugRoutes: false, // ENABLE_DEBUG_ROUTES=true turns /api/debug/* on
      llmCallLog: null, // off unless LLM_CALL_LOG is set: it records boards and chats
      // Every agent role on the local model unless LLM_ROLE_<ROLE> says otherwise (AV2-04).
      roles: { main: null, planner: null, specialist: null, critic: null },
    });
  });

  describe('a model per role (AV2-04)', () => {
    it('reads provider:model, with +think for thinking on, and the provider key', () => {
      const config = loadConfig({
        ...valid,
        LLM_ROLE_PLANNER: 'groq:qwen/qwen3.8-27b+think',
        LLM_ROLE_CRITIC: 'claude:claude-haiku-5-5',
        GROQ_API_KEY: 'gk',
        CLAUDE_API_KEY: 'ck',
      });
      expect(config.roles).toEqual({
        main: null,
        planner: { provider: 'groq', model: 'qwen/qwen3.8-27b', thinking: true, apiKey: 'gk' },
        specialist: null,
        critic: { provider: 'claude', model: 'claude-haiku-5-5', thinking: false, apiKey: 'ck' },
      });
    });

    it('a hosted role needs its provider’s key, named in the error', () => {
      expect(() => loadConfig({ ...valid, LLM_ROLE_PLANNER: 'gemini:gemini-3.5-flash' })).toThrow(
        /GEMINI_API_KEY/,
      );
    });

    it('refuses a role it cannot read, and Claude models other than Haiku and Sonnet', () => {
      expect(() => loadConfig({ ...valid, LLM_ROLE_MAIN: 'openai:gpt-9' })).toThrow(
        /LLM_ROLE_MAIN/,
      );
      expect(() =>
        loadConfig({ ...valid, LLM_ROLE_MAIN: 'claude:claude-opus-5-5', CLAUDE_API_KEY: 'k' }),
      ).toThrow(/claude-haiku-5-5/);
    });

    it('LLM_HOSTED=off puts every role back on the local model (nothing leaves the PC)', () => {
      const config = loadConfig({
        ...valid,
        LLM_ROLE_PLANNER: 'groq:qwen/qwen3.8-27b',
        GROQ_API_KEY: 'gk',
        LLM_HOSTED: 'off',
      });
      expect(config.roles.planner).toBeNull();
    });
  });

  // M1-26c: Phoenix gets the same traces; content (prompts, boards) only when asked for.
  it('sends traces to Phoenix too when its endpoint is set, and records content only if asked', () => {
    const config = loadConfig({
      ...valid,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      PHOENIX_COLLECTOR_ENDPOINT: 'http://localhost:6006',
      TRACE_CONTENT: 'true',
    });
    expect(config.telemetry).toEqual({
      endpoint: 'http://localhost:4318',
      phoenixEndpoint: 'http://localhost:6006',
    });
    expect(config.traceContent).toBe(true);
    // Phoenix is a second destination for traces: without the first, nothing is recorded.
    expect(() =>
      loadConfig({ ...valid, PHOENIX_COLLECTOR_ENDPOINT: 'http://localhost:6006' }),
    ).toThrow(/OTEL_EXPORTER_OTLP_ENDPOINT/);
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
