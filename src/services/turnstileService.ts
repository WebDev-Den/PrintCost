import { canBypassTurnstileLocally, TURNSTILE_ACTIONS, type TurnstileAction } from '../domain/turnstile.ts';

export function isLocalCaptchaBypass(): boolean {
  return typeof window !== 'undefined' && canBypassTurnstileLocally(import.meta.env || {}, window.location.hostname);
}

export async function verifyTurnstile(action: TurnstileAction, token: string): Promise<void> {
  // shortcut: protects this site's forms; enable Firebase App Check when direct Auth API protection is needed.
  if (!TURNSTILE_ACTIONS.includes(action)) throw new Error('Некоректна дія перевірки безпеки.');
  if (isLocalCaptchaBypass()) return;
  if (typeof token !== 'string' || !token.trim() || token.trim() !== token || token.length > 2048) throw new Error('Пройдіть перевірку безпеки перед надсиланням форми.');
  let response: Response;
  try {
    response = await fetch('/api/turnstile/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token }), credentials: 'same-origin', cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
  } catch { throw new Error('Не вдалося перевірити капчу. Перевірте з’єднання та повторіть спробу.'); }
  if (!response.ok) throw new Error(response.status === 429
    ? 'Забагато спроб. Зачекайте хвилину та повторіть перевірку безпеки.'
    : response.status === 400 || response.status === 403
      ? 'Перевірка безпеки недійсна або застаріла. Пройдіть капчу повторно.'
      : 'Перевірка безпеки тимчасово недоступна. Повторіть спробу пізніше.');
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error('Не вдалося прочитати результат перевірки безпеки. Повторіть спробу.'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).length !== 1 || !('success' in payload) || payload.success !== true) {
    throw new Error('Перевірка безпеки не підтверджена. Пройдіть капчу повторно.');
  }
}
