import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { AppError, onError } from './errors.ts';
import { createLogger } from './logger.ts';

const silent = createLogger({ level: 'info', write: () => {} });

const appThrowing = (error: unknown) => {
  const app = new Hono();
  app.get('/boom', () => {
    throw error;
  });
  app.onError(onError(silent));
  return app;
};

describe('onError', () => {
  it.each([
    ['VALIDATION_FAILED', 400],
    ['NOT_FOUND', 404],
    ['BOARD_TOO_LARGE', 413],
    ['RATE_LIMITED', 429],
    ['LLM_UNAVAILABLE', 503],
  ] as const)('maps %s to %i with the shared error shape', async (code, status) => {
    const res = await appThrowing(new AppError(code, 'What happened', { field: 'x' })).request(
      '/boom',
    );

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({
      error: { code, message: 'What happened', details: { field: 'x' } },
    });
  });

  it('turns an unexpected error into a 500 that leaks nothing', async () => {
    const res = await appThrowing(new Error('db password is hunter2')).request('/boom');

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' },
    });
  });
});
