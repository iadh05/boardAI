import { Hono } from 'hono';
import type { Config } from './core/config.ts';
import { notFound, onError } from './core/errors.ts';
import type { Logger } from './core/logger.ts';
import { requestContext } from './core/requestContext.ts';
import { createHealthModule } from './modules/health/index.ts';

// The composition root (architecture §6): builds every dependency and hands it to the modules.
// Nothing else creates dependencies, so tests build this same app with fakes.

export type AppDeps = { config: Config; logger: Logger };

export const createApp = (deps: AppDeps) => {
  const app = new Hono();
  app.use(requestContext(deps.logger));

  app.route('/api/health', createHealthModule().routes);

  app.notFound(notFound);
  app.onError(onError(deps.logger));
  return app;
};
