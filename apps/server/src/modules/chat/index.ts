import type { Logger } from '../../core/logger.ts';
import { noErrorReporter, type ErrorReporter } from '../../core/observability/errorReporter.ts';
import { createChatRoutes } from './api/chatRoutes.ts';
import { createReviewBoard, type ReviewAgent } from './application/reviewBoard.ts';

// The chat module (architecture §6): the AI reviewer behind POST /api/chat.
// main.ts gives it an agent (infra/createReviewAgent) — or a fake one in tests.

export type ChatModuleDeps = {
  agent: ReviewAgent;
  logger: Logger;
  /** The model's context window (config): sizes the chat history budget. */
  contextTokens: number;
  reporter?: ErrorReporter;
};

export const createChatModule = ({
  agent,
  logger,
  contextTokens,
  reporter = noErrorReporter,
}: ChatModuleDeps) => ({
  routes: createChatRoutes(createReviewBoard({ agent, contextTokens, reporter }), logger),
});

export type { ReviewAgent } from './application/reviewBoard.ts';
export { createReviewAgent } from './infra/createReviewAgent.ts';
