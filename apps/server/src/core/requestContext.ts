import { isSpanContextValid, trace } from '@opentelemetry/api';
import type { MiddlewareHandler } from 'hono';
import type { Logger } from './logger.ts';

/** Ids we accept from upstream (Nginx's $request_id): short and plain, nothing to inject. */
const VALID_ID = /^[\w-]{8,128}$/;

/** What this middleware puts on the request: a logger whose every line carries the request id. */
export type RequestVariables = { logger?: Logger };

/**
 * Gives each request an id (Nginx's X-Request-Id, or a new one), returns it in the response,
 * hands routes a logger that adds it (and the trace id) to every line, and writes one access-log
 * line with them,
 * so the logs and traces of a request can be joined.
 */
export const requestContext =
  (logger: Logger): MiddlewareHandler<{ Variables: RequestVariables }> =>
  async (c, next) => {
    const incoming = c.req.header('X-Request-Id');
    const requestId = incoming && VALID_ID.test(incoming) ? incoming : crypto.randomUUID();
    const started = performance.now();
    c.header('X-Request-Id', requestId);
    // The request's trace (traceRequests runs first): in every log line, so Grafana can jump from a
    // log line to its trace. No trace id when tracing is off.
    const span = trace.getActiveSpan();
    span?.setAttribute('designroom.request_id', requestId);
    const traced = span && isSpanContextValid(span.spanContext());
    const ids = traced ? { requestId, traceId: span.spanContext().traceId } : { requestId };
    c.set('logger', logger.child(ids));
    await next();
    // For a stream (the chat), this is when the headers went out, not when the stream ended.
    logger.info('request', {
      ...ids,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
    });
  };
