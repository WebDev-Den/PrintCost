import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createImportFirebase, encodeFields } from '../workers/importFirebase.ts';
import type { AnalyticsDatabase } from '../workers/analytics.ts';

test('encrypted service credentials keep RSA/OAuth out of cold HTTP, preserve fresh access and fail closed', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('../migrations/0006_firebase_token_broker.sql', import.meta.url), 'utf8'));
  const prepare = (sql: string, values: (string | number | null)[] = []) => ({
    bind: (...bound: (string | number | null)[]) => prepare(sql, bound),
    async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[], meta: {}, success: true }; },
    async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
  });
  const database: AnalyticsDatabase = { prepare, async batch<T>(statements: ReturnType<AnalyticsDatabase['prepare']>[]) { return Promise.all(statements.map(statement => statement.all<T>())); } };
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const project = 'demo-kilog', uid = 'broker-admin';
  const account = { project_id: project, client_email: 'import@demo-kilog.iam.gserviceaccount.com',
    private_key: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
  const secret = JSON.stringify(account), rotatedSecret = JSON.stringify({ ...account, private_key_id: 'rotated-fixture' });
  let clock = 1_790_000_000_000, oauth = 0, signatures = 0, authReads = 0, scopeReads = 0, disabled = false, blocked = false;
  const sign = crypto.subtle.sign.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'sign', async (...args: Parameters<typeof sign>) => { signatures++; return sign(...args); });
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      oauth++; return Response.json({ access_token: 'private-service-token-' + oauth, expires_in: 3600 });
    }
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) {
      authReads++; return Response.json({ users: [{ localId: uid, emailVerified: true, disabled, validSince: '7' }] });
    }
    assert.ok(url.startsWith('https://firestore.googleapis.com/'));
    assert.equal(url.endsWith(':batchGet'), true);
    scopeReads++;
    const paths = (JSON.parse(init!.body as string).documents as string[]);
    return Response.json(paths.map(name => name.endsWith('system/authorization') ? { found: { name, fields: encodeFields({ adminUids: [uid], version: 1 }) } } :
      name.endsWith('accountAccess/' + uid) ? { found: { name, fields: encodeFields({ blocked, changeId: 'live' }) } } : { missing: name }));
  };
  const fresh = () => createImportFirebase(fetcher, () => new Date(clock));
  await assert.rejects(fresh().scope(project, secret, uid, database, false), { status: 503, retryAfter: 60 });
  assert.equal(oauth, 0); assert.equal(signatures, 0, 'An empty broker cannot sign in HTTP.');
  await fresh().refreshCredentials(project, secret, database);
  assert.equal(oauth, 1); assert.equal(signatures, 1);
  await fresh().refreshCredentials(project, secret, database);
  assert.equal(oauth, 1, 'Repeated maintenance reuses valid encrypted credentials.');
  assert.equal(signatures, 1);
  const row = sqlite.prepare('SELECT * FROM firebase_service_tokens').get()!;
  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes('private-service-token') && !serialized.includes('PRIVATE KEY'));
  const publicKey = await crypto.subtle.importKey('raw', Buffer.from(row.fingerprint as string, 'hex'), 'AES-GCM', false, ['decrypt']);
  await assert.rejects(crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(row.nonce as string, 'base64url'),
    additionalData: new TextEncoder().encode(project + '/' + row.fingerprint + '/' + row.expires_at) }, publicKey, Buffer.from(row.ciphertext as string, 'base64url')),
    'The stored public fingerprint cannot decrypt the credential.');
  const http = fresh();
  assert.equal((await http.scope(project, secret, uid, database, false)).role, 'admin');
  blocked = true;
  await assert.rejects(http.scope(project, secret, uid, database, false), { status: 403 });
  blocked = false; disabled = true;
  await assert.rejects(http.scope(project, secret, uid, database, false), { status: 403 });
  disabled = false;
  assert.equal(authReads, 3); assert.equal(scopeReads, 2, 'Cached service tokens do not cache roles or user state.');
  assert.equal(oauth, 1); assert.equal(signatures, 1);
  for (const [column, value] of [['expires_at', Number(row.expires_at) - 1000], ['nonce', 'A'.repeat(16)], ['ciphertext', 'A'.repeat(32)]] as const) {
    sqlite.prepare('UPDATE firebase_service_tokens SET ' + column + '=?').run(value);
    await assert.rejects(fresh().scope(project, secret, uid, database, false), { status: 503 });
    sqlite.prepare('UPDATE firebase_service_tokens SET nonce=?,ciphertext=?,expires_at=?').run(row.nonce, row.ciphertext, row.expires_at);
  }
  assert.equal(oauth, 1, 'Tampering cannot trigger HTTP OAuth fallback.');
  await assert.rejects(fresh().scope(project, rotatedSecret, uid, database, false), { status: 503 });
  await fresh().refreshCredentials(project, rotatedSecret, database);
  assert.equal(oauth, 2); assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM firebase_service_tokens').get()!.count, 2);
  await fresh().refreshCredentials(project, secret, database);
  assert.equal(oauth, 2, 'An old secret cannot overwrite a new secret generation.');
  assert.equal((await fresh().scope(project, rotatedSecret, uid, database, false)).validSince, 7);
  clock += 3_600_000;
  await assert.rejects(fresh().scope(project, rotatedSecret, uid, database, false), { status: 503 });
  assert.equal(oauth, 2);
  await fresh().refreshCredentials(project, rotatedSecret, database);
  assert.equal(oauth, 3);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM firebase_service_tokens').get()!.count, 1, 'Expired generations are removed by the Queue refresh.');
  assert.equal((await fresh().scope(project, rotatedSecret, uid, database, false)).role, 'admin');
});
