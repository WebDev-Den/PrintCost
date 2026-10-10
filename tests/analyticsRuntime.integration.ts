import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { build } from 'esbuild';
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare';
import { createAnalyticsWorker, type AnalyticsDatabase } from '../workers/analytics.ts';

// Explicit integration command: npx tsx --test tests/analyticsRuntime.integration.ts.
// Requires a Firestore emulator; installs real Rules in its own fresh project.
// Own loopback Auth server and fixture cleanup never touch demo-kilog browser data.
// The production handler is bundled unchanged. Only outbound transport is replaced:
// synthetic Google public keys and loopback Firestore. No unsigned-token bypass.
const PROJECT = `demo-kilog-analytics-runtime-${randomUUID().slice(0, 8)}`;
const FIRESTORE = 'http://127.0.0.1:8080';
const ORIGIN = 'https://analytics-runtime.invalid';
const DOCS = `/v1/projects/${PROJECT}/databases/(default)/documents/`;
const { createApp } = createRequire(import.meta.url)('firebase-tools/lib/emulator/auth/server.js');

function firestoreValue(value: unknown): Record<string, unknown> {
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  assert.ok(value && typeof value === 'object');
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, firestoreValue(item)])) } };
}

async function localDocument(path: string, value?: Record<string, unknown>): Promise<any> {
  const response = await fetch(`${FIRESTORE}${DOCS}${path}`, {
    method: value ? 'PATCH' : 'GET',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: value ? JSON.stringify({ fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, firestoreValue(item)])) }) : undefined,
  });
  assert.ok(response.ok, `Local fixture document ${path}: HTTP ${response.status}`);
  return response.json();
}

async function localUser(authOrigin: string): Promise<{ uid: string; payload: Record<string, unknown>; unsignedToken: string }> {
  const response = await fetch(`${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `analytics-runtime-${randomUUID()}@example.invalid`, password: randomUUID(), returnSecureToken: true }),
  });
  assert.ok(response.ok, `Local Auth fixture: HTTP ${response.status}`);
  const result = await response.json() as { localId: string; idToken: string };
  const payload = JSON.parse(Buffer.from(result.idToken.split('.')[1], 'base64url').toString());
  assert.equal(payload.aud, PROJECT, 'Auth fixture must belong to the isolated test project.');
  return { uid: result.localId, payload, unsignedToken: result.idToken };
}

function signedToken(payload: Record<string, unknown>, privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], changes: Record<string, unknown> = {}, headerChanges: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'runtime-fixture', typ: 'JWT', ...headerChanges })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, email_verified: true, ...changes })).toString('base64url');
  const input = `${header}.${body}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

function percentile(samples: number[], fraction: number): number {
  return [...samples].sort((a, b) => a - b)[Math.min(samples.length - 1, Math.floor(samples.length * fraction))];
}

test('production analytics Worker with local D1 and Firestore authorization', { timeout: 120_000 }, async t => {
  const environment = await initializeTestEnvironment({ projectId: PROJECT,
    firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } });
  t.after(() => environment.cleanup());
  const authServer = (await createApp(PROJECT)).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => authServer.close((error?: Error) => error ? reject(error) : resolve())));
  await once(authServer, 'listening');
  const authOrigin = `http://127.0.0.1:${authServer.address().port}`;
  const admin = await localUser(authOrigin);
  const manager = await localUser(authOrigin);
  const plainUser = await localUser(authOrigin);
  const adminUid = admin.uid;
  const prefix = `analytics-runtime-${randomUUID()}`;
  const companyId = `${prefix}-a`;
  const foreignCompanyId = `${prefix}-b`;
  const offerId = `${prefix}-offer`;
  const createdAt = new Date();
  const fixturePaths: string[] = [];
  async function seed(path: string, value: Record<string, unknown>) {
    fixturePaths.push(path);
    await localDocument(path, value);
  }
  const company = { id: companyId, name: 'Runtime fixture', website: 'https://shop-runtime.invalid/', allowedDomains: ['shop-runtime.invalid'], status: 'active', version: 1, createdBy: adminUid, createdAt, updatedAt: createdAt, updatedBy: adminUid, changeId: randomUUID() };
  const access = { blocked: false, updatedAt: createdAt, updatedBy: adminUid, changeId: randomUUID() };
  const membership = { companyId, active: true, version: 1, updatedAt: createdAt, updatedBy: adminUid, changeId: randomUUID() };
  let mf: Miniflare | undefined;
  try {
    assert.equal((await fetch(`${FIRESTORE}${DOCS}system/authorization`, { headers: { Authorization: 'Bearer owner' } })).status, 404,
      'The isolated project starts without any manually bootstrapped registry.');
    await seed('system/authorization', { adminUids: [adminUid], bootstrapUid: adminUid, initializedAt: createdAt, version: 1, lastChangeId: randomUUID() });
    await seed(`accountAccess/${adminUid}`, access);
    await seed(`memberships/${adminUid}`, { ...membership, companyId: null, active: false });
    await seed(`companies/${companyId}`, company);
    await seed(`companies/${foreignCompanyId}`, { ...company, id: foreignCompanyId });
    await seed(`accountAccess/${manager.uid}`, access);
    await seed(`memberships/${manager.uid}`, membership);
    await seed(`accountAccess/${plainUser.uid}`, access);
    await seed(`memberships/${plainUser.uid}`, { ...membership, companyId: null, active: false });
    await seed(`companyOffers/${offerId}`, {
      id: offerId, companyId, createdBy: manager.uid, updatedBy: manager.uid, version: 1,
      name: 'Runtime PLA', brand: 'Fixture', type: 'PLA', family: 'Стандартні', colorName: 'Чорний', colorHex: '#000000', colorTone: 'black', packagingType: 'spool', spoolWeightGrams: 1000, priceUah: 500, diameterMm: 1.75, description: '', productUrl: 'https://shop-runtime.invalid/pla', inStock: true, status: 'published', createdAt, updatedAt: createdAt,
    });
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'runtime-fixture', alg: 'RS256', use: 'sig' };
    const bundle = await build({ entryPoints: ['workers/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
    let jwksRequests = 0;
    let firestoreRequests = 0;
    mf = new Miniflare(convertV4MiniflareOptions({
      name: 'analytics-runtime',
      inspectorPort: process.env.MEASURE_ANALYTICS_CPU === '1' ? 9339 : undefined,
      modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-08',
      bindings: { FIREBASE_PROJECT_ID: PROJECT }, d1Databases: ['ANALYTICS_DB'],
      queueProducers: { IMPORT_QUEUE: 'analytics-maintenance' },
      queueConsumers: { 'analytics-maintenance': { maxBatchSize: 1, maxBatchTimeout: 0, maxRetries: 3, retryDelay: 0 } },
      serviceBindings: { ASSETS: () => new RuntimeResponse('fixture SPA') },
      outboundService: async request => {
        const url = new URL(request.url);
        if (url.hostname === 'www.googleapis.com' && url.pathname.includes('securetoken')) {
          jwksRequests++;
          return new RuntimeResponse(JSON.stringify({ keys: [jwk] }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
        }
        assert.equal(url.hostname, 'firestore.googleapis.com', 'No external network from integration fixtures.');
        assert.ok(url.pathname.startsWith(DOCS), 'Fixture cannot access a real Firebase project.');
        firestoreRequests++;
        const upstream = await fetch(`${FIRESTORE}${url.pathname}${url.search}`, { method: request.method, headers: request.headers, body: request.method === 'GET' ? undefined : await request.text() });
        return new RuntimeResponse(await upstream.arrayBuffer(), { status: upstream.status, headers: Object.fromEntries(upstream.headers) });
      },
      ratelimits: { ANALYTICS_RATE_LIMIT: { namespace_id: 'analytics-runtime', simple: { limit: 10_000, period: 60 } } },
    }));
    const db = await mf.getD1Database('ANALYTICS_DB');
    for (const file of ['0001_analytics.sql', '0002_import_api.sql', '0005_analytics_report_budget.sql', '0007_maintenance_budget.sql', '0008_analytics_event_budget.sql']) {
      const migration = await readFile('migrations/' + file, 'utf8');
      // D1 exec treats newlines as statement separators; preserve each trigger body.
      for (const statement of migration.replace(/--[^\n]*/g, '').trim().split(/(?<=;)\s*(?=(?:CREATE|ALTER|DROP)\b)/i)) await db.prepare(statement).run();
    }
    const managerToken = signedToken(manager.payload, pair.privateKey);
    const userToken = signedToken(plainUser.payload, pair.privateKey);
    const adminToken = signedToken(admin.payload, pair.privateKey);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const report = (token: string, company = companyId, from = today, to = today) => mf!.dispatchFetch(`${ORIGIN}/api/analytics/report?companyId=${encodeURIComponent(company)}&from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${token}` } });
    const post = (events: object[]) => mf!.dispatchFetch(`${ORIGIN}/api/analytics/events`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ events }) });

    const utcDay = new Date().toISOString().slice(0, 10);
    const firstEvent = { id: randomUUID(), type: 'impression', offerId };
    await t.test('signed identity authorizes only fresh company membership', async () => {
      assert.equal((await report(manager.unsignedToken)).status, 401);
      const allowed = await report(managerToken);
      assert.equal(allowed.status, 200, await allowed.text());
      assert.equal((await report(userToken)).status, 403);
      assert.equal((await report(managerToken, foreignCompanyId)).status, 403);
      assert.equal((await report(managerToken, 'all')).status, 403);
      assert.equal((await report(adminToken, 'all')).status, 200);
      assert.equal(jwksRequests, 1, 'Only public signing keys are cached.');
      await localDocument(`memberships/${manager.uid}`, { ...membership, active: false, companyId: null, version: 2 });
      assert.equal((await report(managerToken)).status, 403, 'Same still-valid JWT loses report access immediately after role revocation.');
      await localDocument(`memberships/${manager.uid}`, membership);
      await localDocument(`accountAccess/${manager.uid}`, { ...access, blocked: true });
      assert.equal((await report(managerToken)).status, 403, 'Blocked account cannot report with its old JWT.');
      await localDocument(`accountAccess/${manager.uid}`, access);
    });
    await t.test('malformed, forged, expired and unverified identities deny', async () => {
      const parts = managerToken.split('.');
      parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
      const forged = parts.join('.');
      for (const token of ['invalid', forged, signedToken(manager.payload, pair.privateKey, { aud: 'foreign-project' }), signedToken(manager.payload, pair.privateKey, { iss: 'https://securetoken.google.com/foreign' }), signedToken(manager.payload, pair.privateKey, { exp: 1 }), signedToken(manager.payload, pair.privateKey, { iat: 9_999_999_999 }), signedToken(manager.payload, pair.privateKey, { auth_time: 9_999_999_999 }), signedToken(manager.payload, pair.privateKey, {}, { alg: 'none' }), signedToken(manager.payload, pair.privateKey, {}, { kid: 'unknown' })]) {
        assert.equal((await report(token)).status, 401);
      }
      assert.equal((await report(signedToken(manager.payload, pair.privateKey, { email_verified: false }))).status, 403);
    });
    await t.test('events derive company ownership and deduplicate', async () => {
      const event = firstEvent;
      const accepted = await post([event]);
      assert.equal(accepted.status, 202, await accepted.text());
      const duplicate = await post([event]);
      assert.equal(duplicate.status, 200);
      const duplicateBody = await duplicate.json() as { accepted: number; duplicates: number; budget: { accepted: number | null } };
      assert.equal(duplicateBody.accepted, 0);
      assert.equal(duplicateBody.duplicates, 1);
      assert.equal(duplicateBody.budget.accepted, null, 'Anonymous responses never reveal global usage.');
      const ownReport = await (await report(managerToken)).json() as { totals: { impression: number }; offers: { name: string; companyId: string }[]; budget: { accepted: number | null } };
      assert.equal(ownReport.totals.impression, 1);
      assert.equal(ownReport.offers[0].companyId, companyId);
      assert.ok(ownReport.offers[0].name.includes('Runtime PLA'));
      assert.equal(ownReport.budget.accepted, null);
      assert.equal((await post([{ ...event, id: randomUUID(), companyId: foreignCompanyId }])).status, 400);
      assert.equal((await post([{ ...event, id: randomUUID(), email: 'private@example.invalid' }])).status, 400);
      assert.equal((await post([{ ...event, id: randomUUID(), offerId: `${prefix}-missing` }])).status, 400);
      assert.equal((await post(Array.from({ length: 21 }, () => ({ ...event, id: randomUUID() })))).status, 400);
      assert.equal((await mf!.dispatchFetch(`${ORIGIN}/api/analytics/events`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: ' '.repeat(16_385) })).status, 413);
      assert.equal((await mf!.dispatchFetch(`${ORIGIN}/api/analytics/events`, { method: 'POST', headers: { Origin: 'https://foreign.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [event] }) })).status, 403);
      assert.equal((await mf!.dispatchFetch(`${ORIGIN}/api/analytics/events`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
      assert.equal((await mf!.dispatchFetch(`${ORIGIN}/api/nonexistent`)).status, 404);
      assert.equal(await (await mf!.dispatchFetch(`${ORIGIN}/app/dashboard`)).text(), 'fixture SPA');
    });
    await t.test('daily quota is atomic across simultaneous batches and duplicate retries', async () => {
      await db.prepare('UPDATE day_budget SET accepted=1999 WHERE day=?').bind(utcDay).run();
      const batches = await Promise.all([post(Array.from({ length: 20 }, () => ({ id: randomUUID(), type: 'search' }))), post(Array.from({ length: 20 }, () => ({ id: randomUUID(), type: 'filter' })))]);
      const bodies = await Promise.all(batches.map(async response => { assert.equal(response.status, 429); return response.json() as Promise<{ accepted: number; dropped: number }> }));
      assert.equal(bodies.reduce((sum, item) => sum + item.accepted, 0), 1);
      assert.equal(bodies.reduce((sum, item) => sum + item.dropped, 0), 39);
      assert.equal((await db.prepare('SELECT accepted FROM day_budget WHERE day=?').bind(utcDay).first<{ accepted: number }>())?.accepted, 2000);
      assert.equal((await post([firstEvent])).status, 200);
      assert.equal((await post([{ id: randomUUID(), type: 'search' }])).status, 429);
      const globalReport = await (await report(adminToken, 'all')).json() as { budget: { accepted: number; limit: number } };
      assert.equal(globalReport.budget.accepted, 2000); assert.equal(globalReport.budget.limit, 2000);
    });
    await t.test('retention removes one bounded chunk, preserves rollups and claims one cleanup per UTC day', async () => {
      const expired = new Date(Date.now() - 32 * 86400000).toISOString().slice(0, 10);
      const secondExpired = new Date(Date.now() - 33 * 86400000).toISOString().slice(0, 10);
      const thirdExpired = new Date(Date.now() - 34 * 86400000).toISOString().slice(0, 10);
      for (const [day, offset, length] of [[expired, 0, 2000], [secondExpired, 2000, 2000], [thirdExpired, 4000, 1]] as const) {
        await db.prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<?) INSERT INTO events(id,day,utc_day,type,has_search) SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-'||printf('%012d',n+?),?,?, 'search',0 FROM seq`).bind(length, offset, day, day).run();
      }
      await db.prepare('DELETE FROM maintenance WHERE day=?').bind(utcDay).run();
      assert.equal((await report(managerToken)).status, 200);
      assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM events WHERE utc_day<?').bind(expired + 'z').first<{ count: number }>())?.count, 4001,
        'HTTP reports never spend their CPU budget on retention maintenance.');
      const worker = await mf!.getWorker() as unknown as { scheduled(controller: { cron: string }): Promise<{ outcome: string }> };
      assert.equal((await worker.scheduled({ cron: '0 2 * * *' })).outcome, 'ok', 'Cron must enqueue analytics maintenance successfully.');
      let remaining = (await db.prepare('SELECT COUNT(*) AS count FROM events WHERE utc_day<?').bind(expired + 'z').first<{ count: number }>())?.count;
      for (let attempt = 0; remaining === 4001 && attempt < 20; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        remaining = (await db.prepare('SELECT COUNT(*) AS count FROM events WHERE utc_day<?').bind(expired + 'z').first<{ count: number }>())?.count;
      }
      assert.equal(remaining, 1);
      assert.equal((await db.prepare("SELECT SUM(search) AS count FROM daily_totals WHERE company_id='' AND day IN (?,?,?)").bind(expired, secondExpired, thirdExpired).first<{ count: number }>())?.count, 4001, 'Deleting raw events never decrements retained daily aggregates.');
      assert.equal((await report(managerToken)).status, 200);
      assert.equal((await worker.scheduled({ cron: '0 2 * * *' })).outcome, 'ok');
      assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM events WHERE utc_day<?').bind(expired + 'z').first<{ count: number }>())?.count, 1, 'The second daily cron cannot run the cleanup twice.');
    });
    await t.test('one bounded report snapshot protects full-month and full-year capacity', async () => {
      await db.prepare(`WITH RECURSIVE days(d) AS (SELECT 0 UNION ALL SELECT d+1 FROM days WHERE d<29), offers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM offers WHERE n<4000)
        INSERT INTO daily_metrics(company_id,day,offer_id,offer_name,impression)
        SELECT ?,date(?,'-'||days.d||' days'),'capacity-'||days.d||'-'||offers.n,'Capacity fixture',1 FROM days CROSS JOIN offers`).bind(companyId, today).run();
      const columns = 'SUM(search) AS search,SUM(filter) AS filter,SUM(no_results) AS no_results,SUM(impression) AS impression,SUM(details) AS details,SUM(seller_click) AS seller_click,SUM(add_material) AS add_material';
      const score = 'SUM(search+filter+no_results+impression+details+seller_click+add_material)';
      const measurements = [];
      for (const durationDays of [1, 30, 366]) {
        const from = new Date(Date.parse(today) - (durationDays - 1) * 86400000).toISOString().slice(0, 10);
        for (const scope of ['manager', 'global']) {
          const bindings = [...(scope === 'manager' ? [companyId] : []), from, today];
          const result = await db.prepare(`WITH bounded AS MATERIALIZED (SELECT * FROM daily_metrics${scope === 'global' ? ' INDEXED BY metrics_retention' : ''} WHERE ${scope === 'manager' ? 'company_id=? AND ' : ''}day BETWEEN ? AND ? LIMIT 20001),
            sized AS (SELECT COUNT(*) AS count FROM bounded),
            grouped AS (SELECT offer_id,company_id,MAX(CASE WHEN offer_name<>'' THEN day||'|'||offer_name END) AS label,${columns},${score} AS score
              FROM bounded,sized WHERE sized.count<=20000 GROUP BY company_id,offer_id ORDER BY score DESC,offer_id LIMIT 101)
            SELECT sized.count AS scan_count,grouped.* FROM sized LEFT JOIN grouped ON 1 ORDER BY grouped.score DESC,grouped.offer_id`).bind(...bindings).all<{ scan_count: number; offer_id: string | null }>();
          const limited = Number(result.results[0].scan_count) > 20_000;
          assert.ok(result.results.length <= 101);
          assert.ok(result.meta.rows_read <= 100_006, 'A single report snapshot never scans all historical offer rows.');
          if (limited) assert.equal(result.results[0].offer_id, null, 'The size-only sentinel represents a skipped detail aggregate.');
          measurements.push({ durationDays, scope, sourceRows: result.results[0].scan_count, offersScanLimited: limited, rowsRead: result.meta.rows_read, sqlDurationMs: result.meta.duration });
        }
      }
      const monthFrom = new Date(Date.parse(today) - 29 * 86400000).toISOString().slice(0, 10);
      const actual = await report(managerToken, companyId, monthFrom);
      assert.equal(actual.status, 200);
      const actualBody = await actual.json() as { offersScanLimited: boolean; offers: unknown[]; totals: { impression: number } };
      assert.equal(actualBody.offersScanLimited, true);
      assert.deepEqual(actualBody.offers, []);
      assert.equal(actualBody.totals.impression, 1, 'Full totals remain available independently of bounded offer detail.');
      t.diagnostic(JSON.stringify({ reportScans: measurements, historicalFixtureOfferRows: 120_000, theoreticalYearOfferRowsAtCurrentDailyQuota: 2000 * 366, note: 'The historical fixture preserves4000 daily rows to verify legacy backlog. One materialized20001-row snapshot suppresses large offer aggregates without a count/ingest race; full totals use separate small indexed daily rows. Short cached reports still perform fresh access checks.' }));
      await db.prepare("DELETE FROM daily_metrics WHERE offer_id LIKE 'capacity-%'").run();
      const writeProbe = await db.prepare('INSERT INTO events(id,day,utc_day,type,company_id,offer_id,has_search) VALUES(?,?,?,?,?,?,0)').bind(randomUUID(), '2026-01-01', '2026-01-01', 'impression', 'capacity-new-company', 'capacity-new-offer').run();
      const steady = await db.batch(Array.from({ length: 20 }, (_, index) => db.prepare('INSERT INTO events(id,day,utc_day,type,company_id,offer_id,has_search) VALUES(?,?,?,?,?,?,0)').bind(randomUUID(), '2026-01-01', '2026-01-01', 'impression', `capacity-company-${index}`, `capacity-offer-${index}`)));
      const materialTypes = ['all', 'PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'PLA-CF', 'PETG-CF', 'PA-CF', 'PVA', 'HIPS', 'other'];
      const diverse = await db.batch(Array.from({ length: 20 }, (_, index) => db.prepare('INSERT INTO events(id,day,utc_day,type,company_id,offer_id,material_type,packaging,stock,has_search) VALUES(?,?,?,?,?,?,?,?,?,1)').bind(randomUUID(), '2026-01-01', '2026-01-01', 'impression', `capacity-other-company-${index}`, `capacity-other-offer-${index}`, materialTypes[index % 14], index % 2 ? 'spool' : 'refill', ['all', 'in_stock', 'out_of_stock'][index % 3])));
      const writtenRows = (sum: number, item: { meta: { rows_written: number } }) => sum + item.meta.rows_written;
      t.diagnostic(JSON.stringify({ firstDistinctCompanyOfferRowsWritten: writeProbe.meta.rows_written, steadyDistinctCompanyOfferBatchRowsWritten: steady.reduce(writtenRows, 0), differentFilterGroupsBatchRowsWritten: diverse.reduce(writtenRows, 0), batchSize: 20, historicalEstimatedDailyWritesAt4000Events: 76_763, note: 'These probe rows preserve the old4000/day capacity estimate as historical. Current intake is2000/day; the separate native combined-budget test measures current attempt counters and full legacy cleanup.' }));
    });
    await t.test('real D1 report budgets admit one concurrent last slot and refund measured reads', async () => {
      await db.prepare('UPDATE analytics_report_budget SET checks=1499,reserved_reads=0 WHERE day=?').bind(utcDay).run();
      const before = firestoreRequests;
      const checked = await Promise.all([report(managerToken), report(managerToken)]);
      assert.deepEqual(checked.map(response => response.status).sort(), [200, 429]);
      assert.ok(checked.find(response => response.status === 429)!.headers.get('Retry-After'));
      assert.equal(firestoreRequests - before, 4, 'The denied check cannot reach Firestore; cached data still checks live permissions.');
      await db.prepare('UPDATE analytics_report_budget SET checks=0,reserved_reads=875000 WHERE day=?').bind(utcDay).run();
      const reserve = () => db.prepare('UPDATE analytics_report_budget SET reserved_reads=reserved_reads+? WHERE day=? AND reserved_reads<=? RETURNING day').bind(125000, utcDay, 875000).all();
      const reserved = await Promise.all([reserve(), reserve()]);
      assert.deepEqual(reserved.map((result: { results: unknown[] }) => result.results.length).sort(), [0, 1]);
      assert.equal((await db.prepare('SELECT reserved_reads FROM analytics_report_budget WHERE day=?').bind(utcDay).first<{ reserved_reads: number }>())!.reserved_reads, 1000000);
      const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
      assert.equal((await report(adminToken, 'all', yesterday, today)).status, 429);
      await db.prepare('UPDATE analytics_report_budget SET checks=0,reserved_reads=0 WHERE day=?').bind(utcDay).run();
      assert.equal((await report(adminToken, 'all', yesterday, today)).status, 200);
      const usage = (await db.prepare('SELECT reserved_reads FROM analytics_report_budget WHERE day=?').bind(utcDay).first<{ reserved_reads: number }>())!.reserved_reads;
      assert.ok(usage >= 0 && usage < 125000, 'Native D1 rows_read refunds the conservative reservation.');
      t.diagnostic(JSON.stringify({ measuredSmallReportReads: usage, concurrentLastCheckWinners: 1, concurrentLastReadReservationWinners: 1 }));
    });
    await t.test('complete maximum offer and filter snapshots fit the conservative daily read reservation', async () => {
      await db.prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<20000)
        INSERT INTO daily_metrics(company_id,day,offer_id,offer_name,impression) SELECT ?,?,'worst-'||n,'Worst case fixture',1 FROM seq`).bind(foreignCompanyId, today).run();
      const types = ['all', 'PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'PLA-CF', 'PETG-CF', 'PA-CF', 'PVA', 'HIPS', 'other'];
      const material = types.map((type, index) => `WHEN ${index} THEN '${type}'`).join(' ');
      await db.prepare(`WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n<4999)
        INSERT INTO daily_filters(company_id,day,material_type,packaging,stock,has_search,search)
        SELECT ?,date(?,'-'||(n/252)||' days'),CASE n%14 ${material} END,
          CASE (n/14)%3 WHEN 0 THEN 'all' WHEN 1 THEN 'spool' ELSE 'refill' END,
          CASE (n/42)%3 WHEN 0 THEN 'all' WHEN 1 THEN 'in_stock' ELSE 'out_of_stock' END,(n/126)%2,1 FROM seq`).bind(foreignCompanyId, today).run();
      await db.prepare(`WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n<365)
        INSERT INTO daily_totals(company_id,day,impression) SELECT ?,date(?,'-'||n||' days'),1 FROM seq`).bind(foreignCompanyId, today).run();
      await db.prepare('UPDATE analytics_report_budget SET checks=0,reserved_reads=0 WHERE day=?').bind(utcDay).run();
      const from = new Date(Date.parse(today) - 365 * 86400000).toISOString().slice(0, 10);
      const response = await report(adminToken, foreignCompanyId, from);
      assert.equal(response.status, 200);
      const body = await response.json() as { totals: { impression: number }; days: unknown[]; offers: unknown[]; offersScanLimited: boolean; filters: unknown[]; filtersTruncated: boolean };
      assert.equal(body.totals.impression, 366); assert.equal(body.days.length, 366);
      assert.equal(body.offers.length, 100); assert.equal(body.offersScanLimited, false);
      assert.equal(body.filters.length, 100); assert.equal(body.filtersTruncated, true);
      const usage = (await db.prepare('SELECT reserved_reads FROM analytics_report_budget WHERE day=?').bind(utcDay).first<{ reserved_reads: number }>())!.reserved_reads;
      assert.ok(usage > 0 && usage <= 125000, 'Measured native D1 usage must fit the conservative125k reservation.');
      t.diagnostic(JSON.stringify({ maximumReportReads: usage, offerSourceRows: 20000, filterSourceRows: 5000, totalDays: 366, reservation: 125000 }));
    });
    const samples: number[] = [];
    let profiler: { stop(): Promise<any>; close(): void } | undefined;
    if (process.env.MEASURE_ANALYTICS_CPU === '1') {
      const inspectorUrl = await mf.getInspectorURL();
      inspectorUrl.protocol = 'http:';
      const targets = await (await fetch(new URL('/json/list', inspectorUrl))).json() as { webSocketDebuggerUrl: string; title: string }[];
      const target = targets.find(item => item.title.includes('analytics-runtime')) || targets[0];
      assert.ok(target?.webSocketDebuggerUrl, 'Local workerd inspector must expose the actual Worker.');
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise<void>((resolve, reject) => { socket.addEventListener('open', () => resolve(), { once: true }); socket.addEventListener('error', () => reject(new Error('Local CPU profiler connection failed.')), { once: true }); });
      let id = 0;
      const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
      socket.addEventListener('message', message => {
        const result = JSON.parse(String(message.data));
        const waiter = pending.get(result.id);
        if (waiter) { pending.delete(result.id); result.error ? waiter.reject(new Error(result.error.message)) : waiter.resolve(result.result); }
      });
      const send = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => { const requestId = ++id; pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); });
      await send('Profiler.enable');
      await send('Profiler.setSamplingInterval', { interval: 100 });
      await send('Profiler.start');
      profiler = { stop: () => send('Profiler.stop'), close: () => socket.close() };
    }
    for (let index = 0; index < 25; index++) {
      const started = performance.now();
      assert.equal((await report(managerToken)).status, 200);
      samples.push(performance.now() - started);
    }
    t.diagnostic(JSON.stringify({ localWorkerdReportWallMs: { samples: samples.length, p50: percentile(samples, 0.5), p95: percentile(samples, 0.95) }, firestoreRequests, jwksRequests, note: 'Local wall time includes emulator and D1 I/O; not production CPU or a guarantee of the Free 10ms budget.' }));
    if (profiler) {
      const { profile } = await profiler.stop();
      profiler.close();
      const names = new Map<number, string>(profile.nodes.map((node: any) => [node.id, node.callFrame.functionName]));
      const byFunction = new Map<string, number>();
      let activeMicros = 0;
      for (let index = 0; index < profile.samples.length; index++) {
        const name = names.get(profile.samples[index]) || '(anonymous)';
        const micros = profile.timeDeltas[index] || 0;
        byFunction.set(name, (byFunction.get(name) || 0) + micros);
        if (!['(idle)', '(program)', '(root)'].includes(name)) activeMicros += micros;
      }
      t.diagnostic(JSON.stringify({ localSampledJsActiveCpuMsPerReport: activeMicros / 1000 / samples.length, requests: samples.length, samplingIntervalMicros: 100, topSampledFunctionsMs: [...byFunction].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, micros]) => ({ name, ms: micros / 1000 })), note: 'Statistical local V8 JS profile excludes idle/program samples and may omit native crypto/runtime work; cannot certify production billed CPU or strict10ms limit.' }));
    }
  } finally {
    await mf?.dispose();
    for (const path of fixturePaths.reverse()) {
      const response = await fetch(`${FIRESTORE}${DOCS}${path}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
      assert.ok(response.ok, `Isolated fixture cleanup ${path}: HTTP ${response.status}`);
    }
    assert.equal((await fetch(`${FIRESTORE}${DOCS}system/authorization`, { headers: { Authorization: 'Bearer owner' } })).status, 404,
      'The isolated registry is removed after the runtime checks.');
    for (const user of [admin, manager, plainUser]) {
      const response = await fetch(`${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:delete?key=fake-api-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: user.unsignedToken }) });
      assert.ok(response.ok, `Isolated Auth fixture cleanup: HTTP ${response.status}`);
    }
  }
});

test('native D1 retries incomplete maintenance without deleting a second raw or rollup chunk', { timeout: 30_000 }, async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true,
    script: 'export default {fetch(){return new Response("fixture")}}', d1Databases: ['RECOVERY_DB'] }));
  try {
    const db = await mf.getD1Database('RECOVERY_DB');
    for (const file of ['0001_analytics.sql', '0005_analytics_report_budget.sql', '0008_analytics_event_budget.sql']) {
      const migration = await readFile('migrations/' + file, 'utf8');
      for (const sql of migration.replace(/--[^\n]*/g, '').trim().split(/(?<=;)\s*(?=(?:CREATE|ALTER|DROP)\b)/i)) await db.prepare(sql).run();
    }
    await db.prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<6000)
      INSERT INTO events(id,day,utc_day,type,has_search)
      SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-'||printf('%012d',n),date('2024-01-01','+'||((n-1)/2000)||' days'),
        date('2024-01-01','+'||((n-1)/2000)||' days'),'search',0 FROM seq`).run();
    await db.prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<6000)
      INSERT INTO daily_metrics(company_id,day,offer_id,impression) SELECT 'fixture','2024-01-01','offer-'||n,1 FROM seq`).run();
    let calls = 0;
    const database: AnalyticsDatabase = { prepare: sql => db.prepare(sql), batch: async statements => {
      // Fail at the end of the first rollup transaction, after its valid deletes execute.
      if (++calls === 2) return db.batch([...statements, db.prepare("INSERT INTO maintenance(day,complete) VALUES('invalid-progress',2)")]);
      return db.batch(statements);
    } };
    const worker = createAnalyticsWorker({ now: () => new Date('2026-10-10T04:00:00Z') });
    const env = { FIREBASE_PROJECT_ID: 'demo-maintenance-recovery', ANALYTICS_DB: database };
    const pending: Promise<unknown>[] = [], context = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) };
    const count = async (table: 'events' | 'daily_metrics') => (await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>())!.count;
    await worker.scheduled(undefined, env, context);
    await assert.rejects(Promise.all(pending.splice(0)), /CHECK/);
    assert.equal(await count('events'), 2000, 'The raw-delete transaction committed its one bounded chunk.');
    assert.equal(await count('daily_metrics'), 6000, 'The failed rollup batch rolls back every deletion.');
    assert.equal((await db.prepare("SELECT complete FROM maintenance WHERE day='2026-10-10'").first<{ complete: number }>())!.complete, 0);
    // At-least-once Queue delivery can dispatch both retries at the same time.
    await Promise.all([worker.scheduled(undefined, env, context), worker.scheduled(undefined, env, context)]);
    await Promise.all(pending.splice(0));
    assert.equal(await count('events'), 2000, 'Retries never repeat the committed raw deletion.');
    assert.equal(await count('daily_metrics'), 2000, 'Concurrent retries commit only one rollup chunk.');
    assert.equal((await db.prepare("SELECT complete FROM maintenance WHERE day='2026-10-10'").first<{ complete: number }>())!.complete, 1);
  } finally { await mf.dispose(); }
});

test('native D1 analytics writes fit the reduced intake cap while draining the full historical cleanup chunk', { timeout: 30_000 }, async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true,
    script: 'export default {fetch(){return new Response("fixture")}}', d1Databases: ['BUDGET_DB'] }));
  try {
    const db = await mf.getD1Database('BUDGET_DB');
    const migrate = async (file: string) => {
      const migration = await readFile('migrations/' + file, 'utf8');
      for (const sql of migration.replace(/--[^\n]*/g, '').trim().split(/(?<=;)\s*(?=(?:CREATE|ALTER|DROP)\b)/i)) await db.prepare(sql).run();
    };
    await migrate('0001_analytics.sql'); await migrate('0005_analytics_report_budget.sql');
    const types = ['all', 'PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'PLA-CF', 'PETG-CF', 'PA-CF', 'PVA', 'HIPS', 'other'];
    const material = types.map((type, index) => `WHEN ${index} THEN '${type}'`).join(' ');
    const insert = (amount: number, prefix: string, day: string) => db.prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<?)
      INSERT INTO events(id,day,utc_day,type,company_id,offer_id,material_type,packaging,stock,has_search)
      SELECT ?||printf('%012d',n),?,?,'impression',?||n,?||n,CASE (n-1)%14 ${material} END,
        CASE ((n-1)/14)%3 WHEN 0 THEN 'all' WHEN 1 THEN 'spool' ELSE 'refill' END,
        CASE ((n-1)/42)%3 WHEN 0 THEN 'all' WHEN 1 THEN 'in_stock' ELSE 'out_of_stock' END,((n-1)/126)%2 FROM seq`)
      .bind(amount, prefix === 'legacy-' ? 'aaaaaaaa-aaaa-4aaa-8aaa-' : 'bbbbbbbb-bbbb-4bbb-8bbb-', day, day, prefix, prefix).run();
    // This represents 4000/day data written before the new trigger migration.
    await insert(4000, 'legacy-', '2024-01-01');
    await db.prepare("INSERT INTO maintenance(day) VALUES('2024-01-01')").run();
    await db.prepare("INSERT INTO analytics_report_budget(day,checks,reserved_reads) VALUES('2024-01-01',1500,1000000)").run();
    await migrate('0008_analytics_event_budget.sql');
    let freshWrites = 0;
    for (let offset = 0; offset < 2000; offset += 20) {
      const results = await db.batch(Array.from({ length: 20 }, (_, batchIndex) => {
        const index = offset + batchIndex;
        return db.prepare('INSERT INTO events(id,day,utc_day,type,company_id,offer_id,material_type,packaging,stock,has_search) VALUES(?,?,?,?,?,?,?,?,?,?)')
          .bind('bbbbbbbb-bbbb-4bbb-8bbb-' + String(index + 1).padStart(12, '0'), '2026-10-10', '2026-10-10', 'impression', 'fresh-' + index, 'fresh-' + index,
            types[index % 14], ['all', 'spool', 'refill'][Math.floor(index / 14) % 3], ['all', 'in_stock', 'out_of_stock'][Math.floor(index / 42) % 3], Math.floor(index / 126) % 2);
      }));
      for (const result of results) freshWrites += result.meta.rows_written;
    }
    assert.equal((await db.prepare("SELECT accepted FROM day_budget WHERE day='2026-10-10'").first<{ accepted: number }>())!.accepted, 2000);
    const rejected = await db.prepare("INSERT INTO events(id,day,utc_day,type,has_search) VALUES('cccccccc-cccc-4ccc-8ccc-000000000001','2026-10-10','2026-10-10','search',0)").run();
    assert.equal(rejected.meta.changes, 0); assert.equal(rejected.meta.rows_written, 0, 'The SQL trigger rejects intake after2000 regardless of Worker prechecks.');
    const reserve = () => db.prepare('INSERT INTO day_budget(day,accepted,ingest_checks) VALUES(?,0,1) ON CONFLICT(day) DO UPDATE SET ingest_checks=ingest_checks+1 WHERE ingest_checks<? RETURNING accepted').bind('2026-10-10', 4000);
    let checkWrites = 0;
    for (let offset = 0; offset < 3999; offset += 100) {
      const results = await db.batch(Array.from({ length: Math.min(100, 3999 - offset) }, reserve));
      for (const result of results) { assert.equal(result.results.length, 1); checkWrites += result.meta.rows_written; }
    }
    let cleanupWrites = 0;
    const dedupReads: number[] = [], exhaustedCheckReads: number[] = [];
    let phase: 'ingest' | 'cleanup' = 'ingest';
    const native = new WeakMap<object, any>();
    const wrap = (sql: string, statement: any): ReturnType<AnalyticsDatabase['prepare']> => {
      const wrapped = { bind(...values: (string | number | null)[]) { return wrap(sql, statement.bind(...values)); }, first: <T>() => statement.first() as Promise<T | null>,
        all: async () => {
          const result = await statement.all();
          if (phase === 'ingest') {
            checkWrites += result.meta.rows_written;
            if (sql.startsWith('SELECT id FROM events')) dedupReads.push(result.meta.rows_read);
            else if (!result.results.length) exhaustedCheckReads.push(result.meta.rows_read);
          }
          return result;
        } };
      native.set(wrapped, statement); return wrapped;
    };
    const database: AnalyticsDatabase = { prepare: sql => wrap(sql, db.prepare(sql)), batch: async statements => {
      const results = await db.batch(statements.map(statement => native.get(statement)));
      for (const result of results) cleanupWrites += result.meta.rows_written;
      return results;
    } };
    const worker = createAnalyticsWorker({ now: () => new Date('2026-10-10T04:00:00Z') });
    const pending: Promise<unknown>[] = [];
    const env = { FIREBASE_PROJECT_ID: 'demo-budget', ANALYTICS_DB: database, ANALYTICS_RATE_LIMIT: { limit: async () => ({ success: true }) } };
    const context = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) };
    const post = () => worker.fetch(new Request(ORIGIN + '/api/analytics/events', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: Array.from({ length: 20 }, (_, index) => ({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-' + String(index + 1).padStart(12, '0'), type: 'search' })) }) }), env, context);
    const races = await Promise.all([post(), post()]);
    assert.deepEqual(races.map(response => response.status).sort(), [200, 429], 'Only one of the two concurrent final ingest checks may succeed.');
    assert.equal(races.find(response => response.status === 429)!.headers.get('Retry-After'), '72000');
    assert.deepEqual(dedupReads, [40], 'Only the winning request reads the20 existing event IDs.');
    assert.deepEqual(exhaustedCheckReads, [1], 'The rejected request reads only its quota row, never dedup events.');
    assert.equal((await post()).status, 429);
    assert.deepEqual(dedupReads, [40], 'Further exhausted attempts never run a dedup query.');
    assert.deepEqual(exhaustedCheckReads, [1, 1]);
    assert.equal((await db.prepare("SELECT ingest_checks FROM day_budget WHERE day='2026-10-10'").first<{ ingest_checks: number }>())!.ingest_checks, 4000);
    phase = 'cleanup';
    await worker.scheduled(undefined, env, context);
    await Promise.all(pending);
    assert.ok(freshWrites <= 22_254);
    assert.equal(cleanupWrites, 16_258);
    assert.equal(checkWrites, 4000);
    const maximumAnalyticsWrites = freshWrites + checkWrites + cleanupWrites;
    assert.ok(maximumAnalyticsWrites <= 58_765);
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM events WHERE utc_day='2024-01-01'").first<{ count: number }>())!.count, 0, 'All4000 legacy events are drained despite the lower intake quota.');
    t.diagnostic(JSON.stringify({ dailyAcceptedEventLimit: 2000, dailyIngestAttemptLimit: 4000, ingestCheckWrites: checkWrites, dedupReads, exhaustedCheckReads, freshDistinctCompanyOfferWrites: freshWrites,
      historicalCleanupSourceEvents: 4000, maximumCleanupWrites: cleanupWrites, maximumCombinedAnalyticsWrites: maximumAnalyticsWrites,
      conservativeAnalyticsWriteBound: 58765, note: 'Native trigger/index writes for2000 distinct company/offer events and252 canonical filter groups,4000 attempt markers, plus legacy4000 raw/metrics,4001 totals,4252 filters, expired budget markers and completed maintenance. Other API/report/Queue budgets must fit the remaining41235 writes.' }));
  } finally { await mf.dispose(); }
});
