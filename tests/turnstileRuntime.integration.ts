import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare';
import { TURNSTILE_ACTIONS, type TurnstileAction } from '../src/domain/turnstile.ts';

// Bundle the unchanged production entrypoint. Only Siteverify transport is local;
// real workerd routing and the native rate limiter remain enabled, with no Firebase.
const HOSTNAME = 'turnstile-runtime.invalid';
const ORIGIN = `https://${HOSTNAME}`;
const SECRET = `0x${randomBytes(24).toString('base64url')}_`;

test('production Turnstile Worker with isolated Siteverify and native rate limiter', { timeout: 120_000 }, async t => {
  const bundle = await build({ entryPoints: ['workers/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const tokens = new Map<string, { action: TurnstileAction; hostname: string }>();
  const redeemed = new Set<string>();
  const assets: string[] = [];
  let siteverifyCalls = 0;
  const token = (action: TurnstileAction, hostname = HOSTNAME) => {
    const value = `runtime-${randomUUID()}`;
    tokens.set(value, { action, hostname });
    return value;
  };
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'turnstile-runtime', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-08',
    bindings: { FIREBASE_PROJECT_ID: 'demo-kilog-turnstile-runtime', TURNSTILE_SECRET_KEY: SECRET, TURNSTILE_HOSTNAMES: HOSTNAME },
    serviceBindings: { ASSETS: request => {
      assets.push(new URL(request.url).pathname);
      return new RuntimeResponse('fixture SPA');
    } },
    ratelimits: { ANALYTICS_RATE_LIMIT: { namespace_id: `turnstile-runtime-${randomUUID()}`, simple: { limit: 60, period: 60 } } },
    outboundService: async request => {
      assert.equal(request.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify', 'The fixture cannot make external Firebase or other requests.');
      assert.equal(request.method, 'POST');
      const body = new URLSearchParams(await request.text());
      assert.equal(body.get('secret'), SECRET);
      assert.ok([...body.keys()].every(key => ['secret', 'response', 'remoteip'].includes(key)), 'No credentials or personal form fields reach Siteverify.');
      const response = body.get('response');
      assert.ok(response);
      siteverifyCalls += 1;
      const fixture = tokens.get(response);
      if (!fixture || redeemed.has(response)) return new RuntimeResponse(JSON.stringify({ success: false, 'error-codes': [fixture ? 'timeout-or-duplicate' : 'invalid-input-response'] }), { headers: { 'Content-Type': 'application/json' } });
      assert.ok(TURNSTILE_ACTIONS.includes(fixture.action));
      redeemed.add(response);
      return new RuntimeResponse(JSON.stringify({ success: true, ...fixture, challenge_ts: new Date().toISOString() }), { headers: { 'Content-Type': 'application/json' } });
    },
  }));
  t.after(() => mf.dispose());
  const post = (action: TurnstileAction, value = token(action), ip = '192.0.2.5', origin = ORIGIN, url = `${ORIGIN}/api/turnstile/verify`) => mf.dispatchFetch(url, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ action, token: value }),
  });
  const reject = async (response: RuntimeResponse, status: number) => {
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), ['error']);
    assert.equal(typeof body.error, 'string');
    assert.ok(!String(body.error).includes(SECRET));
  };

  await t.test('all five public form actions pass real Worker dispatch', async () => {
    for (const action of TURNSTILE_ACTIONS) {
      const response = await post(action);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
      assert.deepEqual(await response.json(), { success: true });
    }
    assert.equal(siteverifyCalls, TURNSTILE_ACTIONS.length);
  });

  await t.test('invalid and replayed tokens and mismatched Siteverify metadata fail closed', async () => {
    const once = token('login');
    assert.equal((await post('login', once)).status, 200);
    await reject(await post('login', once), 403);
    await reject(await post('login', 'invalid-runtime-token'), 403);
    await reject(await post('login', token('login', 'other-runtime.invalid')), 403);
    await reject(await post('login', token('register')), 403);
  });

  await t.test('unconfigured hostname and cross-origin submissions never reach Siteverify', async () => {
    const before = siteverifyCalls;
    await reject(await post('login', token('login'), '192.0.2.5', 'https://other-runtime.invalid'), 403);
    await reject(await post('login', token('login'), '192.0.2.5', 'https://other-runtime.invalid', 'https://other-runtime.invalid/api/turnstile/verify'), 403);
    assert.equal(siteverifyCalls, before);
  });

  await t.test('native 60-per-minute quota is shared across actions and blocks before Siteverify', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = siteverifyCalls;
      const epoch = Math.floor(Date.now() / 60_000);
      const ip = `192.0.2.${20 + attempt}`;
      const allowed = await Promise.all(Array.from({ length: 60 }, (_, index) => post(TURNSTILE_ACTIONS[index % TURNSTILE_ACTIONS.length], undefined, ip)));
      const denied = await Promise.all(TURNSTILE_ACTIONS.map(action => post(action, undefined, ip)));
      // Native windows align to wall-clock minutes; a rollover gets one fresh IP.
      if (epoch !== Math.floor(Date.now() / 60_000)) continue;
      for (const response of allowed) assert.equal(response.status, 200);
      for (const response of denied) await reject(response, 429);
      assert.equal(siteverifyCalls - before, 60, 'Switching forms cannot create additional buckets or consume denied tokens.');
      return;
    }
    assert.fail('Could not observe the quota within one native minute window.');
  });

  await t.test('unrelated assets remain delegated and API routes are not SPA fallbacks', async () => {
    const before = siteverifyCalls;
    for (const path of ['/', '/auth/login', '/auth/register', '/app/calculator']) {
      const response = await mf.dispatchFetch(`${ORIGIN}${path}`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'fixture SPA');
    }
    assert.deepEqual(assets, ['/', '/auth/login', '/auth/register', '/app/calculator']);
    await reject(await mf.dispatchFetch(`${ORIGIN}/api/turnstile/verify`), 405);
    await reject(await mf.dispatchFetch(`${ORIGIN}/api/turnstile/unknown`), 404);
    assert.equal(siteverifyCalls, before);
  });
});
