import { TURNSTILE_ACTIONS, type TurnstileAction } from '../src/domain/turnstile.ts';
import type { AnalyticsEnv } from './analytics.ts';
import { ApiError, boundedText } from './firebase.ts';

export interface TurnstileEnv extends Partial<Pick<WorkerBindings, 'TURNSTILE_SECRET_KEY'>> {
  TURNSTILE_HOSTNAMES?: string;
  ANALYTICS_RATE_LIMIT?: AnalyticsEnv['ANALYTICS_RATE_LIMIT'];
}

function json(value: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return Response.json(value, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin', ...extraHeaders,
  } });
}

function configuredHostnames(value: string | undefined): string[] {
  if (!value || value.length > 4096) throw new ApiError(503, 'Перевірка Cloudflare ще не налаштована.');
  const hostnames = value.split(',').map(hostname => hostname.trim());
  if (hostnames.length > 20 || hostnames.some(hostname => hostname.length > 253 ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(hostname) ||
      hostname.endsWith('.localhost') || !/[a-z]/.test(hostname.split('.').at(-1)!))) {
    throw new ApiError(503, 'Перевірка Cloudflare ще не налаштована.');
  }
  return hostnames;
}

async function readInput(request: Request): Promise<{ token: string; action: TurnstileAction }> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ApiError(400, 'Потрібен JSON.');
  }
  let value: unknown;
  try { value = JSON.parse(await boundedText(new Response(request.body, { headers: request.headers }), 4096)); }
  catch { throw new ApiError(400, 'Некоректний або завеликий запит перевірки.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Некоректний запит перевірки.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || typeof input.token !== 'string' || input.token.length < 1 || input.token.length > 2048 || input.token.trim() !== input.token || input.token.includes('.DUMMY.TOKEN.') ||
      typeof input.action !== 'string' || !TURNSTILE_ACTIONS.includes(input.action as TurnstileAction)) {
    throw new ApiError(400, 'Некоректний запит перевірки.');
  }
  return { token: input.token, action: input.action as TurnstileAction };
}

export function createTurnstileWorker(dependencies: { fetcher?: typeof fetch; now?: () => Date } = {}) {
  const fetcher = dependencies.fetcher || fetch;
  const now = dependencies.now || (() => new Date());
  return {
    async fetch(request: Request, env: TurnstileEnv): Promise<Response> {
      if (request.method !== 'POST') return json({ error: 'Метод не підтримується.' }, 405, { Allow: 'POST' });
      try {
        if (!env.TURNSTILE_SECRET_KEY?.trim() || /^[123]x/.test(env.TURNSTILE_SECRET_KEY.trim()) || !env.ANALYTICS_RATE_LIMIT) {
          throw new ApiError(503, 'Перевірка Cloudflare ще не налаштована.');
        }
        const hostnames = configuredHostnames(env.TURNSTILE_HOSTNAMES), url = new URL(request.url);
        if (url.protocol !== 'https:' || url.port || !hostnames.includes(url.hostname) || request.headers.get('Origin') !== url.origin) {
          throw new ApiError(403, 'Дозволено лише запити з цього сайту.');
        }
        const ip = request.headers.get('CF-Connecting-IP');
        // One bucket across all actions prevents bypassing the limit by switching forms.
        if (!(await env.ANALYTICS_RATE_LIMIT.limit({ key: `turnstile:${ip || 'unknown'}` })).success) {
          throw new ApiError(429, 'Забагато запитів. Спробуйте пізніше.');
        }
        const { token, action } = await readInput(request);
        const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
        if (ip) body.set('remoteip', ip);
        let value: unknown;
        try {
          const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) throw new Error('Siteverify unavailable');
          value = JSON.parse(await boundedText(response, 8192));
        } catch { throw new ApiError(503, 'Перевірка Cloudflare тимчасово недоступна. Спробуйте знову.'); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new ApiError(503, 'Перевірка Cloudflare тимчасово недоступна. Спробуйте знову.');
        }
        const verification = value as Record<string, unknown>;
        if (verification.success !== true) {
          const errors = verification['error-codes'];
          if (Array.isArray(errors) && errors.some(error => ['missing-input-secret', 'invalid-input-secret', 'internal-error', 'bad-request'].includes(error))) {
            throw new ApiError(503, 'Перевірка Cloudflare тимчасово недоступна. Спробуйте знову.');
          }
          throw new ApiError(403, 'Перевірку Cloudflare не пройдено. Повторіть її.');
        }
        const age = typeof verification.challenge_ts === 'string' ? now().getTime() - Date.parse(verification.challenge_ts) : NaN;
        if (verification.hostname !== url.hostname || verification.action !== action || !Number.isFinite(age) || age > 300000 || age < -30000) {
          throw new ApiError(403, 'Перевірку Cloudflare не пройдено або вона прострочена. Повторіть її.');
        }
        return json({ success: true });
      } catch (error) {
        return json({ error: error instanceof ApiError ? error.message : 'Перевірка Cloudflare тимчасово недоступна. Спробуйте знову.' },
          error instanceof ApiError ? error.status : 503);
      }
    },
  };
}
