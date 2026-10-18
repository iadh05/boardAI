import { Hono } from 'hono';

/** Health check — a flat module (no logic worth layers). Mounted at /api/health. */
export const createHealthModule = () => {
  const routes = new Hono();
  routes.get('/', (c) => c.json({ ok: true }));
  return { routes };
};
