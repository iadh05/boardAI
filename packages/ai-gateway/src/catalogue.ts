// The model catalogue: every hosted provider and every model we know, as data, in one place. Code
// never names a model or a provider URL — it reads them here (docs/rules/general.md, "no magic
// strings"; a lint rule checks it). Adding a provider or a model is one entry, with its test.
// Which model a role uses is not here: that's configuration (LLM_ROLE_*).

/** How a provider is reached: its URL, the env variable with its key, the API it speaks. */
type HostedProvider = {
  baseUrl: string;
  keyVar: string;
  /** Claude speaks its own Messages API, through the official SDK (AV2-03). */
  api: 'openai-compatible' | 'anthropic';
  /** `reasoning_effort` for thinking off when the model has no setting of its own. */
  reasoningOff: string | null;
  /** Only the catalogue's models may be used (the owner's $100 budget rule for Claude). */
  listedModelsOnly?: boolean;
};

export const HOSTED_PROVIDERS = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    keyVar: 'GROQ_API_KEY',
    api: 'openai-compatible',
    reasoningOff: 'none',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyVar: 'GEMINI_API_KEY',
    api: 'openai-compatible',
    reasoningOff: null, // some Gemini models refuse "none" (400): left out (AV2-02)
  },
  claude: {
    baseUrl: 'https://api.anthropic.com',
    keyVar: 'CLAUDE_API_KEY',
    api: 'anthropic',
    reasoningOff: null, // not a reasoning_effort API: each model's `claudeThinkingOff`
    listedModelsOnly: true,
  },
} as const satisfies Record<string, HostedProvider>;

export type HostedProviderName = keyof typeof HOSTED_PROVIDERS;
export const HOSTED_PROVIDER_NAMES = Object.keys(HOSTED_PROVIDERS) as HostedProviderName[];

/** What a model needs that its provider's default doesn't give. */
type ModelProfile = {
  provider: HostedProviderName;
  /** `reasoning_effort` for thinking off; absent: the provider's default. */
  reasoningOff?: string | null;
  /** $ per million tokens, input / output (prompts under 100K tokens): the spend guard's prices. */
  priceUsdPerM?: { input: number; output: number };
  /** Claude: how this model turns thinking off (Sonnet 5.5 refuses "disabled": a 400). */
  claudeThinkingOff?: 'disabled' | 'between_tools';
};

/** The models measured on 2026-10-21/22 (docs/evals/AV2-10-v1-vs-v2.md). Prices 2026-10. */
export const MODELS: Record<string, ModelProfile> = {
  'qwen/qwen3.8-27b': { provider: 'groq' },
  'openai/gpt-oss-120b': { provider: 'groq', reasoningOff: 'low' }, // can't turn thinking off
  'openai/gpt-oss-20b': { provider: 'groq', reasoningOff: 'low' },
  'gemini-3.5-flash-lite': { provider: 'gemini' },
  'gemini-3.5-flash': { provider: 'gemini' },
  'claude-haiku-5-5': {
    provider: 'claude',
    priceUsdPerM: { input: 0.1, output: 0.5 },
    claudeThinkingOff: 'disabled',
  },
  'claude-sonnet-5-5': {
    provider: 'claude',
    priceUsdPerM: { input: 2, output: 10 },
    claudeThinkingOff: 'between_tools',
  },
};

/** The Claude models the owner allows (Haiku and Sonnet: the $100 budget). */
export const CLAUDE_MODELS = Object.keys(MODELS).filter((id) => MODELS[id]?.provider === 'claude');

/** `reasoning_effort` with thinking on (level 2, D13). */
const THINKING_ON = 'medium';

/** The `reasoning_effort` to send, or null to leave it out. */
export const reasoningEffortFor = (
  provider: HostedProviderName,
  model: string,
  thinking: boolean,
): string | null => {
  if (thinking) return THINKING_ON;
  const profile = MODELS[model];
  return profile && 'reasoningOff' in profile
    ? (profile.reasoningOff ?? null)
    : HOSTED_PROVIDERS[provider].reasoningOff;
};
