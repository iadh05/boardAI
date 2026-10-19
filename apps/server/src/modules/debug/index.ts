import { Hono } from 'hono';

/**
 * Breaks things on purpose, to check that the "god eye" sees them (M1-26e): error tracking
 * (GlitchTip), the overview dashboard and its alerts. A flat module, mounted at /api/debug only
 * when ENABLE_DEBUG_ROUTES=true — never in tests by default, never in production.
 */
export const createDebugModule = () => {
  const routes = new Hono();
  // A real unexpected error, like a bug would be: the normal error path turns it into a 500,
  // logs it, counts it and reports it.
  routes.get('/boom', () => {
    throw new Error('Debug: an unexpected error, thrown on purpose (GET /api/debug/boom)');
  });
  return { routes };
};
