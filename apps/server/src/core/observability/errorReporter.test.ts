import { describe, expect, it, vi } from 'vitest';
import { createErrorReporter, noErrorReporter } from './errorReporter.ts';

const fakeSentry = () => ({ init: vi.fn(), captureException: vi.fn() });

describe('createErrorReporter', () => {
  it('does nothing without a DSN: tests and offline work need no Sentry', () => {
    const sentry = fakeSentry();

    const reporter = createErrorReporter(null, sentry);
    reporter.report(new Error('x'));

    expect(reporter).toBe(noErrorReporter);
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('starts Sentry for errors only, sending no board, chat or prompt, and reports with context', () => {
    const sentry = fakeSentry();
    const bug = new Error('boom');

    createErrorReporter(
      { dsn: 'https://key@o1.ingest.sentry.io/1', environment: 'development' },
      sentry,
    ).report(bug, { requestId: 'abc' });

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@o1.ingest.sentry.io/1',
        environment: 'development',
        tracesSampleRate: 0,
        enableOpenTelemetrySetup: false, // telemetry.ts registers the one OpenTelemetry provider
        dataCollection: expect.objectContaining({
          httpBodies: [], // the chat request carries the whole board and conversation
          genAI: { inputs: false, outputs: false },
          stackFrameVariables: false, // local variables can hold the prompt
          userInfo: false,
        }) as unknown,
      }),
    );
    expect(sentry.captureException).toHaveBeenCalledWith(bug, { extra: { requestId: 'abc' } });
  });
});
