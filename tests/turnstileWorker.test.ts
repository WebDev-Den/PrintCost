import assert from 'node:assert/strict';
import test from 'node:test';
import { TURNSTILE_ACTIONS } from '../src/domain/turnstile.ts';
import type { AnalyticsDatabase } from '../workers/analytics.ts';
import worker from '../workers/index.ts';
import { createTurnstileWorker, type TurnstileEnv } from '../workers/turnstile.ts';

const date = new Date('2026-10-09T08:00:00Z');
const origin = 'https://web-dev.pp.ua';
const endpoint = `${origin}/api/turnstile/verify`;
const input = { token: 'fixture-token', action: 'login' };
const verified = (extra = {}) => ({ success: true, hostname: 'web-dev.pp.ua', action: 'login', challenge_ts: date.toISOString(), ...extra });
function env(extra: Partial<TurnstileEnv> = {}): TurnstileEnv {
  return { TURNSTILE_SECRET_KEY: 'fixture-secret', TURNSTILE_HOSTNAMES: 'web-dev.pp.ua,kilo-g.web-developer-den.workers.dev',
    ANALYTICS_RATE_LIMIT: { limit: async () => ({ success: true }) }, ...extra };
}
function request(value: unknown = input, extraHeaders: Record<string, string | null> = {}, url = endpoint, method = 'POST') {
  const headers = new Headers({ Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.5' });
  for (const [key, value] of Object.entries(extraHeaders)) value === null ? headers.delete(key) : headers.set(key, value);
  return new Request(url, { method, headers, ...(method === 'POST' ? { body: JSON.stringify(value) } : {}) });
}
function harness(value: unknown = verified(), fetchResponse?: () => Promise<Response>) {
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  const handler = createTurnstileWorker({ now: () => date, fetcher: async (input, init) => {
    calls.push({ input, init });
    return fetchResponse ? fetchResponse() : Response.json(value);
  } });
  return { ...handler, calls };
}
async function rejected(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body), ['error']);
  assert.equal(typeof body.error, 'string');
  assert.doesNotMatch(String(body.error), /fixture-token|fixture-secret|192\.0\.2\.5/);
}

test('Siteverify verifies each allowed action once, using the fixed endpoint and trusted IP', async () => {
  const keys: string[] = [];
  for (const action of TURNSTILE_ACTIONS) {
    const handler = harness(verified({ action }));
    const response = await handler.fetch(request({ ...input, action }), env({ ANALYTICS_RATE_LIMIT: { limit: async ({ key }) => {
      keys.push(key); return { success: true };
    } } }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.deepEqual(await response.json(), { success: true });
    assert.equal(handler.calls.length, 1);
    assert.equal(handler.calls[0].input, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const init = handler.calls[0].init!;
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(String(init.body))), {
      secret: 'fixture-secret', response: 'fixture-token', remoteip: '192.0.2.5',
    });
  }
  assert.deepEqual(new Set(keys), new Set(['turnstile:192.0.2.5']));
});

test('same-origin requests require an exact allowed HTTPS host and Origin', async () => {
  const handler = harness();
  for (const args of [
    { headers: { Origin: null } }, { headers: { Origin: 'null' } }, { headers: { Origin: 'https://attacker.invalid' } },
    { headers: { Origin: 'https://kilo-g.web-developer-den.workers.dev' } },
    { headers: { Origin: 'https://sub.web-dev.pp.ua' }, url: 'https://sub.web-dev.pp.ua/api/turnstile/verify' },
    { headers: { Origin: 'http://web-dev.pp.ua' }, url: 'http://web-dev.pp.ua/api/turnstile/verify' },
    { headers: { Origin: 'https://web-dev.pp.ua:8443' }, url: 'https://web-dev.pp.ua:8443/api/turnstile/verify' },
  ]) await rejected(await handler.fetch(request(input, args.headers, args.url), env()), 403);
  assert.equal(handler.calls.length, 0);
});

test('unsafe hostname configuration fails closed without Siteverify calls', async () => {
  const handler = harness();
  for (const hostnames of ['', '*.web-dev.pp.ua', 'localhost', '127.0.0.1', 'app.localhost', 'https://web-dev.pp.ua',
    'web-dev.pp.ua,', 'web-dev.pp.ua/path', 'web-dev.pp.ua:443', 'web-dev.pp.ua,*.example.com']) {
    await rejected(await handler.fetch(request(), env({ TURNSTILE_HOSTNAMES: hostnames })), 503);
  }
  assert.equal(handler.calls.length, 0);
});

test('unsupported methods and content types never consume a token', async () => {
  const handler = harness();
  for (const method of ['GET', 'OPTIONS', 'HEAD']) {
    const response = await handler.fetch(request(input, {}, endpoint, method), env());
    assert.equal(response.headers.get('Allow'), 'POST');
    await rejected(response, 405);
  }
  for (const type of [null, 'text/plain', 'application/jsonp', 'application/x-www-form-urlencoded']) {
    await rejected(await handler.fetch(request(input, { 'Content-Type': type }), env()), 400);
  }
  assert.equal(handler.calls.length, 0);
});

test('input accepts only a bounded token and a known action with no extra fields', async () => {
  const handler = harness();
  for (const value of [null, [], true, 'value', {}, { token: 'fixture-token' }, { action: 'login' },
    { ...input, extra: true }, { ...input, action: 'delete_account' }, { ...input, action: 1 },
    { ...input, token: '' }, { ...input, token: ' ' }, { ...input, token: ' token ' }, { ...input, token: 1 }, { ...input, token: 'a'.repeat(2049) }]) {
    await rejected(await handler.fetch(request(value), env()), 400);
  }
  const response = await handler.fetch(new Request(endpoint, { method: 'POST', headers: request().headers, body: '{' }), env());
  await rejected(response, 400);
  assert.equal(handler.calls.length, 0);
});

test('declared and streamed oversized bodies fail before Siteverify', async () => {
  const handler = harness();
  await rejected(await handler.fetch(request(input, { 'Content-Length': '4097' }), env()), 400);
  await rejected(await handler.fetch(request({ ...input, token: 'я'.repeat(2048) }), env()), 400);
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode(' '.repeat(4097))); controller.close();
  } });
  const streamed = new Request(endpoint, { method: 'POST', headers: request().headers, body: stream, duplex: 'half' } as RequestInit);
  await rejected(await handler.fetch(streamed, env()), 400);
  assert.equal(handler.calls.length, 0);
});

test('invalid UTF-8 cannot reach the upstream verifier', async () => {
  const handler = harness();
  const malformed = new Request(endpoint, { method: 'POST', headers: request().headers, body: new Uint8Array([0xc3, 0x28]) });
  await rejected(await handler.fetch(malformed, env()), 400);
  assert.equal(handler.calls.length, 0);
});

test('official dummy secrets and tokens never enable a production bypass', async () => {
  const handler = harness();
  for (const secret of ['1x0000000000000000000000000000000AA', '2x0000000000000000000000000000000AA', '3x0000000000000000000000000000000AA']) {
    await rejected(await handler.fetch(request(), env({ TURNSTILE_SECRET_KEY: secret })), 503);
  }
  await rejected(await handler.fetch(request({ ...input, token: 'XXXX.DUMMY.TOKEN.XXXX' }), env()), 400);
  assert.equal(handler.calls.length, 0);
});

test('missing bindings, denied quotas and broken native rate limits fail closed', async () => {
  const handler = harness();
  for (const configuration of [env({ TURNSTILE_SECRET_KEY: undefined }), env({ TURNSTILE_SECRET_KEY: ' ' }),
    env({ TURNSTILE_HOSTNAMES: undefined }), env({ ANALYTICS_RATE_LIMIT: undefined }),
    env({ ANALYTICS_RATE_LIMIT: { limit: async () => { throw new Error('fixture-secret'); } } })]) {
    await rejected(await handler.fetch(request(), configuration), 503);
  }
  await rejected(await handler.fetch(request(), env({ ANALYTICS_RATE_LIMIT: { limit: async () => ({ success: false }) } })), 429);
  assert.equal(handler.calls.length, 0);
});

test('invalid, expired, replayed and non-boolean upstream success values are rejected', async () => {
  for (const value of [
    { success: false, 'error-codes': ['invalid-input-response'] },
    { success: false, 'error-codes': ['timeout-or-duplicate'] },
    verified({ success: 'true' }), verified({ success: 1 }), {},
  ]) {
    const handler = harness(value);
    await rejected(await handler.fetch(request(), env()), 403);
    assert.equal(handler.calls.length, 1);
  }
});

test('a successful Siteverify result must match both the requested hostname and action', async () => {
  for (const extra of [{ hostname: 'attacker.invalid' }, { hostname: 'sub.web-dev.pp.ua' },
    { hostname: 'kilo-g.web-developer-den.workers.dev' }, { hostname: undefined },
    { action: 'register' }, { action: undefined }]) {
    await rejected(await harness(verified(extra)).fetch(request(), env()), 403);
  }
  const host = 'kilo-g.web-developer-den.workers.dev';
  const response = await harness(verified({ hostname: host })).fetch(request(input, { Origin: `https://${host}` }, `https://${host}/api/turnstile/verify`), env());
  assert.equal(response.status, 200);
});

test('challenge timestamps require freshness, with only 30 seconds of future clock skew', async () => {
  for (const challenge_ts of [undefined, null, 1, 'invalid', new Date(date.getTime() - 300001).toISOString(), new Date(date.getTime() + 30001).toISOString()]) {
    await rejected(await harness(verified({ challenge_ts })).fetch(request(), env()), 403);
  }
  for (const offset of [-300000, 30000]) {
    const response = await harness(verified({ challenge_ts: new Date(date.getTime() + offset).toISOString() })).fetch(request(), env());
    assert.equal(response.status, 200);
  }
});

test('network, timeout, secret and malformed upstream failures are safe and never retried', async () => {
  for (const respond of [
    async () => { throw new Error('fixture-secret'); },
    async () => { throw new DOMException('fixture-token', 'TimeoutError'); },
    async () => Response.json(verified(), { status: 503 }),
    async () => new Response('invalid-json'),
    async () => Response.json(null), async () => Response.json([]),
    async () => new Response(' '.repeat(8193)),
    async () => Response.json(verified(), { headers: { 'Content-Length': '8193' } }),
    async () => Response.json({ success: false, 'error-codes': ['invalid-input-secret'] }),
    async () => Response.json({ success: false, 'error-codes': ['internal-error'] }),
  ]) {
    const handler = harness(undefined, respond);
    await rejected(await handler.fetch(request(), env()), 503);
    assert.equal(handler.calls.length, 1);
  }
});

test('untrusted forwarded IP headers are never sent to Siteverify', async () => {
  const handler = harness(), keys: string[] = [];
  const response = await handler.fetch(request(input, { 'CF-Connecting-IP': null, 'X-Forwarded-For': '192.0.2.99', 'X-Real-IP': '192.0.2.100' }),
    env({ ANALYTICS_RATE_LIMIT: { limit: async ({ key }) => { keys.push(key); return { success: true }; } } }));
  assert.equal(response.status, 200);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(handler.calls[0].init!.body))), {
    secret: 'fixture-secret', response: 'fixture-token',
  });
  assert.deepEqual(keys, ['turnstile:unknown']);
});

test('entrypoint composes Turnstile without changing assets, analytics authorization or scheduled cleanup', async () => {
  const requests: Request[] = [], pending: Promise<unknown>[] = [];
  const context = { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } };
  const configuration = { FIREBASE_PROJECT_ID: 'kilo-g', ASSETS: { fetch: async (request: Request) => {
    requests.push(request); return new Response('asset fixture');
  } } };
  const asset = new Request(`${origin}/app/calculator`);
  assert.equal(await (await worker.fetch(asset, configuration, context)).text(), 'asset fixture');
  assert.deepEqual(requests, [asset]);
  await rejected(await worker.fetch(request(), configuration, context), 503);
  const notFound = await worker.fetch(new Request(`${origin}/api/turnstile/unknown`), configuration, context);
  assert.equal(notFound.status, 404);
  assert.equal(pending.length, 0);
  const cleanupQueries: string[] = [];
  const cleanupDatabase: AnalyticsDatabase = { prepare: sql => {
    cleanupQueries.push(sql);
    return { bind() { return this; }, all: async () => ({ results: [], meta: {}, success: true }), first: async () => null };
  }, batch: async statements => statements.map(() => ({ results: [], meta: { changes: 0 }, success: true })) };
  const queueEnv = { ...configuration, ANALYTICS_DB: cleanupDatabase, IMPORT_QUEUE: { async send() {} } };
  await worker.scheduled({ cron: '*/5 * * * *' }, queueEnv, context);
  await Promise.all(pending.splice(0));
  assert.ok(cleanupQueries.every(sql => sql.includes('maintenance_dispatches')), 'import cron only reserves producer work');
  await worker.scheduled({ cron: '0 2 * * *' }, queueEnv, context);
  await Promise.all(pending.splice(0));
  assert.ok(cleanupQueries.every(sql => sql.includes('maintenance_dispatches')), 'analytics cleanup also runs outside the Cron CPU limit');
  const database: AnalyticsDatabase = { prepare: sql => {
    assert.ok(sql.startsWith('INSERT INTO analytics_report_budget'), 'Only the preliminary report quota may precede authentication.');
    return { bind() { return this; }, async all<T>() { return { results: [{ day: 'fixture' }] as T[], meta: {}, success: true }; },
      async first<T>() { assert.fail('Unauthenticated reports must not read data.'); return null as T | null; } };
  }, batch: async () => { throw new Error('Unexpected database access'); } };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const report = await worker.fetch(new Request(`${origin}/api/analytics/report?companyId=all&from=${today}&to=${today}`),
    { ...configuration, ...env(), ANALYTICS_DB: database }, context);
  assert.equal(report.status, 401);
  assert.equal(pending.length, 0);
});
