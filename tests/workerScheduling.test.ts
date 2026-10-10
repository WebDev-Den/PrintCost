import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import worker from '../workers/index.ts';
import { createImportFirebase } from '../workers/importFirebase.ts';
import { IMPORT_LIMITS } from '../src/domain/apiImports.ts';
import type { AnalyticsDatabase } from '../workers/analytics.ts';

function fixture() {
  const sqlite = new DatabaseSync(':memory:'), queries: string[] = [], sent: unknown[] = [];
  for (const file of ['0001_analytics.sql', '0002_import_api.sql', '0003_import_access_limits.sql', '0004_import_result_counts.sql',
    '0005_analytics_report_budget.sql', '0006_firebase_token_broker.sql', '0007_maintenance_budget.sql', '0008_analytics_event_budget.sql', '0009_import_cleanup_budget.sql']) {
    sqlite.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  }
  const database: AnalyticsDatabase = {
    prepare(sql) {
      let values: (string | number | null)[] = [];
      return {
        bind(...parameters) { values = parameters as typeof values; return this; },
        async all<T>() { queries.push(sql); return { results: sqlite.prepare(sql).all(...values) as T[], meta: { changes: 1 }, success: true }; },
        async first<T>() { queries.push(sql); return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
      };
    },
    batch<T>(statements: ReturnType<AnalyticsDatabase['prepare']>[]) { return Promise.all(statements.map(statement => statement.all<T>())); },
  };
  const env = { ANALYTICS_DB: database, FIREBASE_PROJECT_ID: 'demo-scheduling-' + randomUUID().slice(0, 8),
    IMPORT_QUEUE: { async send(body: unknown) { sent.push(body); } } };
  const context = { waitUntil() { assert.fail('Cron must await only its bounded producer work.'); } };
  return { sqlite, queries, sent, env, context };
}

test('known crons reserve bounded maintenance messages; cleanup and unknown crons never run inline', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  for (const cron of ['0 2 * * *', '*/5 * * * *', 'unknown']) await worker.scheduled({ cron }, f.env, f.context);
  assert.deepEqual(f.sent, [{ maintenance: 'analytics' }, { maintenance: 'imports' }]);
  assert.equal(f.queries.length, 2);
  assert.ok(f.queries.every(sql => sql.startsWith('INSERT INTO import_daily(day,maintenance_dispatches)')));
  assert.equal(f.sqlite.prepare('SELECT maintenance_dispatches FROM import_daily').get()!.maintenance_dispatches, 2);
  assert.ok((IMPORT_LIMITS.dailyQueueMessages + IMPORT_LIMITS.dailyMaintenanceMessages) * 11 <= 10000,
    'The Free reserve covers writes, four deliveries/deletion and prior 24-hour carryover.');
});

test('maintenance producer reserves one concurrent last slot and starts a fresh UTC day without erasing budgets', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const day = new Date().toISOString().slice(0, 10), prior = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  f.sqlite.prepare('INSERT INTO import_daily(day,maintenance_dispatches,items,dispatches) VALUES(?,?,17,9),(?,?,18,10)')
    .run(prior, 300, day, 299);
  await Promise.all(Array.from({ length: 10 }, () => worker.scheduled({ cron: '*/5 * * * *' }, f.env, f.context)));
  assert.equal(f.sent.length, 1);
  assert.equal(f.sqlite.prepare('SELECT maintenance_dispatches FROM import_daily WHERE day=?').get(day)!.maintenance_dispatches, 300);
  await worker.scheduled({ cron: '0 2 * * *' }, f.env, f.context);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sqlite.prepare('SELECT maintenance_dispatches FROM import_daily WHERE day=?').get(prior)!.maintenance_dispatches, 300);
  f.sqlite.prepare('DELETE FROM import_daily WHERE day=?').run(day);
  await worker.scheduled({ cron: '*/5 * * * *' }, f.env, f.context);
  assert.equal(f.sent.length, 2);
  assert.equal(f.sqlite.prepare('SELECT maintenance_dispatches FROM import_daily WHERE day=?').get(day)!.maintenance_dispatches, 1);
  assert.deepEqual({ ...f.sqlite.prepare('SELECT items,dispatches FROM import_daily WHERE day=?').get(prior) }, { items: 17, dispatches: 9 });
});

test('failed maintenance sends keep their reserved slot, while missing bindings fail visibly', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const broken = { ...f.env, IMPORT_QUEUE: { async send() { throw new Error('Fixture queue unavailable'); } } };
  await assert.rejects(worker.scheduled({ cron: '*/5 * * * *' }, broken, f.context));
  assert.equal(f.sqlite.prepare('SELECT maintenance_dispatches FROM import_daily').get()!.maintenance_dispatches, 1);
  await assert.rejects(worker.scheduled({ cron: '0 2 * * *' }, { FIREBASE_PROJECT_ID: f.env.FIREBASE_PROJECT_ID }, f.context));
});

test('Queue maintenance awaits broker and cleanup completion; malformed types never fall through to imports', async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  let signatures = 0;
  const sign = crypto.subtle.sign.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'sign', async (...args: Parameters<typeof sign>) => { signatures++; return sign(...args); });
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const secret = JSON.stringify({ project_id: f.env.FIREBASE_PROJECT_ID, client_email: 'import@' + f.env.FIREBASE_PROJECT_ID + '.iam.gserviceaccount.com',
    private_key: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  await createImportFirebase(async () => Response.json({ access_token: 'fixture-service-token', expires_in: 3600 }))
    .refreshCredentials(f.env.FIREBASE_PROJECT_ID, secret, f.env.ANALYTICS_DB);
  f.queries.length = 0;
  let acks = 0, retries = 0;
  const message = (body: unknown) => ({ body, ack() { acks++; }, retry() { retries++; } });
  await worker.queue({ messages: [message({ maintenance: 'imports' })] }, { ...f.env, FIREBASE_IMPORT_SERVICE_ACCOUNT: secret });
  assert.equal(acks, 1); assert.equal(retries, 0);
  assert.ok(f.queries.some(sql => sql.includes('import_jobs')));
  await worker.queue({ messages: [message({ maintenance: 'imports' })] }, { ...f.env, FIREBASE_IMPORT_SERVICE_ACCOUNT: secret });
  assert.equal(acks, 2); assert.equal(retries, 0);
  assert.equal(signatures, 1, 'Repeated maintenance before the five-minute refresh threshold performs no new RSA/OAuth exchange.');
  f.queries.length = 0;
  await worker.queue({ messages: [message({ maintenance: 'analytics' })] }, f.env);
  assert.equal(acks, 3); assert.equal(retries, 0);
  assert.ok(f.queries.some(sql => sql.includes('DELETE FROM events')), 'Ack follows actual analytics cleanup.');
  f.queries.length = 0;
  for (const body of [{ maintenance: 'unknown' }, { maintenance: ['imports'] }, { maintenance: 'analytics', kind: 'imports' },
    { maintenance: 'unknown', id: randomUUID(), cursor: 0 }]) await worker.queue({ messages: [message(body)] }, f.env);
  assert.equal(acks, 7); assert.equal(retries, 0); assert.equal(f.queries.length, 0);
});

test('temporary Queue maintenance failures retry after 60 seconds without acknowledging unfinished cleanup', async () => {
  const env = { FIREBASE_PROJECT_ID: 'demo-scheduling-broken', FIREBASE_IMPORT_SERVICE_ACCOUNT: 'fixture-invalid-secret',
    IMPORT_QUEUE: { async send() {} }, ANALYTICS_DB: { prepare() { throw new Error('Fixture D1 unavailable'); }, async batch() { throw new Error(); } } };
  let acks = 0;
  const retries: number[] = [];
  for (const maintenance of ['imports', 'analytics']) await worker.queue({ messages: [{ body: { maintenance }, ack() { acks++; },
    retry(options) { retries.push(options?.delaySeconds || 0); } }] }, env);
  assert.equal(acks, 0); assert.deepEqual(retries, [60, 60]);
});
