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
  let failCommitOnce = false, failFirebase = false, firebaseRequests = 0, firestoreWrites = 0;
  const transport = async (request: Pick<Request, 'url' | 'method' | 'text'>) => {
      const url = new URL(request.url);
      if (url.hostname === 'www.googleapis.com') return new RuntimeResponse(JSON.stringify({ keys: [jwk] }), { headers: { 'Cache-Control': 'public,max-age=3600' } });
      if (url.hostname === 'oauth2.googleapis.com') {
        const assertion = new URLSearchParams(await request.text()).get('assertion')!;
        const parts = assertion.split('.');
        assert.ok(verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), pair.publicKey, Buffer.from(parts[2], 'base64url')));
        return new RuntimeResponse(JSON.stringify({ access_token: 'fixture', expires_in: 3600 }));
      }
      if (url.hostname === 'identitytoolkit.googleapis.com') {
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
  for (const file of ['0002_import_api.sql', '0003_import_access_limits.sql']) {
    const migration = await readFile('migrations/' + file, 'utf8');
    for (const statement of migration.trim().split(/(?<=;)\s*(?=(?:CREATE|ALTER)\b)/i)) await db.prepare(statement).run();
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
  const manual = createImportApi(async (input, init) => {
    const response = await transport(new Request(String(input), init));
    return new Response(await response.arrayBuffer(), { status: response.status, headers: Object.fromEntries(response.headers) });
  });
  const environment = { FIREBASE_PROJECT_ID: project, FIREBASE_IMPORT_SERVICE_ACCOUNT: secret, ANALYTICS_DB: db,
    IMPORT_QUEUE: { send: async () => { throw new Error('Fixture queue unavailable'); } } };
  const httpJobRows: Record<string, unknown>[] = [];
  const projectedDb = new Proxy(db, { get(target, property) {
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
  await db.prepare('UPDATE import_daily SET items=5000').run();
  assert.equal((await request('imports', adminKey, 'POST', IMPORT_EXAMPLE)).status, 429);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM import_jobs').first<any>()).count, previousJobs);
  await db.prepare('UPDATE import_daily SET items=0,dispatches=1500').run();
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
  const batches: number[] = [];
  let historyRowsRead = 0;
  const instrumented = new Proxy(db, { get(target, property) {
    if (property === 'batch') return (statements: Parameters<typeof db.batch>[0]) => { batches.push(statements.length); return target.batch(statements); };
    if (property === 'prepare') return (sql: string) => {
      const statement = target.prepare(sql);
      if (!sql.includes('json_each')) return statement;
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
  await t.test('thirty full result histories retain exact summaries and ownership with one JSON scan', async () => {
    await db.prepare('UPDATE import_daily SET access_checks=0,admin_access_checks=0').run();
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
    assert.deepEqual(batches, [2], 'Known-key preflight reserves the UID check and reads the daily reserve in one batch.');
    t.diagnostic(JSON.stringify({ maximumHistoryJobs: 30, resultRecords: 3000, d1RowsRead: historyRowsRead }));
    assert.ok(historyRowsRead > 0 && historyRowsRead <= 30 * (IMPORT_LIMITS.items + 3),
      'D1 history reads: ' + historyRowsRead + '; expected 3000 results plus bounded summary/index/sort scans.');
    batches.length = 0;
    const denied = await scheduler.fetch(new Request('https://import-runtime.invalid/api/v1/api-key', { headers: { Authorization: 'Bearer ' + userJwt } }), observed);
    assert.equal(denied.status, 403); assert.deepEqual(batches, [1], 'An unknown UID has only its preliminary quota statement; no privileged reserve is consumed.');
  });
  await t.test('scheduled batches expire before dispatch, bound recovery and retain live leases and current budgets', async () => {
    await db.prepare('UPDATE import_daily SET dispatches=0').run();
    batches.length = 0;
    const sent: { id: string; cursor: number }[] = [];
    const cronEnv = { ...observed, IMPORT_QUEUE: { send: async (message: { id: string; cursor: number }) => { sent.push(message); } } };
    const beforeEmpty = firebaseRequests;
    await scheduler.scheduled(cronEnv);
    assert.deepEqual(batches, [2, 2]); assert.equal(sent.length, 0);
    assert.equal(firebaseRequests, beforeEmpty, 'An empty scheduled run performs no Firebase reads or receipt deletions.');
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
    const previousDay = new Date((clock - 31 * 86400) * 1000).toISOString().slice(0, 10);
    await db.prepare('INSERT INTO import_access_daily(day,uid,checks,limit_checks) VALUES(?,?,1,10)').bind(previousDay, 'old-counter').run();
    await scheduler.scheduled(cronEnv);
    const expired = await db.prepare('SELECT status,payload FROM import_jobs WHERE id=?').bind(expiredId).first<any>();
    assert.equal(expired.status, 'failed'); assert.equal(expired.payload, null);
    assert.equal((await db.prepare('SELECT status FROM import_jobs WHERE id=?').bind(leasedId).first<any>()).status, 'processing');
    assert.deepEqual(sent.map(message => message.id), ready.slice(0, 5), 'Expired rows leave the active set before the bounded outbox SELECT.');
    assert.equal((await db.prepare('SELECT dispatch_at FROM import_jobs WHERE id=?').bind(ready[5]).first<any>()).dispatch_at, 0);
    let remaining = 0;
    for (const id of retained) if (await db.prepare('SELECT id FROM import_jobs WHERE id=?').bind(id).first()) remaining++;
    assert.equal(remaining, 1, 'Receipt/job cleanup removes only five histories per invocation.');
    assert.equal(await db.prepare('SELECT day FROM import_daily WHERE day=?').bind(previousDay).first(), null);
    assert.equal(await db.prepare('SELECT uid FROM import_access_daily WHERE uid=?').bind('old-counter').first(), null);
    assert.ok(await db.prepare('SELECT day FROM import_daily WHERE day=?').bind(day).first(), 'Current budgets remain present.');
  });
});
