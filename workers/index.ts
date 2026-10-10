import analytics, { type AnalyticsEnv } from './analytics.ts';
import { createTurnstileWorker, type TurnstileEnv } from './turnstile.ts';
import { createImportApi, type ImportEnv, type ImportMessage } from './importApi.ts';
import { IMPORT_LIMITS } from '../src/domain/apiImports.ts';

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
  async queue(batch: { messages: ImportMessage[] }, env: AnalyticsEnv & ImportEnv) {
    for (const message of batch.messages) {
      const body = message.body;
      if (body && typeof body === 'object' && 'maintenance' in body) {
        if (Array.isArray(body) || Object.keys(body).length !== 1 || body.maintenance !== 'imports' && body.maintenance !== 'analytics') { message.ack(); continue; }
        try {
          if (body.maintenance === 'imports') {
            await imports.refreshCredentials(env);
            await imports.scheduled(env);
          } else {
            const tasks: Promise<unknown>[] = [];
            await analytics.scheduled({ cron: '0 2 * * *' }, env, { waitUntil(promise) { tasks.push(promise); } });
            await Promise.all(tasks);
          }
          message.ack();
        } catch { message.retry({ delaySeconds: 60 }); }
      } else await imports.queue({ messages: [message] }, env);
    }
  },
  async scheduled(controller: { cron: string }, env: AnalyticsEnv & ImportEnv, context: Parameters<typeof analytics.fetch>[2]) {
    const maintenance = controller.cron === '0 2 * * *' ? 'analytics' : controller.cron === '*/5 * * * *' ? 'imports' : null;
    if (!maintenance) return;
    if (!env.ANALYTICS_DB || !env.IMPORT_QUEUE) throw new Error('Maintenance queue is unavailable.');
    const reserved = await env.ANALYTICS_DB.prepare('INSERT INTO import_daily(day,maintenance_dispatches) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET maintenance_dispatches=maintenance_dispatches+1 WHERE maintenance_dispatches<? RETURNING day')
      .bind(new Date().toISOString().slice(0, 10), IMPORT_LIMITS.dailyMaintenanceMessages).all();
    if (reserved.results.length) await env.IMPORT_QUEUE.send({ maintenance });
  },
};
