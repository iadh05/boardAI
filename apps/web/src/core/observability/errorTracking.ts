import { init } from '@sentry/react';

// Error tracking for the browser (architecture §9: Sentry = "something broke, here's why").
// The only place Sentry is started (frontend.md). Without a DSN it stays off, so tests, the e2e
// runs and offline work need no Sentry; the error boundaries then just show their fallback.

/** Starts Sentry when a DSN is set (VITE_SENTRY_DSN at build time). Returns whether it did. */
export const startErrorTracking = (
  dsn: string | undefined,
  sentry: { init: typeof init } = { init },
): boolean => {
  if (!dsn) return false;
  sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Errors only: no performance tracing, no session replay.
    tracesSampleRate: 0,
    // The error and its stack — never the board or the chat, which the requests carry.
    dataCollection: { userInfo: false, httpBodies: [], urlQueryParams: false },
  });
  return true;
};
