import { createAgent } from '@designroom/agent';
import type { AiGateway } from '@designroom/ai-gateway';
import type { ReviewAgent } from '../application/reviewBoard.ts';
import { CHAT_POLICY } from '../domain/chatPolicy.ts';

/** The real agent behind the use case's port: our agent package on the injected LLM gateway. */
export const createReviewAgent = (llm: AiGateway): ReviewAgent =>
  createAgent({ llm, newId: () => crypto.randomUUID(), maxRounds: CHAT_POLICY.maxRounds });
