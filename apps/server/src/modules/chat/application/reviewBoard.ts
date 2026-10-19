import { boardToText, createAliases, type AgentEvent, type AgentInput } from '@designroom/agent';
import type { LlmErrorCode } from '@designroom/ai-gateway';
import type { ChatEvent, ChatRequest, Result } from '@designroom/domain';
import type { Logger } from '../../../core/logger.ts';
import { noErrorReporter, type ErrorReporter } from '../../../core/observability/errorReporter.ts';
import { fitHistory, type ChatPolicyErrorCode } from '../domain/chatPolicy.ts';

// Use case "review my board" (architecture §10): apply the chat policy, run the agent, and turn
// its events into the chat API's events. Knows nothing of HTTP: the route streams what this yields.

/** The port this use case needs; infra/ builds it from @designroom/agent and the gateway. */
export type ReviewAgent = { run(input: AgentInput): AsyncIterable<AgentEvent> };

export type ReviewBoardDeps = {
  agent: ReviewAgent;
  /** Bugs inside the stream happen past Hono's error handler: they are reported from here. */
  reporter?: ErrorReporter;
};

/** Per request: the request's own logger (it carries the request id) and its cancel signal. */
export type ReviewOptions = { logger: Logger; signal?: AbortSignal };

/** What the user reads when the model fails: what happened and what to do (general.md). */
const USER_MESSAGE: Record<LlmErrorCode, string> = {
  UNAVAILABLE: "Can't reach the model — is Ollama running?",
  TIMEOUT: 'The model took too long to answer. Try again in a moment.',
  BAD_REQUEST: 'The model rejected the request — check LLM_MODEL in apps/server/.env.',
  BAD_RESPONSE: 'The model sent an answer we could not read. Try again.',
  ABORTED: 'The request was cancelled.',
};

const SOMETHING_WENT_WRONG = 'Something went wrong on our side. Please try again.';

export const createReviewBoard =
  ({ agent, reporter = noErrorReporter }: ReviewBoardDeps) =>
  (
    request: ChatRequest,
    { logger, signal }: ReviewOptions,
  ): Result<AsyncIterable<ChatEvent>, ChatPolicyErrorCode> => {
    const boardChars = boardToText(request.board, createAliases(request.board)).length;
    const history = fitHistory(request.messages, { boardChars });
    if (!history.ok) return history;
    const kept = history.value;
    if (kept.length < request.messages.length)
      logger.info('chat history trimmed', {
        kept: kept.length,
        sent: request.messages.length,
      });

    async function* events(): AsyncIterable<ChatEvent> {
      try {
        for await (const event of agent.run({
          board: request.board,
          messages: kept,
          signal,
        })) {
          switch (event.type) {
            case 'round': {
              const { type: _, usage, ...round } = event;
              logger.info('agent round', { ...round, ...usage });
              break;
            }
            case 'error':
              // A closed tab is normal use, not an outage: keep warnings for real failures.
              if (event.code === 'ABORTED') logger.info('chat cancelled');
              else logger.warn('model failed', { code: event.code, error: event.message });
              yield { type: 'error', message: USER_MESSAGE[event.code] };
              break;
            case 'done':
              yield event;
              return;
            default:
              yield event;
          }
        }
      } catch (error) {
        // A bug, not a model failure: the browser still gets a terminal event (backend.md).
        logger.error('review failed', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        reporter.report(error, { where: 'chat stream' });
        yield { type: 'error', message: SOMETHING_WENT_WRONG };
      }
      yield { type: 'done' };
    }
    return { ok: true, value: events() };
  };
