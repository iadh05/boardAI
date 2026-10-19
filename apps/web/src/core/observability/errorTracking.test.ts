import { describe, expect, it, vi } from 'vitest';
import { startErrorTracking } from './errorTracking.ts';

const fakeSentry = () => ({ init: vi.fn() });

describe('startErrorTracking', () => {
  it('stays off without a DSN: tests, previews and offline work need no Sentry', () => {
    const sentry = fakeSentry();
    expect(startErrorTracking(undefined, sentry)).toBe(false);
    expect(startErrorTracking('', sentry)).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('starts Sentry for errors only, sending no user data or request bodies', () => {
    const sentry = fakeSentry();

    expect(startErrorTracking('https://key@o1.ingest.sentry.io/2', sentry)).toBe(true);

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@o1.ingest.sentry.io/2',
        tracesSampleRate: 0,
        dataCollection: expect.objectContaining({ httpBodies: [], userInfo: false }) as unknown,
      }),
    );
  });
});
