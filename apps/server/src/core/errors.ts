import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Logger } from './logger.ts';
import { noErrorReporter, type ErrorReporter } from './observability/errorReporter.ts';

// One error shape for every response (docs/rules/backend.md), and the one place where error
// codes become HTTP statuses.

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'BOARD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'LLM_UNAVAILABLE'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  BOARD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  LLM_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** An expected failure: its message is written for the user. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorBody = (code: ErrorCode, message: string, details?: unknown) => ({
  error: { code, message, ...(details !== undefined ? { details } : {}) },
});

const send = (c: Context, code: ErrorCode, message: string, details?: unknown) =>
  c.json(errorBody(code, message, details), STATUS[code]);

/**
 * Expected errors keep their message; anything else is a bug: logged, reported to error tracking,
 * and answered with a bland 500 that leaks nothing.
 */
export const onError =
  (logger: Logger, reporter: ErrorReporter = noErrorReporter): ErrorHandler =>
  (err, c) => {
    if (err instanceof AppError) return send(c, err.code, err.message, err.details);
    logger.error('unexpected error', { error: err.message, stack: err.stack });
    reporter.report(err, { path: c.req.path, requestId: c.res.headers.get('X-Request-Id') });
    return send(c, 'INTERNAL', 'Something went wrong on our side. Please try again.');
  };

export const notFound: NotFoundHandler = (c) =>
  send(c, 'NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`);
