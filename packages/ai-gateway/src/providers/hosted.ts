import { HOSTED_PROVIDERS, reasoningEffortFor, type HostedProviderName } from '../catalogue.ts';
import type { LlmProvider } from '../types.ts';
import { createOpenAiCompatibleProvider } from './openAiCompatible.ts';

// One factory for every hosted model: where it is and how it is spoken to come from the
// catalogue. The server and the scripts both build hosted models here — never by hand.

export type HostedModel = {
  provider: HostedProviderName;
  model: string;
  apiKey: string;
  /** Thinking on (level 2, D13); off by default. */
  thinking?: boolean;
  /** Injected so tests never reach the network. */
  fetch?: typeof fetch;
};

export const createHostedProvider = ({
  provider,
  model,
  apiKey,
  thinking = false,
  fetch: fetchFn,
}: HostedModel): LlmProvider =>
  createOpenAiCompatibleProvider({
    baseUrl: HOSTED_PROVIDERS[provider].baseUrl,
    model,
    apiKey,
    reasoningEffort: reasoningEffortFor(provider, model, thinking),
    ...(fetchFn ? { fetch: fetchFn } : {}),
  });
