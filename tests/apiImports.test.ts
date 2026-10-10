import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { IMPORT_EXAMPLE, IMPORT_LIMITS, importDomain, normalizeImportPayload, profileForImport, validateImportEnvelope } from '../src/domain/apiImports.ts';
import { createImportApi } from '../workers/importApi.ts';

test('declared oversized import POSTs stop before authorization or any D1/Firebase work', async () => {
  let databaseCalls = 0, firebaseCalls = 0;
  const api = createImportApi(async () => { firebaseCalls++; throw new Error('Must not contact Firebase.'); });
  const env = { FIREBASE_PROJECT_ID: 'demo-import-size', FIREBASE_IMPORT_SERVICE_ACCOUNT: 'fixture', IMPORT_QUEUE: { async send() {} },
    ANALYTICS_DB: { prepare() { databaseCalls++; throw new Error('Must not contact D1.'); }, async batch() { databaseCalls++; throw new Error('Must not contact D1.'); } } };
  const oversized = await api.fetch(new Request('https://import.invalid/api/v1/imports', { method: 'POST',
    headers: { Authorization: 'Bearer kg_api_' + 'x'.repeat(43), 'Content-Type': 'application/json', 'Content-Length': String(IMPORT_LIMITS.bytes + 1) }, body: '{}' }), env);
  assert.equal(oversized.status, 413);
  assert.equal(databaseCalls, 0); assert.equal(firebaseCalls, 0);
  for (const [path, method, status] of [['imports','GET',401], ['api-key','POST',401], ['unknown','POST',404]] as const) {
    const response = await api.fetch(new Request('https://import.invalid/api/v1/' + path, { method,
      headers: { 'Content-Length': String(IMPORT_LIMITS.bytes + 1) } }), env);
    assert.equal(response.status, status, 'The early body guard applies only to import submission.');
  }
});

test('HTTP envelope validation bounds the whole request without validating individual records', () => {
  const offers = Array.from({ length: IMPORT_LIMITS.items }, (_, index) => ({ ...IMPORT_EXAMPLE.offers[0], externalId: String(index) }));
  offers[99].priceUah = 600.333;
  assert.deepEqual(validateImportEnvelope({ offers }), { companies: [], offers });
  assert.throws(() => normalizeImportPayload({ offers }), /Ціна/);
  assert.deepEqual(validateImportEnvelope({ companies: [null] }), { companies: [null], offers: [] });
  assert.deepEqual(validateImportEnvelope({ companies: null, offers: [null] }), { companies: [], offers: [null] });
  for (const value of [null, [], 'JSON', {}, { offers: [] }, { offers: {} }, { companies: {}, offers: [null] },
    { companies: [null], offers, }, { offers: [null], uid: 'other' }]) assert.throws(() => validateImportEnvelope(value));
});

test('import normalizes offers, derives profiles and never invents an unknown material profile', () => {
  const payload = normalizeImportPayload(IMPORT_EXAMPLE);
  assert.equal(payload.offers[0].offer.family, 'Стандартні');
  assert.equal(payload.offers[0].offer.type, 'PLA');
  assert.equal(payload.offers[0].offer.status, 'hidden');
  assert.equal(profileForImport(' petg ')?.nozzleRange, '225–250 °C');
  assert.equal(profileForImport('PA12'), undefined);
  assert.equal(normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], type: 'PA12' }] }).offers[0].familyExplicit, false);
  assert.equal(normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], type: 'PA12', family: 'Інженерні' }] }).offers[0].offer.family, 'Інженерні');
});
test('import retains explicit moderation intent for the transactional writer without inventing publication', () => {
  const omitted = normalizeImportPayload(IMPORT_EXAMPLE).offers[0];
  assert.equal(omitted.offer.status, 'hidden');
  assert.ok(!omitted.optionalFields.includes('status'));
  for (const status of ['published', 'hidden', 'blocked'] as const) {
    const explicit = normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], status }] }).offers[0];
    assert.equal(explicit.offer.status, status);
    assert.ok(explicit.optionalFields.includes('status'));
  }
  assert.throws(() => normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], status: 'unknown' }] }));
});
test('import rejects unknown fields, ownership forgery, duplicates, unsafe URLs and unbounded batches', () => {
  assert.throws(() => normalizeImportPayload({ ...IMPORT_EXAMPLE, uid: 'other' }));
  assert.throws(() => normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], createdBy: 'other' }] }));
  assert.throws(() => normalizeImportPayload({ offers: [IMPORT_EXAMPLE.offers[0], IMPORT_EXAMPLE.offers[0]] }));
  assert.throws(() => normalizeImportPayload({ offers: Array.from({ length: IMPORT_LIMITS.items + 1 }, (_, index) => ({ ...IMPORT_EXAMPLE.offers[0], externalId: String(index) })) }));
  for (const productUrl of ['http://shop.example.com/a', 'https://shop.example.com:443/a', 'https://user@shop.example.com/a', 'https://127.0.0.1/a']) {
    assert.throws(() => normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], productUrl }] }));
  }
  assert.equal(importDomain('https://SHOP.EXAMPLE.COM/item'), 'shop.example.com');
  assert.throws(() => normalizeImportPayload({ companies: [{ website: 'https://shop.example.com/', allowedDomains: ['evil.example.com'] }] }));
});
test('company JSON preserves omitted fields for later admin completion', () => {
  assert.deepEqual(normalizeImportPayload({ companies: [{ website: 'https://shop.example.com' }] }).companies,
    [{ website: 'https://shop.example.com/' }]);
  assert.equal(normalizeImportPayload({ companies: [{ website: 'https://shop.example.com', name: ' Seller ', status: 'disabled' }] }).companies[0].name, 'Seller');
});

test('import count migration backfills legacy results and atomically maintains every result writer', t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  for (const file of ['0002_import_api.sql', '0003_import_access_limits.sql']) {
    db.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  }
  const time = 1_700_000_000;
  function seed(id: string, results: unknown[]) {
    db.prepare('INSERT INTO import_keys(uid,hash,prefix,role,fingerprint,valid_since,created_at,expires_at) VALUES(?,?,?,\'admin\',\'current\',0,?,?)')
      .run(id, id, id, time, time + 86400);
    db.prepare('INSERT INTO import_jobs(id,owner_uid,key_hash,fingerprint,idempotency,payload_hash,status,total,cursor,results,interval_seconds,created_at,updated_at,expires_at) VALUES(?,?,?,\'current\',?,\'hash\',\'completed\',?,?,?,?,?,?,?)')
      .run(id, id, id, id, Math.max(1, results.length), results.length, JSON.stringify(results), 300, time, time, time + 86400);
  }
  seed('legacy-empty', []);
  seed('legacy-full', Array.from({ length: 100 }, (_, index) => ({ success: index < 37 })));
  seed('legacy-missing', [{ success: true }, { success: false }, {}, { success: null }]);
  db.exec(readFileSync(new URL('../migrations/0004_import_result_counts.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0007_maintenance_budget.sql', import.meta.url), 'utf8'));
  const counts = (id: string) => ({ ...db.prepare('SELECT succeeded,failed FROM import_jobs WHERE id=?').get(id) });
  assert.deepEqual(counts('legacy-empty'), { succeeded: 0, failed: 0 });
  assert.deepEqual(counts('legacy-full'), { succeeded: 37, failed: 63 });
  assert.deepEqual(counts('legacy-missing'), { succeeded: 1, failed: 3 });
  seed('inserted-full', [{ success: false }, { success: true }]);
  assert.deepEqual(counts('inserted-full'), { succeeded: 1, failed: 1 }, 'Nonempty fixture/legacy INSERTs update the same counters.');
  const results = JSON.stringify([{ success: true }, { success: true }, { success: false }]);
  db.prepare('UPDATE import_jobs SET results=?,cursor=3,status=\'partial\' WHERE id=?').run(results, 'inserted-full');
  assert.deepEqual(counts('inserted-full'), { succeeded: 2, failed: 1 });
  const before = db.prepare('SELECT total_changes() AS value').get()!.value as number;
  db.prepare('UPDATE import_jobs SET results=?,status=\'cancelled\' WHERE id=?').run(results, 'inserted-full');
  assert.equal(Number(db.prepare('SELECT total_changes() AS value').get()!.value) - before, 1, 'An identical result array does not repeat its counter write.');
  assert.deepEqual(counts('inserted-full'), { succeeded: 2, failed: 1 }, 'Status-only terminal/cancellation changes preserve counts.');
  db.exec('BEGIN');
  db.prepare('UPDATE import_jobs SET results=\'[]\' WHERE id=?').run('inserted-full');
  assert.deepEqual(counts('inserted-full'), { succeeded: 0, failed: 0 });
  assert.throws(() => db.prepare('UPDATE import_jobs SET total=0 WHERE id=?').run('inserted-full'));
  db.exec('ROLLBACK');
  assert.deepEqual(counts('inserted-full'), { succeeded: 2, failed: 1 }, 'Result arrays and counters roll back in the same transaction.');
  assert.equal(db.prepare('SELECT results FROM import_jobs WHERE id=?').get('inserted-full')!.results, results);
});
