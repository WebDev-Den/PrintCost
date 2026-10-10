import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare';
import { IMPORT_EXAMPLE, IMPORT_LIMITS, normalizeImportPayload } from '../src/domain/apiImports.ts';
import { encodeFields } from '../workers/importFirebase.ts';
import { decodeFields } from '../workers/firebase.ts';
import { createImportApi } from '../workers/importApi.ts';

test('real Worker/D1/Queues imports: keys, concurrent throttling, ownership and retry recovery', { timeout: 120_000 }, async t => {
  const project = 'demo-import-api-' + randomUUID().slice(0, 8);
  const root = '/v1/projects/' + project + '/databases/(default)/documents';
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const secret = JSON.stringify({ project_id: project, client_email: 'import@' + project + '.iam.gserviceaccount.com',
    private_key: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256', use: 'sig' };
  const users = new Map(['admin', 'manager', 'other-manager', 'user'].map(uid => [uid, { localId: uid, emailVerified: true, validSince: '0', disabled: false }]));
  const seed = async (path: string, data: Record<string, unknown>) => {
    const response = await fetch('http://127.0.0.1:8080' + root + '/' + path, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: encodeFields(data) }) });
    assert.ok(response.ok, 'Fixture HTTP ' + response.status);
  };
  const read = async (path: string) => {
    const response = await fetch('http://127.0.0.1:8080' + root + '/' + path, { headers: { Authorization: 'Bearer owner' } });
    assert.ok(response.ok, 'Fixture read HTTP ' + response.status);
    return decodeFields((await response.json()).fields);
  };
  await seed('system/authorization', { adminUids: ['admin'], version: 1 });
  for (const uid of users.keys()) await seed('accountAccess/' + uid, { blocked: false, changeId: 'initial' });
  const stamp = new Date();
  for (const id of ['company-a', 'company-b']) await seed('companies/' + id, { id, name: id, website: 'https://' + id + '.example.com', allowedDomains: [id + '.example.com'],
    status: 'active', version: 1, createdBy: 'admin', createdAt: stamp, updatedAt: stamp, updatedBy: 'admin', changeId: 'initial' });
  await seed('memberships/manager', { active: true, companyId: 'company-a', changeId: 'initial', version: 1 });
  await seed('memberships/other-manager', { active: true, companyId: 'company-b', changeId: 'initial', version: 1 });
  const bundle = await build({ entryPoints: ['workers/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', metafile: true });
  assert.ok(Object.keys(bundle.metafile.inputs).every(path => !path.includes('node_modules/decimal.js/')), 'Worker validation must keep frontend Decimal initialization out of its bundle.');
  let failCommitOnce = false, failFirebase = false, firebaseRequests = 0, firestoreWrites = 0, oauthRequests = 0, authRequests = 0;
  const transport = async (request: Pick<Request, 'url' | 'method' | 'text'>) => {
      const url = new URL(request.url);
      if (url.hostname === 'www.googleapis.com') return new RuntimeResponse(JSON.stringify({ keys: [jwk] }), { headers: { 'Cache-Control': 'public,max-age=3600' } });
      if (url.hostname === 'oauth2.googleapis.com') {
        oauthRequests++;
        const assertion = new URLSearchParams(await request.text()).get('assertion')!;
        const parts = assertion.split('.');
        assert.ok(verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), pair.publicKey, Buffer.from(parts[2], 'base64url')));
        return new RuntimeResponse(JSON.stringify({ access_token: 'fixture', expires_in: 3600 }));
      }
      if (url.hostname === 'identitytoolkit.googleapis.com') {
        authRequests++;
        const uid = JSON.parse(await request.text()).localId[0];
        return new RuntimeResponse(JSON.stringify({ users: users.has(uid) ? [users.get(uid)] : [] }));
      }
      assert.equal(url.hostname, 'firestore.googleapis.com', 'Fixtures never contact a production endpoint.');
      assert.ok(url.pathname.startsWith(root));
      firebaseRequests++;
      if (url.pathname.endsWith(':commit')) firestoreWrites++;
      if (failFirebase) return new RuntimeResponse('{}', { status: 503 });
      const upstream = await fetch('http://127.0.0.1:8080' + url.pathname + url.search, { method: request.method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
        body: request.method === 'GET' ? undefined : await request.text() });
      if (failCommitOnce && url.pathname.endsWith(':commit') && upstream.ok) { failCommitOnce = false; return new RuntimeResponse('{}', { status: 503 }); }
      return new RuntimeResponse(await upstream.arrayBuffer(), { status: upstream.status, headers: Object.fromEntries(upstream.headers) });
    };
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'import-runtime', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-08',
    bindings: { FIREBASE_PROJECT_ID: project, FIREBASE_IMPORT_SERVICE_ACCOUNT: secret },
    d1Databases: ['ANALYTICS_DB'], queueProducers: { IMPORT_QUEUE: 'imports' },
    queueConsumers: { imports: { maxBatchSize: 1, maxBatchTimeout: 0, maxRetries: 3, retryDelay: 0 } },
    outboundService: transport,
  }));
  t.after(async () => { await mf.dispose(); await fetch('http://127.0.0.1:8080/emulator/v1/projects/' + project + '/databases/(default)/documents', { method: 'DELETE' }); });
  const db = await mf.getD1Database('ANALYTICS_DB');
  for (const file of ['0001_analytics.sql', '0002_import_api.sql', '0003_import_access_limits.sql', '0004_import_result_counts.sql',
    '0005_analytics_report_budget.sql', '0006_firebase_token_broker.sql', '0007_maintenance_budget.sql', '0008_analytics_event_budget.sql', '0009_import_cleanup_budget.sql']) {
    const migration = await readFile('migrations/' + file, 'utf8');
    for (const statement of migration.replace(/--[^\n]*/g, '').trim().split(/(?<=;)\s*(?=(?:CREATE|ALTER|UPDATE|DROP)\b)/i)) await db.prepare(statement).run();
  }
  function jwt(uid: string, stale = false) {
    const time = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({ sub: uid, aud: project, iss: 'https://securetoken.google.com/' + project,
      iat: time, exp: time + 3600, auth_time: stale ? time - 600 : time, email_verified: true })).toString('base64url');
    const input = header + '.' + claims;
    return input + '.' + sign('RSA-SHA256', Buffer.from(input), pair.privateKey).toString('base64url');
  }
  const request = (path: string, token: string, method = 'GET', payload?: unknown, idempotency = randomUUID(), extra: Record<string, string> = {}) =>
    mf.dispatchFetch('https://import-runtime.invalid/api/v1/' + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': idempotency, ...extra },
      body: payload === undefined ? undefined : JSON.stringify(payload) });
  const adminJwt = jwt('admin'), managerJwt = jwt('manager');
  const importFetcher: typeof fetch = async (input, init) => {
    const response = await transport(new Request(String(input), init));
    return new Response(await response.arrayBuffer(), { status: response.status, headers: Object.fromEntries(response.headers) });
  };
  const warming = await request('api-key', adminJwt);
  assert.equal(warming.status, 503); assert.equal(warming.headers.get('Retry-After'), '60');
  assert.equal(oauthRequests, 0, 'Cold HTTP cannot sign or refresh service OAuth credentials.');
  await createImportApi(importFetcher).refreshCredentials({ FIREBASE_PROJECT_ID: project, FIREBASE_IMPORT_SERVICE_ACCOUNT: secret, ANALYTICS_DB: db,
    IMPORT_QUEUE: { async send() {} } });
  assert.equal(oauthRequests, 1);
  assert.equal((await request('api-key', jwt('user'))).status, 403);
  assert.equal((await request('api-key', jwt('admin', true), 'POST')).status, 401);
  assert.equal((await request('api-key', adminJwt, 'GET', undefined, randomUUID(), { Origin: 'https://evil.invalid' })).status, 403);
  const adminKey = (await (await request('api-key', adminJwt, 'POST')).json() as any).key;
  let managerKey = (await (await request('api-key', managerJwt, 'POST')).json() as any).key;
  const otherKey = (await (await request('api-key', jwt('other-manager'), 'POST')).json() as any).key;
  assert.match(adminKey, /^kg_api_[\w-]{43}$/);
  assert.ok(!JSON.stringify(await (await request('api-key', adminJwt)).json()).includes(adminKey));
  assert.ok(!(await db.prepare('SELECT * FROM import_keys').all()).results.some((row: Record<string, unknown>) => JSON.stringify(row).includes(managerKey)));
  assert.equal((await request('api-key', adminKey)).status, 401);
  const managerPayload = { offers: Array.from({ length: 12 }, (_, index) => ({ ...IMPORT_EXAMPLE.offers[0], externalId: 'p-' + index,
    status: 'published', productUrl: 'https://company-a.example.com/p-' + index })) };
  const idempotency = randomUUID();
  failCommitOnce = true;
  const accepted = await request('imports', managerKey, 'POST', managerPayload, idempotency);
  assert.equal(accepted.status, 202, JSON.stringify(await accepted.clone().json()));
  const job = await accepted.json() as any;
  assert.equal(job.total, 12); assert.equal(job.processed, 0); assert.equal(job.succeeded, 0); assert.equal(job.failed, 0);
  assert.match((await db.prepare('SELECT payload_hash FROM import_jobs WHERE id=?').bind(job.id).first<any>()).payload_hash, /^raw:[0-9a-f]{64}$/);
  async function waitJob(id: string, token: string) {
    for (let i = 0; i < 80; i++) {
      const result = await (await request('imports/' + id, token)).json() as any;
      if (['completed','partial','failed','cancelled'].includes(result.status)) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Queue did not finish.');
  }
  // Production retries use a 60-second delay. Advance the queue locally via its durable outbox.
  for (let i = 0; i < 80; i++) {
    const row = await db.prepare('SELECT * FROM import_jobs WHERE id=?').bind(job.id).first<any>();
    if (row.attempts > 0 && row.lease_until === 0) {
      await db.prepare('UPDATE import_jobs SET dispatch_at=0 WHERE id=?').bind(job.id).run();
      const worker = await mf.getWorker() as unknown as { scheduled(event: { cron: string }): Promise<unknown> };
      await worker.scheduled({ cron: '*/5 * * * *' }); break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const completed = await waitJob(job.id, managerKey);
  assert.equal(completed.status, 'completed', JSON.stringify(completed));
  assert.equal(completed.succeeded, 12);
  assert.equal((await read('companyOffers/' + completed.results[0].offerId)).version, 1, 'ambiguous commit and redelivery did not duplicate writes');
  for (const result of completed.results) {
    assert.equal((await read('companyOffers/' + result.offerId)).status, 'hidden', 'HTTP publication flags cannot bypass draft review');
  }
  assert.equal((await request('imports/' + job.id, otherKey)).status, 404);
  assert.equal((await request('imports/' + job.id, adminKey)).status, 200);
  assert.equal((await request('imports', managerKey, 'POST', managerPayload, idempotency)).status, 202);
  assert.equal((await request('imports', managerKey, 'POST', IMPORT_EXAMPLE, idempotency)).status, 409);
  assert.equal((await request('imports', managerKey, 'POST', { companies: [{ website: 'https://other.example.com' }] })).status, 403);
  const parallel = await Promise.all(Array.from({ length: 10 }, () => request('imports', managerKey, 'POST', managerPayload)));
  assert.ok(parallel.every(response => response.status === 429), 'owner cooldown remains enforced under concurrent requests');
  assert.ok(Number(parallel[0].headers.get('Retry-After')) > 3000);
  const cooldown = await db.prepare('SELECT next_allowed FROM import_limits WHERE uid=?').bind('manager').first<any>();
  assert.equal(cooldown.next_allowed - Date.parse(job.createdAt) / 1000, IMPORT_LIMITS.managerInterval);
  const oldKey = managerKey;
  managerKey = (await (await request('api-key', managerJwt, 'POST')).json() as any).key;
  assert.equal((await request('imports', oldKey)).status, 401);
  assert.equal((await request('imports', managerKey, 'POST', managerPayload)).status, 429, 'rotating keys cannot reset cooldown');
  await db.prepare('UPDATE import_limits SET next_allowed=0 WHERE uid=?').bind('manager').run();
  const firstPath = 'companyOffers/' + completed.results[0].offerId;
  await seed(firstPath, { ...await read(firstPath), status: 'published' });
  const managerUpdate = { offers: managerPayload.offers.map(({ status: _status, ...offer }) => ({ ...offer, priceUah: 615 })) };
  const concurrentIds = await Promise.all(Array.from({ length: 6 }, () => request('imports', managerKey, 'POST', managerUpdate)));
  assert.equal(concurrentIds.filter(response => response.status === 202).length, 1, 'atomic trigger reserves only one concurrent import');
  const second = await concurrentIds.find(response => response.status === 202)!.json() as any;
  const updated = await waitJob(second.id, managerKey);
  assert.equal(updated.status, 'completed');
  assert.equal((await read(firstPath)).status, 'hidden', 'a queued update with omitted status returns the offer to drafts');
  assert.equal((await read(firstPath)).priceUah, 615);
  await seed('accountAccess/manager', { blocked: true, changeId: 'blocked' });
  assert.equal((await request('imports', managerKey)).status, 403);
  await seed('accountAccess/manager', { blocked: false, changeId: 'unblocked' });
  assert.equal((await request('imports', managerKey)).status, 403, 'unblocking does not resurrect the old key');
  managerKey = (await (await request('api-key', managerJwt, 'POST')).json() as any).key;
  users.get('manager')!.disabled = true;
  assert.equal((await request('imports', managerKey)).status, 403);
  users.get('manager')!.disabled = false;
  const adminImport = await request('imports', adminKey, 'POST', IMPORT_EXAMPLE);
  assert.equal(adminImport.status, 202);
  await waitJob((await adminImport.json() as any).id, adminKey);
  const adminLimit = await db.prepare('SELECT next_allowed FROM import_limits WHERE uid=?').bind('admin').first<any>();
  const adminCreated = await db.prepare('SELECT created_at FROM import_jobs WHERE owner_uid=? ORDER BY created_at DESC LIMIT 1').bind('admin').first<any>();
  assert.equal(adminLimit.next_allowed - adminCreated.created_at, 300);
  assert.equal((await request('imports', managerKey, 'POST', { offers: Array.from({ length: 101 }, (_, index) => ({ ...IMPORT_EXAMPLE.offers[0], externalId: 'large-' + index })) })).status, 422);
  const huge = await request('imports', managerKey, 'POST', { value: 'x'.repeat(129 * 1024) });
  assert.equal(huge.status, 413);
  await db.prepare('UPDATE import_limits SET next_allowed=0').run();
  failFirebase = true;
  // Initial scope fails closed; no job is reserved when Firebase is unavailable.
  assert.equal((await request('imports', managerKey, 'POST', managerPayload)).status, 503);
  failFirebase = false;
  // Same production handler with an intentionally unavailable producer: D1 remains the durable outbox.
  const manual = createImportApi(importFetcher);
  const environment = { FIREBASE_PROJECT_ID: project, FIREBASE_IMPORT_SERVICE_ACCOUNT: secret, ANALYTICS_DB: db,
    IMPORT_QUEUE: { send: async () => { throw new Error('Fixture queue unavailable'); } } };
  const httpJobRows: Record<string, unknown>[] = [];
  let databaseSize = 0;
  const projectedDb = new Proxy(db, { get(target, property) {
    if (property === 'batch') return async (statements: Parameters<typeof db.batch>[0]) => {
      const results = await target.batch(statements);
      if (databaseSize) for (const result of results) result.meta.size_after = databaseSize;
      return results;
    };
    if (property === 'prepare') return (sql: string) => {
      const statement = target.prepare(sql);
      if (!sql.includes('import_jobs')) return statement;
      const watch = (prepared: typeof statement): typeof statement => new Proxy(prepared, { get(current, method) {
        if (method === 'bind') return (...values: Parameters<typeof statement.bind>) => watch(current.bind(...values));
        if (method === 'first' || method === 'all') return async () => {
          const result = method === 'first' ? await current.first() : await current.all();
          const rows = method === 'first' ? result ? [result] : [] : (result as { results: Record<string, unknown>[] }).results;
          for (const row of rows as Record<string, unknown>[]) {
            assert.ok(!Object.hasOwn(row, 'payload') && !Object.hasOwn(row, 'key_hash') && !Object.hasOwn(row, 'fingerprint'),
              'HTTP job reads/INSERT RETURNING must not transfer payloads or private authorization fields from D1.');
            httpJobRows.push(row);
          }
          return result;
        };
        const value = Reflect.get(current, method, current);
        return typeof value === 'function' ? value.bind(current) : value;
      } });
      return watch(statement);
    };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const httpEnvironment = { ...environment, ANALYTICS_DB: projectedDb };
  const submitRaw = (body: string, idempotency: string) => manual.fetch(new Request('https://import-runtime.invalid/api/v1/imports', {
    method: 'POST', headers: { Authorization: 'Bearer ' + adminKey, 'Content-Type': 'application/json', 'Idempotency-Key': idempotency }, body,
  }), httpEnvironment);
  const runManually = async (id: string) => {
    let acknowledgements = 0, retries = 0;
    await manual.queue({ messages: [{ body: { id, cursor: 0 }, ack: () => { acknowledgements++; }, retry: () => { retries++; } }] }, environment);
    assert.equal(acknowledgements, 1); assert.equal(retries, 0);
  };
  const detailManually = async (id: string) => {
    const response = await manual.fetch(new Request('https://import-runtime.invalid/api/v1/imports/' + id, { headers: { Authorization: 'Bearer ' + adminKey } }), httpEnvironment);
    assert.equal(response.status, 200); return await response.json() as any;
  };
  await t.test('storage backpressure rejects only new jobs, preserving metadata, history, details and retries', async () => {
    const before = (await db.prepare('SELECT COUNT(*) AS count FROM import_jobs').first<any>()).count;
    databaseSize = 450 * 1024 * 1024;
    const body = '{"offers":[null]}';
    try {
      const denied = await submitRaw(body, randomUUID());
      assert.equal(denied.status, 429); assert.equal(denied.headers.get('Retry-After'), '3600');
      assert.match((await denied.json() as any).error.message, /очікує очищення/);
      assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM import_jobs').first<any>()).count, before);
      const get = (path: string, token: string) => manual.fetch(new Request('https://import-runtime.invalid/api/v1/' + path,
        { headers: { Authorization: 'Bearer ' + token } }), httpEnvironment);
      assert.equal((await get('api-key', adminJwt)).status, 200);
      assert.equal((await get('imports', adminKey)).status, 200);
      assert.equal((await get('imports/' + job.id, adminKey)).status, 200);
      const replay = await manual.fetch(new Request('https://import-runtime.invalid/api/v1/imports', {
        method: 'POST', headers: { Authorization: 'Bearer ' + managerKey, 'Content-Type': 'application/json', 'Idempotency-Key': idempotency },
        body: JSON.stringify(managerPayload),
      }), httpEnvironment);
      assert.equal(replay.status, 202);
      const resumed = await replay.json() as any;
      assert.equal(resumed.id, job.id); assert.equal(resumed.succeeded, 12); assert.equal(resumed.failed, 0);
      const savedKey = await db.prepare('SELECT * FROM import_keys WHERE uid=?').bind('other-manager').first<any>();
      const changeKey = (method: string) => manual.fetch(new Request('https://import-runtime.invalid/api/v1/api-key', {
        method, headers: { Authorization: 'Bearer ' + jwt('other-manager') },
      }), httpEnvironment);
      try {
        assert.equal((await changeKey('POST')).status, 201, 'An existing key can rotate above the storage high-water mark.');
        assert.equal((await changeKey('DELETE')).status, 200, 'Revocation stays available above the storage high-water mark.');
        const deniedKey = await changeKey('POST');
        assert.equal(deniedKey.status, 429); assert.equal(deniedKey.headers.get('Retry-After'), '3600');
        assert.equal(await db.prepare('SELECT uid FROM import_keys WHERE uid=?').bind('other-manager').first(), null);
      } finally {
        await db.prepare('INSERT OR REPLACE INTO import_keys(uid,hash,prefix,role,company_id,fingerprint,valid_since,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .bind(savedKey.uid,savedKey.hash,savedKey.prefix,savedKey.role,savedKey.company_id,savedKey.fingerprint,savedKey.valid_since,savedKey.created_at,savedKey.expires_at).run();
      }
      databaseSize--;
      const accepted = await submitRaw(body, randomUUID());
      assert.equal(accepted.status, 202, 'The boundary below 450 MiB continues accepting jobs.');
      await runManually((await accepted.json() as any).id);
    } finally { databaseSize = 0; }
  });
  await t.test('100-record late validation failure is accepted then failed without writes or retries', async () => {
    await db.prepare('UPDATE import_limits SET next_allowed=0').run();
    const payload = { offers: Array.from({ length: 100 }, (_, index) => ({ ...IMPORT_EXAMPLE.offers[0], externalId: 'late-invalid-' + index,
      description: 'private-import-payload', ...(index === 99 ? { priceUah: 600.333 } : {}) })) };
    const body = JSON.stringify(payload, null, 2), idempotency = randomUUID();
    const response = await submitRaw(body, idempotency);
    assert.equal(response.status, 202);
    const accepted = await response.json() as any;
    assert.deepEqual([accepted.total, accepted.processed, accepted.succeeded, accepted.failed], [100, 0, 0, 0]);
    assert.ok(JSON.stringify(accepted).length < 2048 && !JSON.stringify(accepted).includes('private-import-payload'));
    const stored = await db.prepare('SELECT payload,payload_hash FROM import_jobs WHERE id=?').bind(accepted.id).first<any>();
    assert.equal(stored.payload, body); assert.equal(stored.payload_hash, 'raw:' + createHash('sha256').update(body).digest('hex'));
    const beforeReads = firebaseRequests, beforeWrites = firestoreWrites;
    await runManually(accepted.id);
    assert.equal(firebaseRequests, beforeReads, 'Invalid raw records are rejected before Firestore or receipt access.');
    assert.equal(firestoreWrites, beforeWrites, 'No earlier records in the invalid envelope can be written.');
    const detail = await detailManually(accepted.id);
    assert.equal(detail.status, 'failed'); assert.equal(detail.processed, 0); assert.deepEqual(detail.results, []);
    assert.match(detail.error, /^HTTP_422: .*Ціна/);
    const failed = await db.prepare('SELECT payload,attempts,lease_until FROM import_jobs WHERE id=?').bind(accepted.id).first<any>();
    assert.deepEqual(failed, { payload: null, attempts: 1, lease_until: 0 });
    const replay = await submitRaw(body, idempotency);
    assert.equal(replay.status, 202); assert.equal((await replay.json() as any).id, accepted.id);
    assert.equal((await submitRaw(JSON.stringify(payload), idempotency)).status, 409, 'New retries require identical original JSON bytes.');
    assert.equal((await request('imports', managerKey, 'POST', { companies: [null] })).status, 403, 'Manager company envelopes are denied before record validation.');
    assert.equal((await submitRaw('{"offers":[null],"uid":"other"}', randomUUID())).status, 422);
  });
  await t.test('concurrent raw retries reserve one job and full queue validation preserves drafts', async () => {
    await db.prepare('UPDATE import_limits SET next_allowed=0').run();
    const payload = { offers: [{ ...IMPORT_EXAMPLE.offers[0], externalId: 'stage5-valid', type: ' petg ', status: 'published' }] };
    const body = JSON.stringify(payload), idempotency = randomUUID();
    const count = (await db.prepare('SELECT COUNT(*) AS count FROM import_jobs').first<any>()).count;
    const replies = await Promise.all([submitRaw(body, idempotency), submitRaw(body, idempotency)]);
    assert.ok(replies.every(response => response.status === 202));
    const jobs = await Promise.all(replies.map(response => response.json() as Promise<any>));
    assert.equal(jobs[0].id, jobs[1].id);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM import_jobs').first<any>()).count, count + 1);
    await runManually(jobs[0].id);
    const detail = await detailManually(jobs[0].id);
    assert.equal(detail.status, 'completed'); assert.equal(detail.succeeded, 1);
    const offer = await read('companyOffers/' + detail.results[0].offerId);
    assert.equal(offer.type, 'PETG'); assert.equal(offer.family, 'Стандартні'); assert.equal(offer.status, 'hidden');
  });
  await t.test('legacy normalized jobs remain processable and retain normalized idempotent retries', async () => {
    await db.prepare('UPDATE import_limits SET next_allowed=0').run();
    const payload = { offers: [{ ...IMPORT_EXAMPLE.offers[0], externalId: 'stage5-legacy' }] };
    const body = JSON.stringify(payload), idempotency = randomUUID();
    const response = await submitRaw(body, idempotency);
    assert.equal(response.status, 202);
    const accepted = await response.json() as any;
    const normalized = JSON.stringify(normalizeImportPayload(payload));
    await db.prepare('UPDATE import_jobs SET payload=?,payload_hash=? WHERE id=?')
      .bind(normalized, createHash('sha256').update(normalized).digest('hex'), accepted.id).run();
    const replay = await submitRaw(JSON.stringify({ companies: [], ...payload }, null, 2), idempotency);
    assert.equal(replay.status, 202); assert.equal((await replay.json() as any).id, accepted.id);
    assert.equal((await submitRaw(JSON.stringify({ offers: [{ ...payload.offers[0], priceUah: 600.333 }] }), idempotency)).status, 422,
      'Legacy retry validation remains immediate because its normalized hash must be reproduced.');
    await runManually(accepted.id);
    const detail = await detailManually(accepted.id);
    assert.equal(detail.status, 'completed'); assert.equal(detail.succeeded, 1);
    assert.equal((await read('companyOffers/' + detail.results[0].offerId)).status, 'hidden');
    assert.ok(httpJobRows.some(row => Object.hasOwn(row, 'results')), 'The instrumented HTTP detail read was exercised.');
    assert.ok(httpJobRows.some(row => Object.hasOwn(row, 'succeeded')), 'The instrumented POST summary reads were exercised.');
    await db.prepare('UPDATE import_limits SET next_allowed=0').run();
  });
  const pending = await manual.fetch(new Request('https://import-runtime.invalid/api/v1/imports', { method: 'POST',
    headers: { Authorization: 'Bearer ' + adminKey, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ offers: [{ ...IMPORT_EXAMPLE.offers[0], externalId: 'last-delivery' }] }) }), environment);
  assert.equal(pending.status, 202);
  const pendingJob = await pending.json() as any;
  assert.equal((await db.prepare('SELECT status FROM import_jobs WHERE id=?').bind(pendingJob.id).first<any>()).status, 'queued');
  await db.prepare('UPDATE import_jobs SET attempts=3 WHERE id=?').bind(pendingJob.id).run();
  failCommitOnce = true;
  let acknowledged = false;
  await manual.queue({ messages: [{ body: { id: pendingJob.id, cursor: 0 }, ack: () => { acknowledged = true; }, retry: () => { throw new Error('Last delivery should recover its receipt.'); } }] }, environment);
  assert.ok(acknowledged);
  assert.equal((await db.prepare('SELECT status FROM import_jobs WHERE id=?').bind(pendingJob.id).first<any>()).status, 'completed', 'ambiguous last commit is recovered before marking a job failed');
  await db.prepare('UPDATE import_limits SET next_allowed=0').run();
  const previousJobs = (await db.prepare('SELECT COUNT(*) AS count FROM import_jobs').first<any>()).count;
  await db.prepare('UPDATE import_daily SET items=?').bind(IMPORT_LIMITS.dailyItems).run();
  assert.equal((await request('imports', adminKey, 'POST', IMPORT_EXAMPLE)).status, 429);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM import_jobs').first<any>()).count, previousJobs);
  await db.prepare('UPDATE import_daily SET items=0,dispatches=?').bind(IMPORT_LIMITS.dailyQueueMessages).run();
  const backpressure = await request('imports', adminKey, 'POST', IMPORT_EXAMPLE);
  assert.equal(backpressure.status, 202);
  const deferred = await backpressure.json() as any;
  const deferredRow = await db.prepare('SELECT status,error,payload FROM import_jobs WHERE id=?').bind(deferred.id).first<any>();
  assert.equal(deferredRow.status, 'queued'); assert.ok(deferredRow.error.includes('ліміт черги')); assert.ok(deferredRow.payload);
  assert.equal((await request('api-key', adminJwt, 'DELETE')).status, 200);
  const cancelled = await db.prepare('SELECT status,payload FROM import_jobs WHERE id=?').bind(deferred.id).first<any>();
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.payload, null);
  assert.equal((await request('imports', adminKey)).status, 401);
  const day = new Date().toISOString().slice(0, 10);
  await db.prepare('UPDATE import_daily SET access_checks=?,admin_access_checks=0 WHERE day=?').bind(IMPORT_LIMITS.dailyManagerAccessChecks - 1, day).run();
  const deniedBefore = firebaseRequests;
  const userJwt = jwt('user');
  // The initial denied request already used one of this UID's discovery checks.
  for (let i = 1; i < IMPORT_LIMITS.dailyUnrecognizedUidChecks; i++) assert.equal((await request('api-key', userJwt)).status, 403);
  const deniedAfter = firebaseRequests;
  assert.ok(deniedAfter > deniedBefore);
  const unknownOverflow = await Promise.all(Array.from({ length: 5 }, () => request('api-key', userJwt)));
  assert.ok(unknownOverflow.every(response => response.status === 429));
  assert.equal(firebaseRequests, deniedAfter, 'unknown UID quota stops Firebase reads before authorization');
  let counters = await db.prepare('SELECT access_checks,admin_access_checks FROM import_daily WHERE day=?').bind(day).first<any>();
  assert.equal(counters.access_checks, IMPORT_LIMITS.dailyManagerAccessChecks - 1, '403 cannot consume privileged quotas');
  assert.equal(counters.admin_access_checks, 0);
  assert.equal((await request('api-key', adminJwt)).status, 200, 'admin without an API key remains reachable after denied user requests');
  const restoredAdminKey = (await (await request('api-key', adminJwt, 'POST')).json() as any).key;
  await db.prepare('UPDATE import_daily SET access_checks=? WHERE day=?').bind(IMPORT_LIMITS.dailyManagerAccessChecks, day).run();
  const beforeBudget = firebaseRequests;
  assert.equal((await request('imports', managerKey)).status, 429);
  assert.equal(firebaseRequests, beforeBudget, 'exhausted budget stops outbound authorization reads');
  assert.equal((await request('imports', restoredAdminKey)).status, 200, 'manager quota exhaustion does not consume the admin reserve');
  await db.prepare('UPDATE import_daily SET admin_access_checks=? WHERE day=?').bind(IMPORT_LIMITS.dailyAdminAccessChecks - 1, day).run();
  const concurrentBudget = await Promise.all(Array.from({ length: 5 }, () => request('imports', restoredAdminKey)));
  assert.equal(concurrentBudget.filter(response => response.status === 200).length, 1, 'admin reserve is atomic under concurrent requests');
  assert.ok(concurrentBudget.every(response => [200,429].includes(response.status)));
  counters = await db.prepare('SELECT access_checks,admin_access_checks FROM import_daily WHERE day=?').bind(day).first<any>();
  assert.equal(counters.admin_access_checks, IMPORT_LIMITS.dailyAdminAccessChecks);
  await t.test('global preflight caps stop all UID writes and Firebase checks; each reserve has one atomic final slot', async () => {
    let rowsWritten = 0;
    const guardedDb = new Proxy(db, { get(target, property) {
      if (property === 'batch') return async (statements: Parameters<typeof db.batch>[0]) => {
        const results = await target.batch(statements);
        for (const result of results) rowsWritten += Number(result.meta.rows_written || 0);
        return results;
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const guard = createImportApi(importFetcher);
    const guardedRequest = (token: string, keyPath = false) => guard.fetch(new Request('https://import-runtime.invalid/api/v1/' + (keyPath ? 'api-key' : 'imports'),
      { headers: { Authorization: 'Bearer ' + token } }), { ...environment, ANALYTICS_DB: guardedDb });
    await db.prepare('UPDATE import_daily SET access_checks=0,admin_access_checks=0,admin_preflight_checks=500,manager_preflight_checks=500,unknown_preflight_checks=100 WHERE day=?').bind(day).run();
    const beforeUids = await db.prepare('SELECT COUNT(*) AS rows,SUM(checks) AS checks FROM import_access_daily WHERE day=?').bind(day).first<any>();
    const beforeAuth = authRequests, beforeFirebase = firebaseRequests;
    const denied = await Promise.all([guardedRequest(restoredAdminKey), guardedRequest(managerKey),
      ...Array.from({ length: 10 }, () => guardedRequest(jwt('discovery-' + randomUUID()), true))]);
    assert.ok(denied.every(response => response.status === 429));
    assert.equal(rowsWritten, 0, 'Exhausted global preflight reserves perform zero D1 writes, including unseen UIDs.');
    assert.equal(authRequests, beforeAuth); assert.equal(firebaseRequests, beforeFirebase);
    assert.deepEqual(await db.prepare('SELECT COUNT(*) AS rows,SUM(checks) AS checks FROM import_access_daily WHERE day=?').bind(day).first<any>(), beforeUids);
    try {
      for (const [column, token] of [['admin_preflight_checks', restoredAdminKey], ['manager_preflight_checks', managerKey]] as const) {
        await db.prepare(`UPDATE import_daily SET ${column}=499 WHERE day=?`).bind(day).run();
        const responses = await Promise.all(Array.from({ length: 6 }, () => guardedRequest(token)));
        assert.equal(responses.filter(response => response.status === 200).length, 1);
        assert.equal(responses.filter(response => response.status === 429).length, 5);
        assert.equal((await db.prepare(`SELECT ${column} AS checks FROM import_daily WHERE day=?`).bind(day).first<any>()).checks, 500);
      }
      await db.prepare('UPDATE import_daily SET unknown_preflight_checks=99 WHERE day=?').bind(day).run();
      const authBeforeDiscovery = authRequests;
      const discovery = await Promise.all(Array.from({ length: 6 }, () => guardedRequest(jwt('discovery-' + randomUUID()), true)));
      assert.equal(discovery.filter(response => response.status === 403).length, 1);
      assert.equal(discovery.filter(response => response.status === 429).length, 5);
      assert.equal(authRequests - authBeforeDiscovery, 1, 'Only one discovery UID can reach fresh Firebase Auth.');
      assert.equal((await db.prepare('SELECT unknown_preflight_checks FROM import_daily WHERE day=?').bind(day).first<any>()).unknown_preflight_checks, 100);
    } finally {
      await db.prepare('UPDATE import_daily SET access_checks=0,admin_access_checks=0,admin_preflight_checks=0,manager_preflight_checks=0,unknown_preflight_checks=0 WHERE day=?').bind(day).run();
    }
  });
  const batches: number[] = [];
  let beforeBatch: ((index: number) => Promise<void>) | undefined;
  let historyRowsRead = 0;
  const instrumented = new Proxy(db, { get(target, property) {
    if (property === 'batch') return async (statements: Parameters<typeof db.batch>[0]) => { batches.push(statements.length); await beforeBatch?.(batches.length); return target.batch(statements); };
    if (property === 'prepare') return (sql: string) => {
      const statement = target.prepare(sql);
      if (!sql.startsWith('SELECT id,status,total,cursor,created_at,updated_at,succeeded,failed FROM import_jobs ')) return statement;
      const watch = (prepared: typeof statement): typeof statement => new Proxy(prepared, { get(current, method) {
        if (method === 'bind') return (...values: Parameters<typeof statement.bind>) => watch(current.bind(...values));
        if (method === 'all') return async () => {
          const result = await current.all(); historyRowsRead = result.meta.rows_read;
          assert.ok(result.results.every((row: Record<string, unknown>) => !Object.hasOwn(row, 'results') && !Object.hasOwn(row, 'payload')), 'D1 transfers summaries without private result arrays or payloads.');
          return result;
        };
        const value = Reflect.get(current, method, current);
        return typeof value === 'function' ? value.bind(current) : value;
      } });
      return watch(statement);
    };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const observed = { ...environment, ANALYTICS_DB: instrumented };
  const clock = Math.floor(Date.now() / 1000);
  const scheduler = createImportApi(async (input, init) => {
    const response = await transport(new Request(String(input), init));
    return new Response(await response.arrayBuffer(), { status: response.status, headers: Object.fromEntries(response.headers) });
  }, () => new Date(clock * 1000));
  async function seedJob(uid: string, created: number, results: { success: boolean; message: string; index: number; kind: string }[], total = 100) {
    const id = randomUUID();
    const succeeded = results.filter(result => result.success).length;
    await db.prepare('INSERT INTO import_jobs(id,owner_uid,key_hash,fingerprint,idempotency,payload_hash,status,total,cursor,results,interval_seconds,created_at,updated_at,expires_at) SELECT ?,?,hash,fingerprint,?,?,?,?,?,?,3600,?,?,? FROM import_keys WHERE uid=?')
      .bind(id, uid, id, 'fixture-hash', results.length === 0 ? 'cancelled' : succeeded === total ? 'completed' : succeeded === 0 ? 'failed' : 'partial', total,
        results.length, JSON.stringify(results), created, created, created + 86400, uid).run();
    return id;
  }
  await t.test('thirty full result histories retain exact summaries and ownership with bounded row reads', async () => {
    await db.prepare('UPDATE import_daily SET access_checks=0,admin_access_checks=0,items=0,jobs=0').run();
    await db.prepare('DELETE FROM import_access_daily').run();
    const expected = [];
    for (let index = 0; index < 30; index++) {
      const succeeded = index % 3 === 0 ? 100 : index % 3 === 1 ? 0 : 37;
      const results = Array.from({ length: 100 }, (_, item) => ({ index: item, kind: 'offer', success: item < succeeded, message: 'x'.repeat(240) }));
      const created = clock + (index + 1) * 3600;
      const id = await seedJob('manager', created, results);
      expected.unshift({ id, status: succeeded === 100 ? 'completed' : succeeded === 0 ? 'failed' : 'partial', total: 100,
        processed: 100, succeeded, failed: 100 - succeeded, createdAt: new Date(created * 1000).toISOString(), updatedAt: new Date(created * 1000).toISOString() });
    }
    const emptyId = await seedJob('other-manager', clock + 31 * 3600, []);
    const result = await request('imports', managerKey);
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { jobs: expected });
    assert.equal((await request('imports/' + emptyId, managerKey)).status, 404);
    const detailed = await request('imports/' + expected[0].id, managerKey);
    assert.equal(detailed.status, 200);
    const detail = await detailed.json() as any;
    assert.equal(detail.results.length, 100); assert.equal(detail.results[0].message.length, 240);
    const adminList = await request('imports', restoredAdminKey);
    assert.equal(adminList.status, 200);
    const all = await adminList.json() as any;
    assert.equal(all.jobs.length, 30); assert.equal(all.jobs[0].id, emptyId);
    assert.equal(all.jobs[0].processed, 0); assert.equal(all.jobs[0].succeeded, 0); assert.equal(all.jobs[0].failed, 0);
    assert.deepEqual(all.jobs.slice(1), expected.slice(0, 29));
    batches.length = 0;
    const captured = await scheduler.fetch(new Request('https://import-runtime.invalid/api/v1/imports', { headers: { Authorization: 'Bearer ' + managerKey } }), observed);
    assert.equal(captured.status, 200); assert.deepEqual(await captured.json(), { jobs: expected });
    assert.deepEqual(batches, [2], 'Known-key preflight reserves the shared budget before its conditional UID write in one batch.');
    t.diagnostic(JSON.stringify({ maximumHistoryJobs: 30, resultRecords: 3000, d1RowsRead: historyRowsRead }));
    assert.ok(historyRowsRead > 0 && historyRowsRead <= 90,
      'D1 history reads: ' + historyRowsRead + '; summaries must read only 30 jobs and bounded index rows, independent of the 3000 results.');
    historyRowsRead = 0;
    const capturedAdmin = await scheduler.fetch(new Request('https://import-runtime.invalid/api/v1/imports', { headers: { Authorization: 'Bearer ' + restoredAdminKey } }), observed);
    assert.equal(capturedAdmin.status, 200); assert.deepEqual(await capturedAdmin.json(), all);
    assert.ok(historyRowsRead > 0 && historyRowsRead <= 90, 'The global admin history also stays bounded to 30 indexed job rows.');
    batches.length = 0;
    const denied = await scheduler.fetch(new Request('https://import-runtime.invalid/api/v1/api-key', { headers: { Authorization: 'Bearer ' + userJwt } }), observed);
    assert.equal(denied.status, 403); assert.deepEqual(batches, [2], 'An unknown UID uses only the discovery reserve and conditional UID claim; no privileged reserve is consumed.');
  });
  await t.test('scheduled batches expire before dispatch, bound recovery and retain live leases and current budgets', async () => {
    await db.prepare('UPDATE import_daily SET dispatches=0,cleanup_claimed=0').run();
    batches.length = 0;
    const sent: { id: string; cursor: number }[] = [];
    const cronEnv = { ...observed, IMPORT_QUEUE: { send: async (message: { id: string; cursor: number } | { maintenance: 'imports' | 'analytics' }) => {
      assert.ok('id' in message); if ('id' in message) sent.push(message);
    } } };
    const beforeEmpty = firebaseRequests;
    const previousDay = new Date((clock - 31 * 86400) * 1000).toISOString().slice(0, 10);
    await db.prepare('INSERT INTO import_daily(day) VALUES(?) ON CONFLICT(day) DO NOTHING').bind(previousDay).run();
    await db.prepare('INSERT INTO import_access_daily(day,uid,checks,limit_checks) VALUES(?,?,1,10)').bind(previousDay, 'old-counter').run();
    await scheduler.scheduled(cronEnv);
    assert.deepEqual(batches, [3, 4]); assert.equal(sent.length, 0);
    assert.equal(firebaseRequests, beforeEmpty, 'An empty scheduled run performs no Firebase reads or receipt deletions.');
    assert.equal(await db.prepare('SELECT day FROM import_daily WHERE day=?').bind(previousDay).first(), null);
    assert.equal(await db.prepare('SELECT uid FROM import_access_daily WHERE uid=?').bind('old-counter').first(), null);
    async function cronJob(label: string, created: number) {
      const uid = 'cron-' + label;
      await db.prepare('INSERT INTO import_keys SELECT ?,?,prefix,role,company_id,fingerprint,valid_since,created_at,expires_at FROM import_keys WHERE uid=?')
        .bind(uid, uid, 'admin').run();
      return seedJob(uid, created, [], 1);
    }
    const expiredId = await cronJob('expired', clock - 10);
    await db.prepare("UPDATE import_jobs SET status='queued',payload='{}',expires_at=? WHERE id=?").bind(clock - 1, expiredId).run();
    const leasedId = await cronJob('leased', clock - 9);
    await db.prepare("UPDATE import_jobs SET status='processing',payload='{}',expires_at=?,lease_until=? WHERE id=?").bind(clock - 1, clock + 600, leasedId).run();
    const ready: string[] = [];
    for (let index = 0; index < 6; index++) {
      const id = await cronJob('ready-' + index, clock - 8 + index);
      await db.prepare("UPDATE import_jobs SET status='queued',payload='{}' WHERE id=?").bind(id).run(); ready.push(id);
    }
    const retained: string[] = [];
    for (let index = 0; index < 6; index++) retained.push(await cronJob('retention-' + index, clock - 31 * 86400 + index));
    batches.length = 0;
    await scheduler.scheduled(cronEnv);
    const expired = await db.prepare('SELECT status,payload FROM import_jobs WHERE id=?').bind(expiredId).first<any>();
    assert.equal(expired.status, 'failed'); assert.equal(expired.payload, null);
    assert.equal((await db.prepare('SELECT status FROM import_jobs WHERE id=?').bind(leasedId).first<any>()).status, 'processing');
    assert.deepEqual(sent.map(message => message.id), ready.slice(0, 5), 'Expired rows leave the active set before the bounded outbox SELECT.');
    assert.deepEqual(batches, [3, ...Array(5).fill(2)], 'Cleanup runs once per UTC day; each claimed job atomically reserves its queue budget.');
    assert.equal((await db.prepare('SELECT dispatches FROM import_daily WHERE day=?').bind(day).first<any>()).dispatches, 5);
    assert.equal((await db.prepare('SELECT dispatch_at FROM import_jobs WHERE id=?').bind(ready[5]).first<any>()).dispatch_at, 0);
    let remaining = 0;
    for (const id of retained) if (await db.prepare('SELECT id FROM import_jobs WHERE id=?').bind(id).first()) remaining++;
    assert.equal(remaining, 1, 'Receipt/job cleanup removes only five histories per invocation.');
    assert.ok(await db.prepare('SELECT day FROM import_daily WHERE day=?').bind(day).first(), 'Current budgets remain present.');

    // Cancellation after the outbox SELECT makes the UPDATE match zero rows.
    batches.length = 0;
    beforeBatch = async index => {
      if (index === 2) await db.prepare("UPDATE import_jobs SET status='cancelled',payload=NULL WHERE id=?").bind(ready[5]).run();
    };
    try { await scheduler.scheduled(cronEnv); } finally { beforeBatch = undefined; }
    assert.deepEqual(batches, [3, 2]);
    assert.equal(sent.length, 5);
    assert.equal((await db.prepare('SELECT dispatches FROM import_daily WHERE day=?').bind(day).first<any>()).dispatches, 5,
      'A stale outbox entry cannot reserve a queue message when changes() is zero.');

    const exhaustedId = await cronJob('exhausted', clock);
    await db.prepare("UPDATE import_jobs SET status='queued',payload='{}' WHERE id=?").bind(exhaustedId).run();
    await db.prepare('UPDATE import_daily SET dispatches=? WHERE day=?').bind(IMPORT_LIMITS.dailyQueueMessages, day).run();
    await scheduler.scheduled(cronEnv);
    const exhausted = await db.prepare('SELECT status,payload,dispatch_at,error FROM import_jobs WHERE id=?').bind(exhaustedId).first<any>();
    assert.equal(exhausted.status, 'queued'); assert.equal(exhausted.payload, '{}');
    assert.equal(exhausted.dispatch_at, clock + 86400 - clock % 86400); assert.match(exhausted.error, /ліміт черги/);
    assert.equal(sent.length, 5, 'An exhausted reserve defers the durable job without sending.');
    assert.equal((await db.prepare('SELECT dispatches FROM import_daily WHERE day=?').bind(day).first<any>()).dispatches, IMPORT_LIMITS.dailyQueueMessages);

    for (const label of ['concurrent-a', 'concurrent-b']) {
      const id = await cronJob(label, clock);
      await db.prepare("UPDATE import_jobs SET status='queued',payload='{}' WHERE id=?").bind(id).run();
    }
    await db.prepare('UPDATE import_daily SET dispatches=? WHERE day=?').bind(IMPORT_LIMITS.dailyQueueMessages - 1, day).run();
    await Promise.all([scheduler.scheduled(cronEnv), scheduler.scheduled(cronEnv)]);
    assert.equal(sent.length, 6, 'Concurrent schedulers can send only one message for the last daily slot.');
    assert.equal((await db.prepare('SELECT dispatches FROM import_daily WHERE day=?').bind(day).first<any>()).dispatches, IMPORT_LIMITS.dailyQueueMessages);
  });
  await t.test('receipt deletion reserves the concurrent last daily slot and never refunds a failed attempt', async () => {
    const uid = 'receipt-budget';
    await db.prepare('INSERT INTO import_keys SELECT ?,?,prefix,role,company_id,fingerprint,valid_since,created_at,expires_at FROM import_keys WHERE uid=?')
      .bind(uid, uid, 'admin').run();
    const id = await seedJob(uid, clock - 40 * 86400, [], 1);
    await db.prepare('UPDATE import_daily SET history_delete_attempts=199 WHERE day=?').bind(day).run();
    const before = firebaseRequests;
    failFirebase = true;
    try {
      const runs = await Promise.allSettled([scheduler.scheduled(environment), scheduler.scheduled(environment)]);
      assert.equal(runs.filter(result => result.status === 'rejected').length, 1);
      assert.equal(runs.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(firebaseRequests - before, 1, 'Only one concurrent caller can delete a receipt at the final reserved slot.');
    } finally { failFirebase = false; }
    assert.equal((await db.prepare('SELECT history_delete_attempts FROM import_daily WHERE day=?').bind(day).first<any>()).history_delete_attempts, 200);
    assert.ok(await db.prepare('SELECT id FROM import_jobs WHERE id=?').bind(id).first(), 'A failed receipt delete retains the durable history.');
    await scheduler.scheduled(environment);
    assert.equal(firebaseRequests - before, 1, 'Retry cannot refund or exceed the daily deletion-attempt budget.');
    await db.prepare('DELETE FROM import_jobs WHERE id=?').bind(id).run();
  });
  await t.test('expired key, cooldown, UID and day cleanup is indexed, bounded and claimed once per UTC day', async () => {
    const oldDay = new Date((clock - 45 * 86400) * 1000).toISOString().slice(0, 10);
    await db.prepare('UPDATE import_daily SET cleanup_claimed=0 WHERE day=?').bind(day).run();
    await db.prepare('DELETE FROM import_daily WHERE day<?').bind(new Date((clock - 30 * 86400) * 1000).toISOString().slice(0, 10)).run();
    await db.prepare('DELETE FROM import_access_daily WHERE day<?').bind(new Date((clock - 2 * 86400) * 1000).toISOString().slice(0, 10)).run();
    await db.prepare('DELETE FROM import_limits WHERE next_allowed<=?').bind(clock).run();
    await db.prepare('WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<205) INSERT INTO import_keys(uid,hash,prefix,role,fingerprint,valid_since,created_at,expires_at) SELECT \'expired-key-\'||i,\'expired-hash-\'||i,\'fixture\',\'admin\',\'fixture\',0,?,? FROM n')
      .bind(clock - 100, clock - 1).run();
    await db.prepare('WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<205) INSERT INTO import_limits(uid,next_allowed) SELECT \'expired-limit-\'||i,? FROM n').bind(clock - 1).run();
    await db.prepare('WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<1105) INSERT INTO import_access_daily(day,uid,checks,limit_checks) SELECT ?,\'expired-uid-\'||i,1,10 FROM n').bind(oldDay).run();
    await db.prepare('WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<35) INSERT INTO import_daily(day) SELECT date(?,\'-\'||i||\' days\') FROM n').bind(oldDay).run();
    const cleanupRows: { reads: number; writes: number }[] = [];
    const measuring = new Proxy(db, { get(target, property) {
      if (property === 'batch') return async (statements: Parameters<typeof db.batch>[0]) => {
        const results = await target.batch(statements);
        if (statements.length === 4) cleanupRows.push(...results.map((result: { meta: { rows_read: number; rows_written: number } }) => ({ reads: result.meta.rows_read, writes: result.meta.rows_written })));
        return results;
      };
      const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await scheduler.scheduled({ ...environment, ANALYTICS_DB: measuring });
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM import_keys WHERE uid LIKE 'expired-key-%'").first<any>()).n, 5);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM import_limits WHERE uid LIKE 'expired-limit-%'").first<any>()).n, 5);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM import_access_daily WHERE uid LIKE 'expired-uid-%'").first<any>()).n, 5);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM import_daily WHERE day<?').bind(oldDay).first<any>()).n, 3);
    assert.deepEqual(cleanupRows.map(row => row.writes), [200, 200, 1100, 32]);
    assert.ok(cleanupRows.every(row => row.reads <= row.writes * 4), 'Cleanup remains bounded by its selected rows and primary/index lookups.');
    await scheduler.scheduled({ ...environment, ANALYTICS_DB: measuring });
    assert.equal(cleanupRows.length, 4, 'Repeated Queue deliveries do not repeat daily cleanup.');
    for (const [table, column, index] of [['import_keys','expires_at','import_keys_expiry'], ['import_limits','next_allowed','import_limits_expiry']]) {
      const plan = await db.prepare(`EXPLAIN QUERY PLAN SELECT uid FROM ${table} INDEXED BY ${index} WHERE ${column}<=? ORDER BY ${column} LIMIT 200`).bind(clock).all<any>();
      assert.ok(plan.results.some((row: { detail: string }) => String(row.detail).includes(index)));
    }
    t.diagnostic(JSON.stringify({ boundedDailyCleanup: cleanupRows }));
  });
  await t.test('rotation and active-owner guard scan only pending jobs despite three thousand owner histories', async () => {
    const uid = 'history-scan-budget';
    const inserted = await db.prepare('INSERT INTO import_keys SELECT ?,?,prefix,role,company_id,fingerprint,valid_since,created_at,? FROM import_keys WHERE uid=?')
      .bind(uid, uid, clock + 200 * 86400, 'admin').run();
    await db.prepare('WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<3000) INSERT INTO import_jobs(id,owner_uid,key_hash,fingerprint,idempotency,payload_hash,status,total,interval_seconds,created_at,updated_at,expires_at) SELECT \'history-scan-\'||i,?,hash,fingerprint,\'history-scan-\'||i,\'fixture\',\'completed\',1,300,?+i*3600,?+i*3600,?+i*3600+86400 FROM n CROSS JOIN import_keys WHERE uid=?')
      .bind(uid, clock, clock, clock, uid).run();
    await db.prepare('DELETE FROM import_limits WHERE uid=?').bind(uid).run();
    const id = await seedJob(uid, clock + 3001 * 3600, [], 1);
    await db.prepare("UPDATE import_jobs SET status='queued',payload='{}' WHERE id=?").bind(id).run();
    const guardSql = "SELECT 1 FROM import_jobs INDEXED BY import_jobs_pending WHERE owner_uid=? AND status IN ('queued','processing')";
    const rotationSql = "UPDATE import_jobs INDEXED BY import_jobs_pending SET status='cancelled',payload=NULL WHERE owner_uid=? AND status IN ('queued','processing')";
    for (const sql of [guardSql, rotationSql]) {
      const plan = await db.prepare('EXPLAIN QUERY PLAN ' + sql).bind(uid).all<any>();
      assert.ok(plan.results.some((row: { detail: string }) => String(row.detail).includes('import_jobs_pending')));
      assert.ok(plan.results.every((row: { detail: string }) => !String(row.detail).includes('import_jobs_owner')));
    }
    const guarded = await db.prepare(guardSql).bind(uid).all();
    const claim = await db.prepare("UPDATE import_jobs SET status='processing',lease_token='fixture',lease_until=?,attempts=attempts+1,updated_at=? WHERE id=? AND cursor=0 AND lease_until<=? AND status IN ('queued','processing') RETURNING *")
      .bind(clock + 600, clock, id, clock).all();
    const failed = await db.prepare('UPDATE import_jobs SET lease_token=NULL,lease_until=0,dispatch_at=?,updated_at=? WHERE id=? AND lease_token=?')
      .bind(clock + 300, clock, id, 'fixture').run();
    const progress = await db.prepare("UPDATE import_jobs SET cursor=1,results=?,status='completed',payload=NULL,attempts=0,lease_token=NULL,lease_until=0,dispatch_at=0,updated_at=? WHERE id=?")
      .bind(JSON.stringify([{ index: 0, kind: 'offer', success: true }]), clock, id).run();
    await db.prepare("UPDATE import_jobs SET status='queued' WHERE id=?").bind(id).run();
    const rotated = await db.prepare(rotationSql).bind(uid).run();
    const removed = await db.prepare('DELETE FROM import_keys WHERE uid=?').bind(uid).run();
    assert.ok(guarded.meta.rows_read <= 200 && rotated.meta.rows_read <= 200, 'Three thousand terminal histories never enter owner-active reads.');
    assert.equal(guarded.results.length, 1); assert.equal(rotated.meta.changes, 1);
    t.diagnostic(JSON.stringify({ pendingOwnerGuard: guarded.meta, keyInsert: inserted.meta, queueClaim: claim.meta,
      retryUpdate: failed.meta, successProgress: progress.meta, rotation: rotated.meta, keyDelete: removed.meta }));
  });
  await t.test('native D1 Cron producer admits exactly one concurrent final maintenance slot', async () => {
    await db.prepare('INSERT INTO import_daily(day,maintenance_dispatches) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET maintenance_dispatches=excluded.maintenance_dispatches')
      .bind(day, IMPORT_LIMITS.dailyMaintenanceMessages - 1).run();
    const worker = await mf.getWorker() as unknown as { scheduled(event: { cron: string }): Promise<unknown> };
    await Promise.all(Array.from({ length: 6 }, () => worker.scheduled({ cron: '*/5 * * * *' })));
    assert.equal((await db.prepare('SELECT maintenance_dispatches FROM import_daily WHERE day=?').bind(day).first<any>()).maintenance_dispatches, IMPORT_LIMITS.dailyMaintenanceMessages);
    await worker.scheduled({ cron: '0 2 * * *' });
    assert.equal((await db.prepare('SELECT maintenance_dispatches FROM import_daily WHERE day=?').bind(day).first<any>()).maintenance_dispatches, IMPORT_LIMITS.dailyMaintenanceMessages);
    assert.equal(oauthRequests, 1, 'All HTTP requests and maintenance consumers reuse the persisted service credential; permissions stay live.');
  });
});
