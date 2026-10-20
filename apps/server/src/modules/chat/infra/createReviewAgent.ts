import { createAgent } from '@designroom/agent';
import type { AiGateway } from '@designroom/ai-gateway';
import type { ReviewAgent } from '../application/reviewBoard.ts';
import { CHAT_POLICY } from '../domain/chatPolicy.ts';

/**
 * The real agent behind the use case's port: our agent package on the injected LLM gateway. The
 * canary is new at each server start, so it can't be learned from the repo (M1-24d).
 */
export const createReviewAgent = (
  llm: AiGateway,
  options: { recordContent?: boolean } = {},
): ReviewAgent =>
  createAgent({
    llm,
    ...options,
    newId: () => crypto.randomUUID(),
    maxRounds: CHAT_POLICY.maxRounds,
    canary: `dr-${crypto.randomUUID().slice(0, 8)}`,
  });
