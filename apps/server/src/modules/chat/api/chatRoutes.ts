import { ChatRequestSchema } from '@designroom/domain';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import type { z } from 'zod';
import { AppError } from '../../../core/errors.ts';
import type { Logger } from '../../../core/logger.ts';
import type { RequestVariables } from '../../../core/requestContext.ts';
import type { createReviewBoard } from '../application/reviewBoard.ts';

// POST /api/chat (architecture §4.4): validate the request, then stream the review as
// server-sent events, one JSON ChatEvent per event. No rules here — they live in the use case.

type ReviewBoard = ReturnType<typeof createReviewBoard>;

const details = (error: z.ZodError) =>
  error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));

/** The contract's own size check on the board is a 413, not a malformed request. */
const isBoardTooLarge = (error: z.ZodError) =>
  error.issues.some((issue) => issue.code === 'custom' && issue.path.join('.') === 'board');

/** Same as Nginx's client_max_body_size: the server is also reached directly (dev, CI). */
const MAX_BODY_BYTES = 1024 * 1024;

const tooLarge = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: () => {
    throw new AppError('BOARD_TOO_LARGE', 'The request is too large (1 MB at most).');
  },
});

export const createChatRoutes = (reviewBoard: ReviewBoard, moduleLogger: Logger) =>
  new Hono<{ Variables: RequestVariables }>().post('/', tooLarge, async (c) => {
    // The request's logger carries its id (requestContext); the module's is the fallback.
    const logger = c.get('logger') ?? moduleLogger;
    const json: unknown = await c.req.json().catch(() => {
      throw new AppError('VALIDATION_FAILED', 'The request body must be JSON.');
    });
    const parsed = ChatRequestSchema.safeParse(json);
    if (!parsed.success) {
      if (isBoardTooLarge(parsed.error))
        throw new AppError('BOARD_TOO_LARGE', parsed.error.issues[0]?.message ?? 'Board too large');
      throw new AppError(
        'VALIDATION_FAILED',
        'The chat request is invalid.',
        details(parsed.error),
      );
    }

    // The browser closing the tab aborts this signal: the agent and the model call stop with it.
    const started = reviewBoard(parsed.data, {
      logger,
      signal: c.req.raw.signal,
      requestId: c.res.headers.get('X-Request-Id'), // set by requestContext
    });
    if (!started.ok) throw new AppError('BOARD_TOO_LARGE', started.error.message);

    // Nginx buffers responses unless told not to; the chat must arrive token by token (§14).
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      for await (const event of started.value)
        await stream.writeSSE({ data: JSON.stringify(event) });
    });
  });
