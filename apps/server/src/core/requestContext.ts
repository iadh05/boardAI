import type { MiddlewareHandler } from 'hono';
import type { Logger } from './logger.ts';

/** Ids we accept from upstream (Nginx's $request_id): short and plain, nothing to inject. */
const VALID_ID = /^[\w-]{8,128}$/;

/**
 * Gives each request an id (Nginx's X-Request-Id, or a new one), returns it in the response,
 * and writes one access-log line with it, so the logs and traces of a request can be joined.
 */
export const requestContext =
  (logger: Logger): MiddlewareHandler =>
  async (c, next) => {
    const incoming = c.req.header('X-Request-Id');
    const requestId = incoming && VALID_ID.test(incoming) ? incoming : crypto.randomUUID();
    const started = performance.now();
    c.header('X-Request-Id', requestId);
    await next();
    logger.info('request', {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
    });
  };
