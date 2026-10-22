import { HOSTED_PROVIDERS, reasoningEffortFor, type HostedProviderName } from '../catalogue.ts';
import type { LlmProvider } from '../types.ts';
import { createAnthropicProvider, type SpendTracker } from './anthropic.ts';
import { createOpenAiCompatibleProvider } from './openAiCompatible.ts';

// One factory for every hosted model: where it is and how it is spoken to come from the
// catalogue. The server and the scripts both build hosted models here — never by hand.

export type HostedModel = {
  provider: HostedProviderName;
  model: string;
  apiKey: string;
  /** Thinking on (level 2, D13); off by default. */
  thinking?: boolean;
  /** Claude's spend tracker, shared by every Claude role (AV2-03). */
  spend?: SpendTracker;
  /** Injected so tests never reach the network. */
  fetch?: typeof fetch;
};

export const createHostedProvider = ({
  provider,
  model,
  apiKey,
  thinking = false,
  spend,
  fetch: fetchFn,
}: HostedModel): LlmProvider => {
  const injected = fetchFn ? { fetch: fetchFn } : {};
  if (HOSTED_PROVIDERS[provider].api === 'anthropic')
    return createAnthropicProvider({
      apiKey,
      model,
      ...(thinking ? { thinking: { effort: 'medium' } } : {}),
      ...(spend ? { spend } : {}),
      ...injected,
    });
  return createOpenAiCompatibleProvider({
    baseUrl: HOSTED_PROVIDERS[provider].baseUrl,
    model,
    apiKey,
    reasoningEffort: reasoningEffortFor(provider, model, thinking),
    ...injected,
  });
};
