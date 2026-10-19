import { metrics } from '@opentelemetry/api';
import * as Sentry from '@sentry/node';

// Error tracking (architecture §9: Sentry = "something broke, here's why"). Unexpected errors —
// bugs — go to Sentry with their stack trace; expected ones (a 400, a 413) don't. Without a DSN
// the reporter does nothing, so tests and offline work need no Sentry at all.

export type ErrorReporter = {
  report: (error: unknown, context?: Record<string, unknown>) => void;
};

/** Reports nothing: no DSN configured, and in tests. */
export const noErrorReporter: ErrorReporter = { report: () => {} };

export type ErrorTrackingConfig = { dsn: string; environment: string } | null;

/**
 * Starts Sentry once, at startup (index.ts), and returns the reporter the app is given.
 * `init` is injected so a test can check the wiring without a network.
 */
export const createErrorReporter = (
  config: ErrorTrackingConfig,
  sentry: Pick<typeof Sentry, 'init' | 'captureException'> = Sentry,
): ErrorReporter => {
  if (!config) return noErrorReporter;
  sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    // Errors only: traces go to OpenTelemetry → Grafana and Phoenix (M1-26).
    tracesSampleRate: 0,
    // Our own OpenTelemetry SDK owns tracing (telemetry.ts): Sentry must not register a competing
    // provider. Already v11's default; explicit so an upgrade can't change it silently.
    enableOpenTelemetrySetup: false,
    // Only the error and its stack. Sentry v11 collects request bodies, gen-AI inputs/outputs and
    // stack variables by default — here they would carry the board, the chat and the prompt,
    // which stay on this machine (architecture §9).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      stackFrameVariables: false,
    },
  });
  return {
    report: (error, context) => {
      sentry.captureException(error, context ? { extra: context } : undefined);
    },
  };
};

/**
 * Counts every reported bug in `server_errors_reported_total`, by where it happened (`http` for
 * the error handler, `chat_stream` for bugs inside the stream), then passes it on. Counted with or
 * without a DSN: the overview dashboard and its alert see bugs even when GlitchTip is off; GlitchTip
 * has the stack trace. Made when the app is built, after the metrics SDK is registered.
 */
export const countErrors = (reporter: ErrorReporter): ErrorReporter => {
  const counter = metrics
    .getMeter('@designroom/server')
    .createCounter('server_errors_reported_total', {
      description: 'Unexpected errors (bugs) reported to error tracking.',
      unit: '{error}',
    });
  return {
    report: (error, context) => {
      const where =
        typeof context?.where === 'string' ? context.where.replaceAll(' ', '_') : 'http';
      counter.add(1, { where });
      reporter.report(error, context);
    },
  };
};
