import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import {
  boardToText,
  createAliases,
  type AgentInput,
  type ReviewerV2Event,
} from '@designroom/agent';
import type { LlmErrorCode } from '@designroom/ai-gateway';
import type { ChatEvent, ChatRequest, Result } from '@designroom/domain';
import type { Logger } from '../../../core/logger.ts';
import { noErrorReporter, type ErrorReporter } from '../../../core/observability/errorReporter.ts';
import { fitHistory, type ChatPolicyErrorCode } from '../domain/chatPolicy.ts';

// Use case "review my board" (architecture §10): apply the chat policy, run the agent, and turn
// its events into the chat API's events. Knows nothing of HTTP: the route streams what this yields.

/** The port this use case needs; infra/ builds it from @designroom/agent and the gateway. */
/** V1's agent, or V2's chain (AV2-09): the same events, plus V2's progress. */
export type ReviewAgent = { run(input: AgentInput): AsyncIterable<ReviewerV2Event> };

export type ReviewBoardDeps = {
  agent: ReviewAgent;
  /** The model's context window: how much board and history fit (chat policy). */
  contextTokens: number;
  /** Bugs inside the stream happen past Hono's error handler: they are reported from here. */
  reporter?: ErrorReporter;
};

/**
 * Per request: the request's own logger (it carries the request id), its cancel signal, and the
 * id itself, so a bug reported to error tracking can be joined to the request's log lines.
 */
export type ReviewOptions = { logger: Logger; signal?: AbortSignal; requestId?: string | null };

/** What the user reads when the model fails: what happened and what to do (general.md). */
const USER_MESSAGE: Record<LlmErrorCode, string> = {
  UNAVAILABLE: "Can't reach the model — is Ollama running?",
  TIMEOUT: 'The model took too long to answer. Try again in a moment.',
  BAD_REQUEST: 'The model rejected the request — check LLM_MODEL in apps/server/.env.',
  BAD_RESPONSE: 'The model sent an answer we could not read. Try again.',
  ABORTED: 'The request was cancelled.',
};

const SOMETHING_WENT_WRONG = 'Something went wrong on our side. Please try again.';

const tracer = trace.getTracer('@designroom/server');

/** How a chat stream ended: recorded on its span, the one place that sees the whole stream. */
type Outcome = 'done' | 'error' | 'cancelled' | 'stopped';

export const createReviewBoard =
  ({ agent, contextTokens, reporter = noErrorReporter }: ReviewBoardDeps) =>
  (
    request: ChatRequest,
    { logger, signal, requestId }: ReviewOptions,
  ): Result<AsyncIterable<ChatEvent>, ChatPolicyErrorCode> => {
    // Read now, at the call: the stream below is read later, from outside the request's span.
    const parent = context.active();
    const boardChars = boardToText(request.board, createAliases(request.board)).length;
    const history = fitHistory(request.messages, { boardChars, contextTokens });
    if (!history.ok) return history;
    const kept = history.value;
    if (kept.length < request.messages.length)
      logger.info('chat history trimmed', {
        kept: kept.length,
        sent: request.messages.length,
      });

    async function* events(): AsyncIterable<ChatEvent> {
      const span = tracer.startSpan(
        'review board',
        {
          attributes: {
            'openinference.span.kind': 'CHAIN',
            'designroom.chat.messages_sent': request.messages.length,
            'designroom.chat.messages_kept': kept.length,
          },
        },
        parent,
      );
      // Stays 'stopped' if the reader goes away (tab closed) before the end of the stream.
      let outcome: Outcome = 'stopped';
      const fail = (message: string) => {
        outcome = 'error';
        span.setStatus({ code: SpanStatusCode.ERROR, message });
      };
      const finish = (): ChatEvent => {
        if (outcome === 'stopped') outcome = 'done';
        return { type: 'done' };
      };
      try {
        try {
          // Run inside the review's span, so the agent's spans are its children.
          const run = context.with(trace.setSpan(parent, span), () =>
            agent.run({ board: request.board, messages: kept, signal }),
          );
          for await (const event of run) {
            switch (event.type) {
              case 'round': {
                const { type: _, usage, ...round } = event;
                logger.info('agent round', { ...round, ...usage });
                break;
              }
              case 'error':
                // A closed tab is normal use, not an outage: keep warnings for real failures.
                if (event.code === 'ABORTED') {
                  logger.info('chat cancelled');
                  outcome = 'cancelled';
                } else {
                  logger.warn('model failed', { code: event.code, error: event.message });
                  fail(event.message);
                }
                yield { type: 'error', message: USER_MESSAGE[event.code] };
                break;
              case 'done':
                yield finish();
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
          reporter.report(error, { where: 'chat stream', requestId });
          if (error instanceof Error) span.recordException(error);
          fail(error instanceof Error ? error.message : String(error));
          yield { type: 'error', message: SOMETHING_WENT_WRONG };
        }
        yield finish();
      } finally {
        // The span lasts the whole stream: chat duration and outcome live here, not in the access
        // log, which is written when the headers go out (M1-19 review).
        span.setAttribute('designroom.chat.outcome', outcome);
        span.end();
      }
    }
    return { ok: true, value: events() };
  };
