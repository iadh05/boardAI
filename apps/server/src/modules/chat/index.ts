import type { Logger } from '../../core/logger.ts';
import { noErrorReporter, type ErrorReporter } from '../../core/observability/errorReporter.ts';
import { createChatRoutes } from './api/chatRoutes.ts';
import {
  createRecordFeedback,
  noFeedbackSink,
  type FeedbackSink,
} from './application/recordFeedback.ts';
import { createReviewBoard, type ReviewAgent } from './application/reviewBoard.ts';

// The chat module (architecture §6): the AI reviewer behind POST /api/chat.
// main.ts gives it an agent (infra/createReviewAgent) — or a fake one in tests.

export type ChatModuleDeps = {
  agent: ReviewAgent;
  logger: Logger;
  /** The model's context window (config): sizes the chat history budget. */
  contextTokens: number;
  reporter?: ErrorReporter;
  /** Where Accept/Reject feedback goes besides the metric (M1-26c): Phoenix, or nowhere. */
  feedback?: FeedbackSink;
};

export const createChatModule = ({
  agent,
  logger,
  contextTokens,
  reporter = noErrorReporter,
  feedback = noFeedbackSink,
}: ChatModuleDeps) => ({
  routes: createChatRoutes(
    createReviewBoard({ agent, contextTokens, reporter }),
    createRecordFeedback(feedback),
    logger,
  ),
});

export type { ReviewAgent } from './application/reviewBoard.ts';
export {
  createReviewAgent,
  createReviewAgentV2,
  type RoleGateways,
} from './infra/createReviewAgent.ts';
export { createPhoenixFeedback } from './infra/phoenixFeedback.ts';
