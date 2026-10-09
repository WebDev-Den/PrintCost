import analytics, { type AnalyticsEnv } from './analytics.ts';
import { createTurnstileWorker, type TurnstileEnv } from './turnstile.ts';

const turnstile = createTurnstileWorker();

export default {
  ...analytics,
  fetch(request: Request, env: AnalyticsEnv & TurnstileEnv, context: Parameters<typeof analytics.fetch>[2]): Promise<Response> {
    return new URL(request.url).pathname === '/api/turnstile/verify'
      ? turnstile.fetch(request, env)
      : analytics.fetch(request, env, context);
  },
};
