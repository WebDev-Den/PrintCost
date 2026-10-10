import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createAnalyticsWorker, validateEvents, validateReport, type AnalyticsDatabase, type AnalyticsEnv } from '../workers/analytics.ts';
import { createFirebaseReader, createTokenVerifier, FIREBASE_JWKS_URL } from '../workers/firebase.ts';
import { PUBLIC_FILAMENTS_CATALOG, buildConcreteFilamentSkus } from '../src/domain/filamentsDirectory.ts';
import { LEGACY_CATALOG_SKUS } from '../workers/legacyCatalog.ts';

const date = new Date('2026-10-08T22:15:00Z');
const event = (extra = {}) => ({ id: crypto.randomUUID(), type: 'search', ...extra });
test('Worker built-in SKU identities and seller URLs match the canonical frontend catalogue', () => {
  assert.deepEqual(LEGACY_CATALOG_SKUS, Object.fromEntries(buildConcreteFilamentSkus(PUBLIC_FILAMENTS_CATALOG)
    .map(({ id, name, storeUrl }) => [id, { name, storeUrl }])));
});
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_analytics.sql', import.meta.url), 'utf8'));
  const executions: string[] = [];
  const prepare = (sql: string, values: (string | number | null)[] = []) => ({
    sql, values,
    bind: (...bound: (string | number | null)[]) => prepare(sql, bound),
    all: async <T>() => { executions.push(sql); return { results: sqlite.prepare(sql).all(...values) as T[], meta: {}, success: true }; },
    first: async <T>() => { executions.push(sql); return sqlite.prepare(sql).get(...values) as T | null; },
  });
  const binding: AnalyticsDatabase = {
    prepare,
    async batch<T>(statements: ReturnType<AnalyticsDatabase['prepare']>[]) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => {
          const { sql, values } = statement as ReturnType<typeof prepare>;
          executions.push(sql);
          const results = sqlite.prepare(sql).all(...values) as T[];
          return { results, meta: { changes: Number(sqlite.prepare('SELECT changes() AS changes').get()!.changes) }, success: true };
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, binding, executions };
}
function firestoreValue(value: unknown): unknown {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value as object).map(([key, item]) => [key, firestoreValue(item)])) } };
}
const keyPair = crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
async function token(uid = 'manager', extra: Record<string, unknown> = {}, kid = 'fixture-key') {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const seconds = Math.floor(date.getTime() / 1000);
  const head = encode({ alg: 'RS256', kid });
  const body = encode({ aud: 'kilo-g', iss: 'https://securetoken.google.com/kilo-g', sub: uid, exp: seconds + 3600, iat: seconds - 1, auth_time: seconds - 20, email_verified: true, ...extra });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', (await keyPair).privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${Buffer.from(signature).toString('base64url')}`;
}
async function fixture() {
  const db = database();
  const documents = new Map<string, Record<string, unknown>>([
    ['companyOffers/offer-a', { id: 'offer-a', companyId: 'company-a', name: 'PLA', colorName: 'Red', spoolWeightGrams: 1000, status: 'published', productUrl: 'https://a.example/item' }],
    ['companyOffers/offer-b', { id: 'offer-b', companyId: 'company-b', name: 'PETG', colorName: 'Blue', spoolWeightGrams: 500, status: 'published', productUrl: 'https://b.example/item' }],
    ['companies/company-a', { id: 'company-a', status: 'active', allowedDomains: ['a.example'] }],
    ['companies/company-b', { id: 'company-b', status: 'active', allowedDomains: ['b.example'] }],
    ['accountAccess/manager', { blocked: false }], ['accountAccess/admin', { blocked: false }],
    ['system/authorization', { adminUids: ['admin'] }], ['memberships/manager', { active: true, companyId: 'company-a' }],
  ]);
  const calls: { path: string; authorization: string | null; appCheck: string | null }[] = [];
  const publicKey = await crypto.subtle.exportKey('jwk', (await keyPair).publicKey);
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === FIREBASE_JWKS_URL) return Response.json({ keys: [{ ...publicKey, kid: 'fixture-key' }] }, { headers: { 'Cache-Control': 'max-age=3600' } });
    const path = decodeURIComponent(url.split('/documents/')[1] || '');
    const headers = new Headers(init?.headers);
    calls.push({ path, authorization: headers.get('Authorization'), appCheck: headers.get('X-Firebase-AppCheck') });
    if (headers.get('X-Firebase-AppCheck') === 'denied.token.signature') return new Response('', { status: 403 });
    const value = documents.get(path);
    return value ? Response.json({ fields: (firestoreValue(value) as { mapValue: { fields: object } }).mapValue.fields }) : new Response('', { status: 404 });
  };
  const worker = createAnalyticsWorker({ fetcher, now: () => date });
  const env: AnalyticsEnv = { FIREBASE_PROJECT_ID: 'kilo-g', ANALYTICS_DB: db.binding, ANALYTICS_RATE_LIMIT: { limit: async () => ({ success: true }) } };
  const pending: Promise<unknown>[] = [];
  const context = { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } };
  async function post(events: unknown[], headers: Record<string, string> = {}) {
    return worker.fetch(new Request('https://web-dev.pp.ua/api/analytics/events', { method: 'POST', headers: { Origin: 'https://web-dev.pp.ua', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ events }) }), env, context);
  }
  async function report(companyId = 'company-a', uid = 'manager', range = 'from=2026-10-08&to=2026-10-09', headers: Record<string, string> = {}) {
    return worker.fetch(new Request(`https://web-dev.pp.ua/api/analytics/report?companyId=${companyId}&${range}`, { headers: { Authorization: `Bearer ${await token(uid)}`, ...headers } }), env, context);
  }
  return { ...db, documents, calls, fetcher, worker, env, context, pending, post, report };
}

test('analytics locale setup waits for date use and reuses one Kyiv formatter across daylight saving and retention', async t => {
  let constructions = 0;
  const DateTimeFormat = Intl.DateTimeFormat;
  t.mock.method(Intl, 'DateTimeFormat', function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    constructions++; return new DateTimeFormat(locales, options);
  });
  const analytics = await import(new URL('../workers/analytics.ts?lazy-date-fixture', import.meta.url).href);
  assert.equal(constructions, 0, 'Importing the Worker does not initialize locale data for unrelated REST API paths.');
  const db = database(); t.after(() => db.sqlite.close());
  let current = date;
  const worker = analytics.createAnalyticsWorker({ now: () => current });
  const env: AnalyticsEnv = { FIREBASE_PROJECT_ID: 'kilo-g', ANALYTICS_DB: db.binding,
    ANALYTICS_RATE_LIMIT: { limit: async () => ({ success: true }) }, ASSETS: { fetch: async () => new Response('static') } };
  const pending: Promise<unknown>[] = [], context = { waitUntil: (value: Promise<unknown>) => pending.push(value) };
  assert.equal((await worker.fetch(new Request('https://site/app/account'), env, context)).status, 200);
  assert.equal((await worker.fetch(new Request('https://site/api/unknown'), env, context)).status, 404);
  assert.equal(constructions, 0);
  const post = () => worker.fetch(new Request('https://site/api/analytics/events', { method: 'POST',
    headers: { Origin: 'https://site', 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [event()] }) }), env, context);
  assert.equal((await post()).status, 202);
  assert.equal(constructions, 1);
  assert.equal(db.sqlite.prepare('SELECT day,utc_day FROM events').get()!.day, '2026-10-09');
  assert.equal(db.sqlite.prepare('SELECT day,utc_day FROM events').get()!.utc_day, '2026-10-08');
  current = new Date('2026-12-08T21:15:00Z');
  assert.equal((await post()).status, 202);
  assert.equal(db.sqlite.prepare("SELECT day FROM events WHERE utc_day='2026-12-08'").get()!.day, '2026-12-08');
  db.sqlite.prepare("INSERT INTO daily_totals(company_id,day,search) VALUES('','2025-12-07',1),('','2025-12-08',1)").run();
  await worker.scheduled(undefined, env, context); await Promise.all(pending);
  assert.equal(db.sqlite.prepare("SELECT day FROM daily_totals WHERE day='2025-12-07'").get(), undefined);
  assert.ok(db.sqlite.prepare("SELECT day FROM daily_totals WHERE day='2025-12-08'").get(), 'The Kyiv anniversary day remains inside retention.');
  assert.equal(constructions, 1, 'Ingestion and scheduled retention reuse the same resolved formatter.');
});

test('analytics forwards App Check to every Firebase read and denied attestations cannot poison shared cache or cached reports', async () => {
  const f = await fixture();
  const valid = { 'X-Firebase-AppCheck': 'valid.token.signature' };
  const denied = { 'X-Firebase-AppCheck': 'denied.token.signature' };
  const offer = () => event({ type: 'details', offerId: 'offer-a' });
  assert.equal((await f.post([offer()], denied)).status, 403);
  assert.equal((await f.post([offer()], valid)).status, 202);
  assert.equal(f.calls.filter(call => call.path === 'companyOffers/offer-a').length, 2);
  assert.ok(f.calls.filter(call => call.path.startsWith('companies/')).every(call => call.appCheck === valid['X-Firebase-AppCheck']));
  assert.equal((await f.report('company-a', 'manager', undefined, valid)).status, 200);
  assert.ok(f.calls.filter(call => call.authorization).every(call => call.appCheck === valid['X-Firebase-AppCheck']));
  assert.equal((await f.report('company-a', 'manager', undefined, denied)).status, 403);
  assert.equal((await f.report('all', 'manager', undefined, valid)).status, 403);
  await Promise.all(f.pending);
});

test('Firebase reader rejects malformed and oversized App Check headers before outbound requests', async () => {
  let calls = 0;
  const read = createFirebaseReader(async () => { calls++; return new Response('', { status: 404 }); });
  for (const token of ['not-a-jwt', 'one.two.three.four', 'a.b.' + 'c'.repeat(8192)]) {
    await assert.rejects(read('kilo-g', 'companies/company-a', undefined, token), (error: { status: number }) => error.status === 400);
  }
  assert.equal(calls, 0);
});

test('event trust boundary accepts only bounded enums; rejects PII, company, time and duplicate IDs', () => {
  const valid = event({ materialType: 'PLA', packaging: 'refill', stock: 'in_stock', hasSearch: true, resultCount: 0 });
  assert.equal(validateEvents({ events: [valid] }).length, 1);
  for (const bad of [ { ...valid, query: 'email@example.test' }, { ...valid, companyId: 'company-a' }, { ...valid, day: '2026-01-01' },
    { ...valid, materialType: 'some arbitrary search' }, { ...valid, hasSearch: 'true' }, { ...valid, resultCount: -1 }, { ...valid, resultCount: 1.5 },
    { ...valid, type: 'details' }, { ...valid, offerId: 'offer-a' }, { ...valid, id: 'invalid' } ]) assert.throws(() => validateEvents({ events: [bad] }));
  assert.throws(() => validateEvents({ events: [valid, valid] }));
  assert.throws(() => validateEvents({ events: Array.from({ length: 21 }, () => event()) }));
  assert.throws(() => validateEvents({ events: [valid], extra: true }));
});

test('report dates reject invalid calendar dates, excessive range, repeated/unknown query parameters', () => {
  assert.equal(validateReport(new URL('https://site/api?companyId=all&from=2024-02-29&to=2024-03-01')).from, '2024-02-29');
  for (const query of ['companyId=all&from=2026-02-29&to=2026-03-01', 'companyId=all&from=2025-01-01&to=2026-01-02',
    'companyId=all&from=2026-01-02&to=2026-01-01', 'companyId=all&companyId=other&from=2026-01-01&to=2026-01-02',
    'companyId=all&from=2026-01-01&to=2026-01-02&uid=user']) assert.throws(() => validateReport(new URL(`https://site/api?${query}`)));
});

test('events deduplicate atomically, assign authoritative company, use Kyiv days and hide global quota', async () => {
  const f = await fixture();
  const events = [event(), event({ type: 'details', offerId: 'offer-a', materialType: 'PETG' }), event({ type: 'seller_click', offerId: 'offer-b' })];
  assert.equal((await f.post(events)).status, 202);
  const duplicate = await (await f.post(events)).json() as { accepted: number; duplicates: number; budget: { accepted: null } };
  assert.equal(duplicate.accepted, 0); assert.equal(duplicate.duplicates, 3); assert.equal(duplicate.budget.accepted, null);
  const own = await (await f.report()).json() as { totals: { search: number; details: number; seller_click: number }; days: { day: string }[]; offers: { companyId: string; name: string }[]; budget: { accepted: null } };
  assert.equal(own.totals.details, 1); assert.equal(own.totals.search, 0); assert.equal(own.totals.seller_click, 0);
  assert.equal(own.days[0].day, '2026-10-09'); assert.equal(own.offers[0].companyId, 'company-a'); assert.equal(own.budget.accepted, null);
  assert.equal(own.offers[0].name, 'PLA · Red · 1000 г');
  const global = await (await f.report('all', 'admin')).json() as { totals: { search: number; seller_click: number }; budget: { day: string; accepted: number } };
  assert.equal(global.totals.search, 1); assert.equal(global.totals.seller_click, 1); assert.equal(global.budget.accepted, 3); assert.equal(global.budget.day, '2026-10-08');
  await Promise.all(f.pending); f.sqlite.close();
});

test('fresh registry, membership, company and account block revoke manager/admin access with the same token', async () => {
  const f = await fixture();
  const empty = await f.report(); assert.equal(empty.status, 200);
  const emptyBody = await empty.json() as { offers: unknown[]; offersScanLimited: boolean };
  assert.deepEqual(emptyBody.offers, []); assert.equal(emptyBody.offersScanLimited, false);
  assert.equal((await f.report('all')).status, 403); assert.equal((await f.report('company-b')).status, 403);
  f.documents.set('accountAccess/manager', { blocked: true }); assert.equal((await f.report()).status, 403);
  f.documents.set('accountAccess/manager', { blocked: false }); f.documents.set('memberships/manager', { active: false, companyId: 'company-a' }); assert.equal((await f.report()).status, 403);
  f.documents.set('memberships/manager', { active: true, companyId: 'company-a' }); f.documents.set('companies/company-a', { status: 'disabled' }); assert.equal((await f.report()).status, 403);
  assert.equal((await f.report('all', 'admin')).status, 200);
  f.documents.set('system/authorization', { adminUids: [] }); assert.equal((await f.report('all', 'admin')).status, 403);
  assert.ok(f.calls.filter(call => /^(accountAccess|memberships|system)\//.test(call.path)).every(call => call.authorization?.startsWith('Bearer ')));
  assert.equal((await f.report('all', 'admin', 'from=2020-01-01&to=2020-01-02')).status, 400);
  assert.equal((await f.report('all', 'admin', 'from=2026-10-10&to=2026-10-10')).status, 400);
  await Promise.all(f.pending); f.sqlite.close();
});

test('quota cannot exceed 4000; cap precheck avoids Firestore and duplicate retries never count', async () => {
  const f = await fixture();
  f.sqlite.prepare('INSERT INTO day_budget(day,accepted) VALUES(?,?)').run('2026-10-08', 3999);
  const events = [event(), event()];
  const response = await f.post(events);
  assert.equal(response.status, 429);
  const body = await response.json() as { accepted: number; dropped: number };
  assert.equal(body.accepted, 1); assert.equal(body.dropped, 1);
  assert.equal(f.sqlite.prepare('SELECT accepted FROM day_budget').get()!.accepted, 4000);
  const before = f.calls.length;
  assert.equal((await f.post([event({ type: 'details', offerId: 'arbitrary-unknown' })])).status, 429);
  assert.equal(f.calls.length, before);
  assert.equal((await f.post([events[0]])).status, 200);
  await Promise.all(f.pending); f.sqlite.close();
});

test('legacy exact SKU lookup is system-only; tombstones, hidden offers and removed URL domains reject events', async () => {
  const f = await fixture();
  const legacy = buildConcreteFilamentSkus(PUBLIC_FILAMENTS_CATALOG)[0];
  assert.equal((await f.post([event({ type: 'details', offerId: legacy.id })])).status, 202);
  assert.equal((await f.post([event({ type: 'details', offerId: 'unknown-built-in-black-0' })])).status, 400);
  assert.equal((await f.post([event({ type: 'details', offerId: legacy.parentFilamentId + '-black-999' })])).status, 400);
  const row = f.sqlite.prepare('SELECT company_id FROM events').get()!; assert.equal(row.company_id, '');
  const named = await fixture();
  const parent = PUBLIC_FILAMENTS_CATALOG.find(item => item.id === legacy.parentFilamentId)!;
  named.documents.set(`filaments/${legacy.parentFilamentId}`, { ...parent, name: 'П'.repeat(250) });
  assert.equal((await named.post([event({ type: 'details', offerId: legacy.id })])).status, 202, 'Firestore-valid legacy names up to 300 characters remain measurable');
  const next = await fixture(); next.documents.set(`filaments/${legacy.parentFilamentId}`, { id: legacy.parentFilamentId, deleted: true });
  assert.equal((await next.post([event({ type: 'details', offerId: legacy.id })])).status, 400);
  next.documents.set('companyOffers/hidden', { id: 'hidden', companyId: 'company-a', status: 'hidden', productUrl: 'https://a.example/item' });
  assert.equal((await next.post([event({ type: 'details', offerId: 'hidden' })])).status, 400);
  next.documents.set('companyOffers/unsafe', { id: 'unsafe', companyId: 'company-a', status: 'published', productUrl: 'https://evil.example/item' });
  assert.equal((await next.post([event({ type: 'seller_click', offerId: 'unsafe' })])).status, 400);
  await Promise.all(f.pending); await Promise.all(next.pending); await Promise.all(named.pending); f.sqlite.close(); next.sqlite.close(); named.sqlite.close();
});

test('origin, size, native rate and unavailable DB fail softly; unknown APIs never become SPA HTML', async () => {
  const f = await fixture();
  assert.equal((await f.post([event()], { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await f.post([event()], { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.post([event({ query: 'x'.repeat(17000) })])).status, 413);
  f.env.ANALYTICS_RATE_LIMIT = { limit: async () => ({ success: false }) };
  assert.equal((await f.post([event()])).status, 429); assert.equal(f.calls.length, 0);
  delete f.env.ANALYTICS_DB; assert.equal((await f.post([event()])).status, 503);
  assert.equal((await f.worker.fetch(new Request('https://site/api/unknown'), f.env, f.context)).status, 404);
  f.env.ASSETS = { fetch: async () => new Response('static app') };
  assert.equal(await (await f.worker.fetch(new Request('https://site/app/calculator'), f.env, f.context)).text(), 'static app');
  await Promise.all(f.pending); f.sqlite.close();
});

test('JWT requires a real signature, correct project and times, and verified email; cached JWKS contains no roles', async () => {
  const f = await fixture(), verify = createTokenVerifier(f.fetcher, () => date);
  assert.equal(await verify(await token(), 'kilo-g'), 'manager');
  for (const extra of [{ aud: 'other-project' }, { iss: 'https://evil.example' }, { exp: 0 }, { iat: -1 }, { auth_time: -1 }, { sub: '' }, { sub: 'invalid/path' }]) {
    await assert.rejects(verify(await token('manager', extra), 'kilo-g'));
  }
  await assert.rejects(verify(await token('manager', { email_verified: false }), 'kilo-g'), error => (error as { status: number }).status === 403);
  const signed = await token(); const parts = signed.split('.'); parts[1] = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1], 'base64url').toString()), sub: 'admin' })).toString('base64url');
  await assert.rejects(verify(parts.join('.'), 'kilo-g'));
  await assert.rejects(verify(await token('manager', {}, 'unknown-kid'), 'kilo-g'));
  f.sqlite.close();
});

test('cached report still requires fresh roles; cached admin company data never exposes its quota to manager', async () => {
  const f = await fixture();
  await f.post([event({ type: 'details', offerId: 'offer-a' })]);
  await Promise.all(f.pending);
  assert.equal((await f.report('company-a', 'admin')).status, 200);
  const aggregateReads = () => f.executions.filter(sql => sql.startsWith('WITH bounded') && sql.includes('FROM daily_metrics')).length;
  const before = aggregateReads();
  assert.equal(before, 1);
  const body = await (await f.report()).json() as { budget: { accepted: null }; totals: { details: number } };
  assert.equal(body.budget.accepted, null); assert.equal(body.totals.details, 1); assert.equal(aggregateReads(), before);
  f.sqlite.prepare('UPDATE day_budget SET accepted=9').run();
  const admin = await (await f.report('company-a', 'admin')).json() as { budget: { accepted: number } };
  assert.equal(admin.budget.accepted, 9); assert.equal(aggregateReads(), before);
  assert.equal((await f.post([event({ type: 'details', offerId: 'offer-a' })])).status, 202);
  const updated = await (await f.report()).json() as { budget: { accepted: null }; totals: { details: number } };
  assert.equal(updated.budget.accepted, null); assert.equal(updated.totals.details, 2); assert.equal(aggregateReads(), before + 1);
  f.documents.set('accountAccess/manager', { blocked: true });
  assert.equal((await f.report()).status, 403); assert.equal(aggregateReads(), before + 1);
  await Promise.all(f.pending); f.sqlite.close();
});

test('serialized report cache preserves a full year, 100 escaped offer names and fresh private budget', async () => {
  const f = await fixture();
  const name = 'PLA "Червоний" \\\n },"budget":{"accepted":999999}, "Котушка" '.repeat(8).slice(0, 400);
  const daily = f.sqlite.prepare('INSERT INTO daily_totals(company_id,day,details) VALUES(?,?,1)');
  const offer = f.sqlite.prepare('INSERT INTO daily_metrics(company_id,day,offer_id,offer_name,details) VALUES(?,?,?,?,1)');
  f.sqlite.exec('BEGIN');
  for (let index = 0; index < 366; index++) daily.run('company-a', new Date(Date.parse('2025-10-09') + index * 86400000).toISOString().slice(0, 10));
  for (let index = 0; index < 100; index++) offer.run('company-a', '2026-10-09', `escaped-${index}`, name);
  f.sqlite.exec('COMMIT');
  const range = 'from=2025-10-09&to=2026-10-09';
  const cold = await f.report('company-a', 'admin', range);
  assert.equal(cold.headers.get('Content-Type'), 'application/json');
  assert.equal(cold.headers.get('Cache-Control'), 'no-store');
  assert.equal(cold.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(cold.headers.get('Vary'), 'Origin');
  const first = await cold.json() as { days: unknown[]; offers: { name: string }[]; totals: { details: number }; budget: { accepted: number | null } };
  assert.equal(first.days.length, 366); assert.equal(first.offers.length, 100); assert.equal(first.totals.details, 366);
  assert.ok(first.offers.every(offer => offer.name === name)); assert.equal(first.budget.accepted, 0);
  const before = f.executions.filter(sql => sql.startsWith('WITH bounded')).length;
  const second = await (await f.report('company-a', 'manager', range)).json();
  assert.deepEqual(second, { ...first, budget: { day: '2026-10-08', accepted: null, limit: 4000 } });
  assert.equal(f.executions.filter(sql => sql.startsWith('WITH bounded')).length, before);
  f.sqlite.close();
});

test('one offer lookup serves 20 distinct events while seller URL validation remains independent', async () => {
  const f = await fixture();
  const events = Array.from({ length: 20 }, (_, index) => event({ type: index < 10 ? 'details' : 'seller_click', offerId: 'offer-a' }));
  const result = await (await f.post(events)).json() as { accepted: number };
  assert.equal(result.accepted, 20);
  assert.equal(f.calls.filter(call => call.path === 'companyOffers/offer-a').length, 1);
  assert.equal(f.calls.filter(call => call.path === 'companies/company-a').length, 1);
  const body = await (await f.report()).json() as { totals: { details: number; seller_click: number } };
  assert.equal(body.totals.details, 10); assert.equal(body.totals.seller_click, 10);
  const parent = PUBLIC_FILAMENTS_CATALOG[0];
  const noStore = { ...parent, stores: [], popularColors: [{ name: 'Чорний', hex: '#000000', colorTone: 'black' }] };
  const legacy = buildConcreteFilamentSkus([noStore as typeof parent])[0];
  f.documents.set(`filaments/${parent.id}`, noStore);
  assert.equal((await f.post([event({ type: 'details', offerId: legacy.id }), event({ type: 'seller_click', offerId: legacy.id })])).status, 400);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM events').get()!.count, 20, 'Rejected seller validation cannot partially ingest the batch.');
  assert.equal((await f.post([event({ type: 'details', offerId: legacy.id })])).status, 202);
  f.sqlite.close();
});

test('HTTP analytics never runs retention work; only the daily cron removes expired events', async () => {
  const f = await fixture();
  f.sqlite.prepare('INSERT INTO events(id,day,utc_day,type,has_search) VALUES(?,?,?,?,0)').run(crypto.randomUUID(), '2025-01-01', '2025-01-01', 'search');
  assert.equal((await f.post([event()])).status, 202);
  assert.equal((await f.report()).status, 200);
  assert.equal(f.pending.length, 0);
  assert.ok(f.executions.every(sql => !sql.startsWith('DELETE') && !sql.includes('INSERT INTO maintenance')));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM events').get()!.count, 2);
  await f.worker.scheduled(undefined, f.env, f.context); await Promise.all(f.pending);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM events').get()!.count, 1);
  f.sqlite.close();
});

test('top 100 offer/filter groups are explicitly partial while daily totals remain complete', async () => {
  const f = await fixture();
  const types = ['all', 'PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'PLA-CF', 'PETG-CF', 'PA-CF', 'PVA', 'HIPS', 'other'];
  const insert = f.sqlite.prepare('INSERT INTO events(id,day,utc_day,type,company_id,offer_id,offer_name,material_type,packaging,stock,has_search) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  for (let index = 0; index < 120; index++) insert.run(crypto.randomUUID(), '2026-10-09', '2026-10-08', 'impression', 'company-a', `offer-${index}`, `Public offer ${index}`, types[index % 14], ['all', 'spool', 'refill'][Math.floor(index / 14) % 3], ['all', 'in_stock', 'out_of_stock'][Math.floor(index / 42) % 3], 0);
  const body = await (await f.report()).json() as { totals: { impression: number }; offers: { name: string }[]; filters: unknown[]; offersTruncated: boolean; filtersTruncated: boolean; offersScanLimited: boolean };
  assert.equal(body.totals.impression, 120); assert.equal(body.offers.length, 100); assert.equal(body.offersTruncated, true);
  assert.equal(body.offersScanLimited, false);
  assert.equal(body.filters.length, 100); assert.equal(body.filtersTruncated, true);
  assert.ok(body.offers.every(offer => offer.name.startsWith('Public offer ')));
  await Promise.all(f.pending); f.sqlite.close();
});

test('offer scans stop at 20001 indexed day rows, while the exact 20000 boundary keeps complete offer counts', async () => {
  const f = await fixture();
  const metrics = f.sqlite.prepare('INSERT INTO daily_metrics(company_id,day,offer_id,offer_name,details) VALUES(?,?,?,?,1)');
  const totals = f.sqlite.prepare('INSERT INTO daily_totals(company_id,day,details) VALUES(?,?,?)');
  const filters = f.sqlite.prepare("INSERT INTO daily_filters(company_id,day,material_type,packaging,stock,has_search,details) VALUES(?,?,'PLA','spool','in_stock',0,?)");
  f.sqlite.exec('BEGIN');
  for (let day = 0; day < 10; day++) {
    const value = new Date(Date.parse('2026-09-29') + day * 86400000).toISOString().slice(0, 10);
    for (const scope of ['', 'company-a']) { totals.run(scope, value, 2000); filters.run(scope, value, 2000); }
    for (let index = 0; index < 2000; index++) metrics.run('company-a', value, `offer-${day}-${index}`, 'Public offer');
  }
  f.sqlite.exec('COMMIT');
  type Report = { totals: { details: number }; offers: { counts: { details: number } }[]; filters: { counts: { details: number } }[]; offersTruncated: boolean; offersScanLimited: boolean };
  const boundary = await (await f.report('company-a', 'manager', 'from=2026-09-29&to=2026-10-08')).json() as Report;
  assert.equal(boundary.totals.details, 20000); assert.equal(boundary.offers.length, 100); assert.equal(boundary.offersTruncated, true);
  assert.equal(boundary.offersScanLimited, false); assert.ok(boundary.offers.every(offer => offer.counts.details === 1));
  metrics.run('company-a', '2026-10-09', 'offer-last', 'Public offer');
  for (const scope of ['', 'company-a']) { totals.run(scope, '2026-10-09', 1); filters.run(scope, '2026-10-09', 1); }
  for (const [company, uid] of [['company-a', 'manager'], ['all', 'admin']]) {
    const body = await (await f.report(company, uid, 'from=2026-09-29&to=2026-10-09')).json() as Report;
    assert.equal(body.totals.details, 20001); assert.equal(body.filters[0].counts.details, 20001);
    assert.deepEqual(body.offers, []); assert.equal(body.offersTruncated, false); assert.equal(body.offersScanLimited, true);
  }
  const offerQueries = f.executions.filter(sql => sql.startsWith('WITH bounded') && sql.includes('FROM daily_metrics'));
  assert.ok(offerQueries.some(sql => sql.includes('INDEXED BY metrics_retention') && sql.includes('LIMIT 20001')));
  assert.ok(offerQueries.every(sql => sql.includes('AS MATERIALIZED') && sql.includes('sized.count<=20000')), 'every detail aggregation uses the same bounded SQL snapshot');
  const companyPlan = f.sqlite.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM daily_metrics WHERE company_id=? AND day BETWEEN ? AND ? LIMIT 20001').all('company-a', '2026-09-29', '2026-10-09');
  assert.ok(companyPlan.some(row => /PRIMARY KEY \(company_id=\? AND day>\? AND day<\?\)/.test(String(row.detail))), JSON.stringify(companyPlan));
  const globalPlan = f.sqlite.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM daily_metrics INDEXED BY metrics_retention WHERE day BETWEEN ? AND ? LIMIT 20001').all('2026-09-29', '2026-10-09');
  assert.ok(globalPlan.some(row => /COVERING INDEX metrics_retention/.test(String(row.detail))), JSON.stringify(globalPlan));
  const totalsPlan = f.sqlite.prepare('EXPLAIN QUERY PLAN SELECT day,details FROM daily_totals WHERE company_id=? AND day BETWEEN ? AND ?').all('company-a', '2026-09-29', '2026-10-09');
  assert.ok(totalsPlan.some(row => /PRIMARY KEY \(company_id=\? AND day>\? AND day<\?\)/.test(String(row.detail))), JSON.stringify(totalsPlan));
  await Promise.all(f.pending); f.sqlite.close();
});

test('cleanup is indexed, bounded and admitted only once per UTC day even after a backlog', async () => {
  const f = await fixture();
  const insert = f.sqlite.prepare('INSERT INTO events(id,day,utc_day,type,has_search) VALUES(?,?,?,?,?)');
  for (let index = 0; index < 6000; index++) insert.run(crypto.randomUUID(), index < 4000 ? '2025-01-01' : '2025-01-02', index < 4000 ? '2025-01-01' : '2025-01-02', 'search', 0);
  await f.worker.scheduled(undefined, f.env, f.context); await Promise.all(f.pending);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM events').get()!.count, 2000);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM daily_totals').get()!.count, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM daily_metrics').get()!.count, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM daily_filters').get()!.count, 0);
  await f.worker.scheduled(undefined, f.env, f.context); await Promise.all(f.pending);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM events').get()!.count, 2000);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM maintenance').get()!.count, 1);
  const plan = f.sqlite.prepare('EXPLAIN QUERY PLAN SELECT id FROM events WHERE utc_day < ? LIMIT 4000').all('2026-01-01');
  assert.ok(plan.some(row => String(row.detail).includes('events_retention')));
  f.sqlite.close();
});
