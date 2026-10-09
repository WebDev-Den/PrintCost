import assert from 'node:assert/strict';
import test from 'node:test';
import { canBypassTurnstileLocally, TURNSTILE_ACTIONS } from '../src/domain/turnstile.ts';
import { verifyTurnstile } from '../src/services/turnstileService.ts';

test('captcha bypass is limited to development, explicit demo emulators and loopback hosts', () => {
  const env = { DEV: true, VITE_USE_FIREBASE_EMULATORS: 'true', VITE_FIREBASE_PROJECT_ID: 'demo-kilog' };
  for (const hostname of ['localhost', '127.0.0.1', '[::1]', '::1']) assert.equal(canBypassTurnstileLocally(env, hostname), true);
  for (const hostname of ['web-dev.pp.ua', 'localhost.evil.test', '127.0.0.1.evil.test', '']) assert.equal(canBypassTurnstileLocally(env, hostname), false);
  for (const changes of [{ DEV: false }, { DEV: 'true' }, { VITE_USE_FIREBASE_EMULATORS: 'false' }, { VITE_FIREBASE_PROJECT_ID: 'kilo-g' }]) {
    assert.equal(canBypassTurnstileLocally({ ...env, ...changes }, 'localhost'), false);
  }
});

test('missing, oversized and unknown-action captcha never calls the server', async () => {
  let requests = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { ++requests; return Response.json({ success: true }); };
  try {
    for (const token of ['', ' ', ' token ', 'a'.repeat(2049)]) await assert.rejects(verifyTurnstile('login', token), /перевірку безпеки/);
    // @ts-expect-error Exercise the untrusted runtime boundary.
    await assert.rejects(verifyTurnstile('admin', 'token'), /Некоректна дія/);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});

test('all public actions send only token/action and require explicit success', async () => {
  const original = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/turnstile/verify');
    assert.equal(options?.method, 'POST');
    assert.equal(options?.credentials, 'same-origin');
    assert.equal(options?.cache, 'no-store');
    assert.ok(options?.signal instanceof AbortSignal);
    requests.push(JSON.parse(String(options?.body)));
    return Response.json({ success: true });
  };
  try {
    for (const action of TURNSTILE_ACTIONS) await verifyTurnstile(action, 'opaque-token');
    assert.deepEqual(requests, TURNSTILE_ACTIONS.map(action => ({ action, token: 'opaque-token' })));
    for (const payload of [{ success: false }, { success: 'true' }, { success: true, token: 'unexpected' }, [], null]) {
      globalThis.fetch = async () => Response.json(payload);
      await assert.rejects(verifyTurnstile('login', 'opaque-token'), /не підтверджена/);
    }
    globalThis.fetch = async () => new Response('<html>proxy error</html>');
    await assert.rejects(verifyTurnstile('login', 'opaque-token'), /прочитати результат/);
  } finally { globalThis.fetch = original; }
});

test('captcha failures, rate limiting and network errors stay fail-closed without exposing server details', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [400, 403, 429, 500, 503]) {
      globalThis.fetch = async () => Response.json({ error: 'secret-token-and-server-details' }, { status });
      await assert.rejects(verifyTurnstile('register', 'opaque-token'), error => {
        assert.ok(error instanceof Error && !error.message.includes('secret-token'));
        return true;
      });
    }
    globalThis.fetch = async () => { throw new Error('secret-token-in-upstream-error'); };
    await assert.rejects(verifyTurnstile('login', 'opaque-token'), /Перевірте з’єднання/);
  } finally { globalThis.fetch = original; }
});
