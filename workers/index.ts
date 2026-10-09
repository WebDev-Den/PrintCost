import analytics, { type AnalyticsEnv } from './analytics.ts';
import { createTurnstileWorker, type TurnstileEnv } from './turnstile.ts';
import { createImportApi, type ImportEnv, type ImportMessage } from './importApi.ts';

const turnstile = createTurnstileWorker();
const imports = createImportApi();

export default {
  ...analytics,
  fetch(request: Request, env: AnalyticsEnv & TurnstileEnv & ImportEnv, context: Parameters<typeof analytics.fetch>[2]): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/v1/')) return imports.fetch(request, env);
    return path === '/api/turnstile/verify'
      ? turnstile.fetch(request, env)
      : analytics.fetch(request, env, context);
  },
  queue(batch: { messages: ImportMessage[] }, env: ImportEnv) { return imports.queue(batch, env); },
  async scheduled(controller: { cron: string }, env: AnalyticsEnv & ImportEnv, context: Parameters<typeof analytics.fetch>[2]) {
    if (controller.cron === '0 2 * * *') await analytics.scheduled(controller, env, context);
    context.waitUntil(imports.scheduled(env).catch(() => console.error('import_outbox_unavailable')));
  },
};
