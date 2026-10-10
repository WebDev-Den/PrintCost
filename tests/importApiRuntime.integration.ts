import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { build } from 'esbuild';
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare';
import { IMPORT_EXAMPLE, IMPORT_LIMITS, normalizeImportPayload } from '../src/domain/apiImports.ts';
import { encodeFields } from '../workers/importFirebase.ts';
import { decodeFields } from '../workers/firebase.ts';
import { createImportApi } from '../workers/importApi.ts';

test('native Free capacity migration preserves prior usage and admits one concurrent final item', { timeout: 30_000 }, async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true,
    script: 'export default {fetch(){return new Response("fixture")}}', d1Databases: ['CAPACITY_DB'] }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('CAPACITY_DB');
  const migrate = async (file: string) => {
    const migration = await readFile('migrations/' + file, 'utf8');
    for (const statement of migration.replace(/--[^\n]*/g, '').trim().split(/(?<=;)\s*(?=(?:CREATE|ALTER|UPDATE|DROP)\b)/i)) await db.prepare(statement).run();
  };
  for (const file of ['0001_analytics.sql', '0002_import_api.sql', '0003_import_access_limits.sql', '0004_import_result_counts.sql',
    '0005_analytics_report_budget.sql', '0006_firebase_token_broker.sql', '0007_maintenance_budget.sql', '0008_analytics_event_budget.sql', '0009_import_cleanup_budget.sql']) await migrate(file);
  const time = Date.parse('2026-10-10T12:00:00Z') / 1000, nextDay = time + 86400;
  for (const uid of ['capacity-a', 'capacity-b']) await db.prepare("INSERT INTO import_keys(uid,hash,prefix,role,fingerprint,valid_since,created_at,expires_at) VALUES(?,?,?,'admin','fixture',0,?,?)")
    .bind(uid, uid, uid, time, time + 3 * 86400).run();
  const insert = (id: string, uid: string, created: number, status = 'queued') => db.prepare(`INSERT INTO import_jobs(id,owner_uid,key_hash,fingerprint,idempotency,payload_hash,status,total,interval_seconds,created_at,updated_at,expires_at,payload)
    SELECT ?,uid,hash,fingerprint,?,'raw:fixture',?,1,300,?,?,?,'{}' FROM import_keys WHERE uid=?`)
    .bind(id, id, status, created, created, created + 86400, uid).run();
  await db.prepare("INSERT INTO import_daily(day,items) VALUES('2026-10-10',2200)").run();
  await insert('legacy-capacity', 'capacity-a', time, 'completed');
  await migrate('0010_import_free_capacity.sql');
  const prior = await db.prepare("SELECT items,jobs FROM import_daily WHERE day='2026-10-10'").first();
  assert.deepEqual(prior, { items: 2201, jobs: 1 }, 'Applying the smaller cap never rewrites accepted prior usage.');
  const legacy = await db.prepare("SELECT status,payload FROM import_jobs WHERE id='legacy-capacity'").first();
  assert.deepEqual(legacy, { status: 'completed', payload: '{}' }, 'Accepted jobs remain unchanged.');
  await assert.rejects(insert('over-new-cap', 'capacity-b', time + 300), /IMPORT_BUDGET/);
  await db.prepare("INSERT INTO import_daily(day,items) VALUES('2026-10-11',?)").bind(IMPORT_LIMITS.dailyItems - 1).run();
  const results = await Promise.allSettled([insert('final-capacity-a', 'capacity-a', nextDay), insert('final-capacity-b', 'capacity-b', nextDay)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && /IMPORT_BUDGET/.test(String(result.reason))).length, 1);
  assert.deepEqual(await db.prepare("SELECT items,jobs FROM import_daily WHERE day='2026-10-11'").first(), { items: IMPORT_LIMITS.dailyItems, jobs: 1 });
  assert.deepEqual(await db.prepare("SELECT items,jobs FROM import_daily WHERE day='2026-10-10'").first(), prior, 'UTC rollover preserves previous reservations.');
});

test('native history visibility indexes have bounded admission and queue write costs', { timeout: 30_000 }, async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true,
    script: 'export default {fetch(){return new Response("fixture")}}', d1Databases: ['BEFORE_DB', 'AFTER_DB'] }));
  t.after(() => mf.dispose());
  const time = Date.parse('2026-10-10T12:00:00Z') / 1000;
  const measurements: Record<string, Record<string, { rows_read: number; rows_written: number }>> = {};
  for (const [name, hasVisibilityIndexes] of [['BEFORE_DB', false], ['AFTER_DB', true]] as const) {
    const db = await mf.getD1Database(name);
    const files = ['0001_analytics.sql', '0002_import_api.sql', '0003_import_access_limits.sql', '0004_import_result_counts.sql',
      '0005_analytics_report_budget.sql', '0006_firebase_token_broker.sql', '0007_maintenance_budget.sql', '0008_analytics_event_budget.sql',
      '0009_import_cleanup_budget.sql', '0010_import_free_capacity.sql', ...(hasVisibilityIndexes ? ['0011_import_history_delete.sql'] : [])];
    for (const file of files) {
      const migration = await readFile('migrations/' + file, 'utf8');
      for (const statement of migration.replace(/--[^\n]*/g, '').trim().split(/(?<=;)\s*(?=(?:CREATE|ALTER|UPDATE|DROP)\b)/i)) await db.prepare(statement).run();
    }
    await db.prepare("INSERT INTO import_keys(uid,hash,prefix,role,fingerprint,valid_since,created_at,expires_at) VALUES('fixture','fixture','fixture','admin','fixture',0,?,?)")
      .bind(time, time + 86400).run();
    const admission = await db.prepare("INSERT INTO import_jobs(id,owner_uid,key_hash,fingerprint,idempotency,payload_hash,status,total,interval_seconds,created_at,updated_at,expires_at,payload) VALUES('job','fixture','fixture','fixture','job','raw:fixture','queued',100,300,?,?,?,'{}')")
      .bind(time, time, time + 86400).run();
    const claim = await db.prepare("UPDATE import_jobs SET status='processing',lease_token='fixture',lease_until=?,attempts=attempts+1,updated_at=? WHERE id='job' AND cursor=0 AND lease_until<=? AND status IN ('queued','processing') RETURNING id")
      .bind(time + 600, time, time).all();
    const retry = await db.prepare("UPDATE import_jobs SET lease_token=NULL,lease_until=0,dispatch_at=?,updated_at=? WHERE id='job' AND lease_token='fixture'")
      .bind(time + 300, time).run();
    const progress = await db.prepare("UPDATE import_jobs SET cursor=100,results=?,status='completed',payload=NULL,attempts=0,lease_token=NULL,lease_until=0,dispatch_at=0,updated_at=? WHERE id='job'")
      .bind(JSON.stringify(Array.from({ length: 100 }, (_, index) => ({ index, kind: 'offer', success: true }))), time).run();
    measurements[name] = Object.fromEntries(Object.entries({ admission, claim, retry, progress }).map(([operation, result]) => [operation,
      { rows_read: result.meta.rows_read, rows_written: result.meta.rows_written }]));
    if (hasVisibilityIndexes) {
      const hide = await db.prepare("UPDATE import_jobs SET history_deleted=1 WHERE id='job' RETURNING id").all();
      const repeat = await db.prepare("UPDATE import_jobs SET history_deleted=1 WHERE id='job' RETURNING id").all();
      assert.ok(hide.meta.rows_written <= 3 && repeat.meta.rows_written <= 3,
        'Each hiding update fits one row plus its two visibility-index entries.');
      measurements[name].hide = { rows_read: hide.meta.rows_read, rows_written: hide.meta.rows_written };
      measurements[name].repeatHide = { rows_read: repeat.meta.rows_read, rows_written: repeat.meta.rows_written };
    }
  }
  const before = measurements.BEFORE_DB, after = measurements.AFTER_DB;
  const admissionDelta = after.admission.rows_written - before.admission.rows_written;
  assert.ok(admissionDelta >= 0 && admissionDelta <= 2); assert.ok(after.admission.rows_written <= 13);
  for (const [operation, upperBound] of [['claim', 2], ['retry', 2], ['progress', 3]] as const) {
    assert.equal(after[operation].rows_written, before[operation].rows_written,
      'Visibility indexes must not add writes when queue updates leave owner, creation time and visibility unchanged.');
    assert.ok(after[operation].rows_written <= upperBound);
  }
  t.diagnostic(JSON.stringify({ historyVisibilityIndexCosts: measurements, admissionWriteDelta: admissionDelta }));
});

test('real Worker/D1/Queues imports: keys, concurrent throttling, ownership and retry recovery', { timeout: 120_000 }, async t => {
  const project = 'demo-import-api-' + randomUUID().slice(0, 8);
  const firestoreOrigin = 'http://' + (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080');
  const webApiKey = 'AIza' + 'x'.repeat(35);
  const appCheckToken = 'fixture.attestation.token';
  const emulator = new URL(firestoreOrigin);
  const rules = await initializeTestEnvironment({ projectId: project, firestore: { host: emulator.hostname, port: Number(emulator.port),
    rules: await readFile('firestore.rules', 'utf8') } });
  t.after(() => rules.cleanup());
  const root = '/v1/projects/' + project + '/databases/(default)/documents';
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const secret = JSON.stringify({ project_id: project, client_email: 'import@' + project + '.iam.gserviceaccount.com',
    private_key: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  const users = new Map(['admin', 'manager', 'other-manager', 'user'].map(uid => [uid, { localId: uid, emailVerified: true, validSince: '0', disabled: false }]));
  const seed = async (path: string, data: Record<string, unknown>) => {
    const response = await fetch(firestoreOrigin + root + '/' + path, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: encodeFields(data) }) });
    assert.ok(response.ok, 'Fixture HTTP ' + response.status);
  };
  const read = async (path: string) => {
    const response = await fetch(firestoreOrigin + root + '/' + path, { headers: { Authorization: 'Bearer owner' } });
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
  let failCommitOnce = false, failFirebase = false, firebaseRequests = 0, firestoreWrites = 0, oauthRequests = 0, authRequests = 0, remoteAuthRequests = 0, jwksRequests = 0;
  const transport = async (request: Pick<Request, 'url' | 'method' | 'text' | 'headers'>) => {
      const url = new URL(request.url);
      if (url.hostname === 'www.googleapis.com') { jwksRequests++; throw new Error('Production-key runtime must not fetch JWKS.'); }
      if (url.hostname === 'oauth2.googleapis.com') {
        oauthRequests++;
        const assertion = new URLSearchParams(await request.text()).get('assertion')!;
        const parts = assertion.split('.');
        assert.ok(verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), pair.publicKey, Buffer.from(parts[2], 'base64url')));
        return new RuntimeResponse(JSON.stringify({ access_token: 'fixture', expires_in: 3600 }));
      }
      if (url.hostname === 'identitytoolkit.googleapis.com') {
        const payload = JSON.parse(await request.text());
        if (url.pathname === '/v1/accounts:lookup') {
          remoteAuthRequests++;
          assert.equal(url.searchParams.get('key'), webApiKey);
          assert.equal(url.searchParams.get('fields'), 'users(localId,emailVerified,disabled,validSince)');
          assert.deepEqual(Object.keys(payload), ['idToken'], 'Remote verification never includes admin account selectors.');
          const parts = payload.idToken.split('.');
          if (parts.length !== 3 || !verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), pair.publicKey, Buffer.from(parts[2], 'base64url'))) {
            return new RuntimeResponse(JSON.stringify({ error: { message: 'INVALID_ID_TOKEN' } }), { status: 400 });
          }
          const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
          assert.equal(claims.aud, project); assert.equal(claims.iss, 'https://securetoken.google.com/' + project);
          return new RuntimeResponse(JSON.stringify({ users: users.has(claims.sub) ? [users.get(claims.sub)] : [] }));
        }
        authRequests++;
        assert.equal(url.pathname, '/v1/projects/' + project + '/accounts:lookup');
        assert.deepEqual(Object.keys(payload), ['localId']);
        const uid = payload.localId[0];
        return new RuntimeResponse(JSON.stringify({ users: users.has(uid) ? [users.get(uid)] : [] }));
      }
      assert.equal(url.hostname, 'firestore.googleapis.com', 'Fixtures never contact a production endpoint.');
      assert.ok(url.pathname.startsWith(root));
      firebaseRequests++;
      if (url.pathname.endsWith(':commit')) firestoreWrites++;
      if (failFirebase) return new RuntimeResponse('{}', { status: 503 });
      const service = request.headers.get('Authorization') === 'Bearer fixture';
      // The emulator evaluates real Rules for exact browser ID tokens. Its App Check
      // enforcement is simulated here; a denied browser call never receives owner credentials.
      if (!service && request.headers.get('X-Firebase-AppCheck') !== appCheckToken) return new RuntimeResponse('{}', { status: 403 });
      const upstream = await fetch(firestoreOrigin + url.pathname + url.search, { method: request.method, headers: {
        Authorization: service ? 'Bearer owner' : request.headers.get('Authorization')!, 'Content-Type': 'application/json' },
        body: request.method === 'GET' ? undefined : await request.text() });
      if (failCommitOnce && url.pathname.endsWith(':commit') && upstream.ok) { failCommitOnce = false; return new RuntimeResponse('{}', { status: 503 }); }
      return new RuntimeResponse(await upstream.arrayBuffer(), { status: upstream.status, headers: Object.fromEntries(upstream.headers) });
    };
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'import-runtime', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-08',
    bindings: { FIREBASE_PROJECT_ID: project, FIREBASE_WEB_API_KEY: webApiKey, FIREBASE_IMPORT_SERVICE_ACCOUNT: secret },
    d1Databases: ['ANALYTICS_DB'], queueProducers: { IMPORT_QUEUE: 'imports' },
    queueConsumers: { imports: { maxBatchSize: 1, maxBatchTimeout: 0, maxRetries: 3, retryDelay: 0 } },
    outboundService: transport,
  }));
  t.after(async () => { await mf.dispose(); await fetch(firestoreOrigin + '/emulator/v1/projects/' + project + '/databases/(default)/documents', { method: 'DELETE' }); });
  const db = await mf.getD1Database('ANALYTICS_DB');
  for (const file of ['0001_analytics.sql', '0002_import_api.sql', '0003_import_access_limits.sql', '0004_import_result_counts.sql',
    '0005_analytics_report_budget.sql', '0006_firebase_token_broker.sql', '0007_maintenance_budget.sql', '0008_analytics_event_budget.sql', '0009_import_cleanup_budget.sql', '0010_import_free_capacity.sql', '0011_import_history_delete.sql']) {
    const migration = await readFile('migrations/' + file, 'utf8');
    for (const statement of migration.replace(/--[^\n]*/g, '').trim().split(/(?<=;)\s*(?=(?:CREATE|ALTER|UPDATE|DROP)\b)/i)) await db.prepare(statement).run();
  }
  function jwt(uid: string, stale = false, changes: Record<string, unknown> = {}) {
    // A signed discovery token represents a real Auth user without privileged role records.
    if (!users.has(uid)) users.set(uid, { localId: uid, emailVerified: true, validSince: '0', disabled: false });
    const time = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({ sub: uid, aud: project, iss: 'https://securetoken.google.com/' + project,
      iat: time, exp: time + 3600, auth_time: stale ? time - 600 : time, email_verified: true, ...changes })).toString('base64url');
    const input = header + '.' + claims;
    return input + '.' + sign('RSA-SHA256', Buffer.from(input), pair.privateKey).toString('base64url');
  }
  const request = (path: string, token: string, method = 'GET', payload?: unknown, idempotency = randomUUID(), extra: Record<string, string> = {}) =>
    mf.dispatchFetch('https://import-runtime.invalid/api/v1/' + path, { method, headers: { Authorization: 'Bearer ' + token, 'X-Firebase-AppCheck': appCheckToken,
      'Content-Type': 'application/json', 'Idempotency-Key': idempotency, ...extra },
      body: payload === undefined ? undefined : JSON.stringify(payload) });
  const adminJwt = jwt('admin'), managerJwt = jwt('manager');
  const importFetcher: typeof fetch = async (input, init) => {
    const response = await transport(new Request(String(input), init));
    return new Response(await response.arrayBuffer(), { status: response.status, headers: Object.fromEntries(response.headers) });
  };
  await t.test('native remote verification rejects forged, foreign, disabled and revoked tokens before D1 or role access', async () => {
    const beforeFirestore = firebaseRequests, beforeServiceAuth = authRequests;
    const beforeRemote = remoteAuthRequests;
    const counters = async () => JSON.stringify(await Promise.all([
      db.prepare('SELECT * FROM import_daily').all(), db.prepare('SELECT * FROM import_access_daily').all(),
    ]).then(rows => rows.map((row: { results: unknown[] }) => row.results)));
    const beforeCounters = await counters();
    const pieces = adminJwt.split('.');
    pieces[2] = (pieces[2][0] === 'A' ? 'B' : 'A') + pieces[2].slice(1);
    assert.equal((await request('api-key', pieces.join('.'))).status, 401, 'Exact supplied signature is verified by Google transport.');
    assert.equal(remoteAuthRequests, beforeRemote + 1);
    for (const changes of [{ aud: 'foreign-project' }, { iss: 'https://securetoken.google.com/foreign' }, { exp: 1 }]) {
      assert.equal((await request('api-key', jwt('admin', false, changes))).status, 401);
    }
    assert.equal(remoteAuthRequests, beforeRemote + 1, 'Wrong project or expired claims reject before Google.');
    const account = users.get('admin')!;
    try {
      account.disabled = true;
      assert.equal((await request('api-key', adminJwt)).status, 403);
      account.disabled = false; account.emailVerified = false;
      assert.equal((await request('api-key', adminJwt)).status, 403);
      account.emailVerified = true; account.validSince = String(Math.floor(Date.now() / 1000) + 1);
      assert.equal((await request('api-key', adminJwt)).status, 401);
    } finally { account.disabled = false; account.emailVerified = true; account.validSince = '0'; }
    assert.equal(remoteAuthRequests, beforeRemote + 4, 'The same token reads current Auth state on every request.');
    assert.equal(firebaseRequests, beforeFirestore, 'Rejected remote identities never read role or company documents.');
    assert.equal(authRequests, beforeServiceAuth, 'Rejected tokens never enter privileged scope lookup.');
    assert.equal(await counters(), beforeCounters, 'No D1 UID quota or privileged budget is touched before identity verification.');
    assert.equal(jwksRequests, 0);
  });
  const noKeyCooldown = Math.floor(Date.now() / 1000) + 3600;
  await db.prepare('INSERT INTO import_limits(uid,next_allowed) VALUES(?,?)').bind('admin', noKeyCooldown).run();
  const warming = await request('api-key', adminJwt);
  assert.equal(warming.status, 200);
  const noKeyMetadata = await warming.json() as any;
  assert.equal(noKeyMetadata.key, null);
  assert.equal(noKeyMetadata.nextImportAt, new Date(noKeyCooldown * 1000).toISOString(), 'Revoking a key never removes its informational cooldown.');
  await db.prepare('DELETE FROM import_limits WHERE uid=?').bind('admin').run();
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM firebase_service_tokens').first<{ n: number }>())?.n, 0,
    'A cold browser scope works with an empty service credential broker.');
  assert.equal(oauthRequests, 0, 'Browser scope uses its exact ID token without service OAuth.');
  await createImportApi(importFetcher).refreshCredentials({ FIREBASE_PROJECT_ID: project, FIREBASE_WEB_API_KEY: webApiKey, FIREBASE_IMPORT_SERVICE_ACCOUNT: secret, ANALYTICS_DB: db,
    IMPORT_QUEUE: { async send() {} } });
  assert.equal(oauthRequests, 1);
  await t.test('native browser identity reuses one remote Auth check while every role read stays fresh', async () => {
    const beforeAuth = authRequests, beforeRemote = remoteAuthRequests, beforeFirestore = firebaseRequests;
    assert.equal((await request('api-key', adminJwt)).status, 200);
    assert.equal(remoteAuthRequests, beforeRemote + 1); assert.equal(authRequests, beforeAuth);
    assert.equal(firebaseRequests, beforeFirestore + 1, 'The role batch is still read on every browser request.');
    try {
      await seed('accountAccess/admin', { blocked: true, changeId: 'remote-block' });
      assert.equal((await request('api-key', adminJwt)).status, 403);
      assert.equal(remoteAuthRequests, beforeRemote + 2); assert.equal(authRequests, beforeAuth);
      assert.equal(firebaseRequests, beforeFirestore + 2, 'A role block with the same ID token takes effect immediately.');
    } finally { await seed('accountAccess/admin', { blocked: false, changeId: 'remote-unblock' }); }
  });
  await t.test('native browser scope enforces App Check and real owner Rules without service fallback', async () => {
    const beforeAuth = authRequests, beforeOAuth = oauthRequests;
    for (const attestation of ['', 'invalid.attestation.token']) {
      assert.equal((await request('api-key', adminJwt, 'GET', undefined, randomUUID(), { 'X-Firebase-AppCheck': attestation })).status, 403);
    }
    assert.equal(authRequests, beforeAuth); assert.equal(oauthRequests, beforeOAuth);
    const name = 'projects/' + project + '/databases/(default)/documents/';
    const own = await fetch(firestoreOrigin + root + ':batchGet', { method: 'POST', headers: {
      Authorization: 'Bearer ' + managerJwt, 'Content-Type': 'application/json' }, body: JSON.stringify({ documents: [name + 'accountDeletion/manager'] }) });
    assert.equal(own.status, 200, 'Rules permit the required own deletion-marker get even when absent.');
    const foreign = await fetch(firestoreOrigin + root + ':batchGet', { method: 'POST', headers: {
      Authorization: 'Bearer ' + managerJwt, 'Content-Type': 'application/json' }, body: JSON.stringify({ documents: [name + 'accountDeletion/other-manager'] }) });
    assert.equal(foreign.status, 403, 'The exact browser identity cannot read a foreign private deletion marker.');
  });
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
  await t.test('native external API keys always read current privileged Auth and roles', async () => {
    const beforeAuth = authRequests, beforeRemote = remoteAuthRequests, beforeFirestore = firebaseRequests;
    assert.equal((await request('imports', adminKey)).status, 200);
    assert.equal(authRequests, beforeAuth + 1); assert.equal(remoteAuthRequests, beforeRemote);
    assert.equal(firebaseRequests, beforeFirestore + 1);
    users.get('admin')!.disabled = true;
    try { assert.equal((await request('imports', adminKey)).status, 403); }
    finally { users.get('admin')!.disabled = false; }
    assert.equal(authRequests, beforeAuth + 2, 'Disabling the same API-key owner is checked anew.');
    assert.equal(firebaseRequests, beforeFirestore + 1, 'Disabled API-key owner never reaches role reads.');
  });
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
  assert.equal((await (await request('api-key', managerJwt)).json() as any).nextImportAt, new Date(cooldown.next_allowed * 1000).toISOString());
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
  const huge = await request('imports', managerKey, 'POST', { value: 'x'.repeat(IMPORT_LIMITS.bytes) });
  assert.equal(huge.status, 413);
  await db.prepare('UPDATE import_limits SET next_allowed=0').run();
  failFirebase = true;
  // Initial scope fails closed; no job is reserved when Firebase is unavailable.
  assert.equal((await request('imports', managerKey, 'POST', managerPayload)).status, 503);
  failFirebase = false;
  // Same production handler with an intentionally unavailable producer: D1 remains the durable outbox.
  const manual = createImportApi(importFetcher);
  const environment = { FIREBASE_PROJECT_ID: project, FIREBASE_WEB_API_KEY: webApiKey, FIREBASE_IMPORT_SERVICE_ACCOUNT: secret, ANALYTICS_DB: db,
    IMPORT_QUEUE: { send: async () => { throw new Error('Fixture queue unavailable'); } } };
  const httpJobRows: Record<string, unknown>[] = [];
  const httpJobQueries = new WeakSet<object>();
  const captureHttpJobRows = (rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      assert.ok(!Object.hasOwn(row, 'payload') && !Object.hasOwn(row, 'key_hash') && !Object.hasOwn(row, 'fingerprint'),
        'HTTP job reads/INSERT RETURNING must not transfer payloads or private authorization fields from D1.');
      httpJobRows.push(row);
    }
  };
  let databaseSize = 0;
  const projectedDb = new Proxy(db, { get(target, property) {
    if (property === 'batch') return async (statements: Parameters<typeof db.batch>[0]) => {
      const results = await target.batch(statements);
      if (databaseSize) for (const result of results) result.meta.size_after = databaseSize;
      statements.forEach((statement: object, index: number) => { if (httpJobQueries.has(statement)) captureHttpJobRows(results[index].results); });
      return results;
    };
    if (property === 'prepare') return (sql: string) => {
      const statement = target.prepare(sql);
      if (!sql.includes('import_jobs')) return statement;
      const watch = (prepared: typeof statement): typeof statement => {
        const wrapped = new Proxy(prepared, { get(current, method) {
        if (method === 'bind') return (...values: Parameters<typeof statement.bind>) => watch(current.bind(...values));
        if (method === 'first' || method === 'all') return async () => {
          const result = method === 'first' ? await current.first() : await current.all();
          const rows = method === 'first' ? result ? [result] : [] : (result as { results: Record<string, unknown>[] }).results;
          captureHttpJobRows(rows as Record<string, unknown>[]);
          return result;
        };
        const value = Reflect.get(current, method, current);
        return typeof value === 'function' ? value.bind(current) : value;
        } });
        httpJobQueries.add(wrapped); return wrapped;
      };
      return watch(statement);
    };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const httpEnvironment = { ...environment, ANALYTICS_DB: projectedDb };
  const submitRaw = (body: string, idempotency: string) => manual.fetch(new Request('https://import-runtime.invalid/api/v1/imports', {
    method: 'POST', headers: { Authorization: 'Bearer ' + adminKey, 'Content-Type': 'application/json', 'Idempotency-Key': idempotency }, body,
  }), httpEnvironment);
  await t.test('untrusted Content-Length cannot bypass the actual streamed byte and strict UTF-8 limits', async () => {
    const count = (await db.prepare('SELECT COUNT(*) AS n FROM import_jobs').first<any>()).n;
    const before = authRequests;
    const oversized = await submitRaw('{"offers":[null]}' + ' '.repeat(IMPORT_LIMITS.bytes), randomUUID());
    assert.equal(oversized.status, 413, 'A body without Content-Length is still bounded by its actual streamed bytes.');
    const falseLength = await manual.fetch(new Request('https://import-runtime.invalid/api/v1/imports', {
      method: 'POST', headers: { Authorization: 'Bearer ' + adminKey, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), 'Content-Length': '1' },
      body: '{"offers":[null]}' + ' '.repeat(IMPORT_LIMITS.bytes),
    }), httpEnvironment);
    assert.equal(falseLength.status, 413, 'A smaller declared size never relaxes the stream limit.');
    const invalidUtf8 = await manual.fetch(new Request('https://import-runtime.invalid/api/v1/imports', {
      method: 'POST', headers: { Authorization: 'Bearer ' + adminKey, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: new Uint8Array([0xff, 0xfe]),
    }), httpEnvironment);
    assert.equal(invalidUtf8.status, 422, 'Invalid UTF-8 cannot become a different replacement-character JSON payload.');
    assert.ok(authRequests > before, 'The stream check is exercised after normal fresh authorization.');
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM import_jobs').first<any>()).n, count);
  });
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
        { headers: { Authorization: 'Bearer ' + token, 'X-Firebase-AppCheck': appCheckToken } }), httpEnvironment);
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
        method, headers: { Authorization: 'Bearer ' + jwt('other-manager'), 'X-Firebase-AppCheck': appCheckToken },
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
    const compact = JSON.stringify(payload);
    const body = compact + ' '.repeat(IMPORT_LIMITS.bytes - new TextEncoder().encode(compact).length), idempotency = randomUUID();
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
      { headers: { Authorization: 'Bearer ' + token, 'X-Firebase-AppCheck': appCheckToken } }), { ...environment, ANALYTICS_DB: guardedDb });
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
      const authBeforeDiscovery = authRequests, rolesBeforeDiscovery = firebaseRequests, remoteBeforeDiscovery = remoteAuthRequests;
      const discovery = await Promise.all(Array.from({ length: 6 }, () => guardedRequest(jwt('discovery-' + randomUUID()), true)));
      assert.equal(discovery.filter(response => response.status === 403).length, 1);
      assert.equal(discovery.filter(response => response.status === 429).length, 5);
      assert.equal(remoteAuthRequests - remoteBeforeDiscovery, 6, 'Every discovery token obtains its own verified remote account state.');
      assert.equal(authRequests, authBeforeDiscovery, 'Browser-session scope never repeats the verified Auth lookup.');
      assert.equal(firebaseRequests - rolesBeforeDiscovery, 1, 'Only the admitted discovery UID reaches fresh role documents.');
      assert.equal((await db.prepare('SELECT unknown_preflight_checks FROM import_daily WHERE day=?').bind(day).first<any>()).unknown_preflight_checks, 100);
    } finally {
      await db.prepare('UPDATE import_daily SET access_checks=0,admin_access_checks=0,admin_preflight_checks=0,manager_preflight_checks=0,unknown_preflight_checks=0 WHERE day=?').bind(day).run();
    }
  });
  const batches: number[] = [];
  let beforeBatch: ((index: number) => Promise<void>) | undefined;
  let historyRowsRead = 0;
  const historyQueries = new WeakSet<object>();
  const detailQueries = new WeakSet<object>();
  const historyDeleteQueries = new WeakSet<object>();
  let historyDeleteBatch: { rowsWritten: number; statementWrites: number[] } | undefined;
  const instrumented = new Proxy(db, { get(target, property) {
    if (property === 'batch') return async (statements: Parameters<typeof db.batch>[0]) => {
      batches.push(statements.length); await beforeBatch?.(batches.length);
      const results = await target.batch(statements);
      if (statements.some((statement: object) => historyDeleteQueries.has(statement))) {
        const statementWrites: number[] = results.map((result: { meta: { rows_written: number } }) => result.meta.rows_written);
        historyDeleteBatch = { rowsWritten: statementWrites.reduce((total, count) => total + count, 0), statementWrites };
      }
      const index = statements.findIndex((statement: object) => historyQueries.has(statement) || detailQueries.has(statement));
      if (index !== -1) {
        historyRowsRead = results[index].meta.rows_read;
        assert.ok(results[index].results.every((row: Record<string, unknown>) => !Object.hasOwn(row, 'payload') && (detailQueries.has(statements[index]) || !Object.hasOwn(row, 'results'))),
          'D1 transfers summaries without private result arrays or payloads.');
      }
      return results;
    };
    if (property === 'prepare') return (sql: string) => {
      const statement = target.prepare(sql);
      const history = sql.startsWith('SELECT id,status,total,cursor,created_at,updated_at,succeeded,failed FROM import_jobs ');
      const detail = sql.startsWith('SELECT id,status,total,cursor,created_at,updated_at,results,error FROM import_jobs ');
      const deletion = sql.startsWith('UPDATE import_jobs SET history_deleted=1 ');
      if (!history && !detail && !deletion) return statement;
      const watch = (prepared: typeof statement): typeof statement => {
        const wrapped = new Proxy(prepared, { get(current, method) {
        if (method === 'bind') return (...values: Parameters<typeof statement.bind>) => watch(current.bind(...values));
        if (method === 'all') return async () => {
          const result = await current.all(); if (!deletion) historyRowsRead = result.meta.rows_read;
          assert.ok(result.results.every((row: Record<string, unknown>) => !Object.hasOwn(row, 'results') && !Object.hasOwn(row, 'payload')), 'D1 transfers summaries without private result arrays or payloads.');
          return result;
        };
        const value = Reflect.get(current, method, current);
        return typeof value === 'function' ? value.bind(current) : value;
        } });
        (deletion ? historyDeleteQueries : history ? historyQueries : detailQueries).add(wrapped); return wrapped;
      };
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
      const created = clock + (index + 1) * 7200;
      const id = await seedJob('manager', created, results);
      expected.unshift({ id, status: succeeded === 100 ? 'completed' : succeeded === 0 ? 'failed' : 'partial', total: 100,
        processed: 100, succeeded, failed: 100 - succeeded, createdAt: new Date(created * 1000).toISOString(), updatedAt: new Date(created * 1000).toISOString() });
    }
    const emptyId = await seedJob('other-manager', clock + 31 * 7200, []);
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
    assert.deepEqual(batches, [2, 2], 'Preflight and the final fresh-role quota plus gated summary read use two batches.');
    t.diagnostic(JSON.stringify({ maximumHistoryJobs: 30, resultRecords: 3000, d1RowsRead: historyRowsRead }));
    assert.ok(historyRowsRead > 0 && historyRowsRead <= 90,
      'D1 history reads: ' + historyRowsRead + '; summaries must read only 30 jobs and bounded index rows, independent of the 3000 results.');
    historyRowsRead = 0;
    const capturedAdmin = await scheduler.fetch(new Request('https://import-runtime.invalid/api/v1/imports', { headers: { Authorization: 'Bearer ' + restoredAdminKey } }), observed);
    assert.equal(capturedAdmin.status, 200); assert.deepEqual(await capturedAdmin.json(), all);
    assert.ok(historyRowsRead > 0 && historyRowsRead <= 90, 'The global admin history also stays bounded to 30 indexed job rows.');
    batches.length = 0;
    const denied = await scheduler.fetch(new Request('https://import-runtime.invalid/api/v1/api-key', { headers: { Authorization: 'Bearer ' + userJwt, 'X-Firebase-AppCheck': appCheckToken } }), observed);
    assert.equal(denied.status, 403); assert.deepEqual(batches, [2], 'An unknown UID uses only the discovery reserve and conditional UID claim; no privileged reserve is consumed.');
  });
  await t.test('gated history/detail batches read no jobs if the fresh-role quota is exhausted after preflight', async () => {
    for (const [token, column, limit] of [[managerKey, 'access_checks', IMPORT_LIMITS.dailyManagerAccessChecks],
      [restoredAdminKey, 'admin_access_checks', IMPORT_LIMITS.dailyAdminAccessChecks]] as const) {
      for (const path of ['imports', 'imports/' + job.id]) {
        await db.prepare('UPDATE import_daily SET access_checks=0,admin_access_checks=0,manager_preflight_checks=0,admin_preflight_checks=0 WHERE day=?').bind(day).run();
        if (path.includes('/')) {
          const allowed = await scheduler.fetch(new Request('https://import-runtime.invalid/api/v1/' + path, { headers: { Authorization: 'Bearer ' + token } }), observed);
          assert.equal(allowed.status, 200);
          assert.ok(historyRowsRead > 0 && historyRowsRead <= 2, 'Admitted detail uses only its primary-key index and single job row.');
        }
        batches.length = 0; historyRowsRead = -1;
        beforeBatch = async index => {
          if (index === 2) await db.prepare('UPDATE import_daily SET ' + column + '=? WHERE day=?').bind(limit, day).run();
        };
        try {
          const denied = await scheduler.fetch(new Request('https://import-runtime.invalid/api/v1/' + path, { headers: { Authorization: 'Bearer ' + token } }), observed);
          assert.equal(denied.status, 429); assert.ok(Number(denied.headers.get('Retry-After')) > 0);
          assert.deepEqual(batches, [2, 2]);
          assert.equal(historyRowsRead, 0, 'A raced exhausted reserve skips every job/index row.');
          assert.equal((await db.prepare('SELECT ' + column + ' AS n FROM import_daily WHERE day=?').bind(day).first<{ n: number }>())?.n, limit);
        } finally { beforeBatch = undefined; }
      }
    }
    await db.prepare('UPDATE import_daily SET access_checks=0,admin_access_checks=0 WHERE day=?').bind(day).run();
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
    assert.ok(remoteAuthRequests > 10, 'Native and manual browser-session requests exercise production remote verification.');
    assert.equal(jwksRequests, 0, 'No remote-enabled Worker request silently falls back to JWKS.');
  });

  async function resetHistoryBudget(attempts = 0) {
    await db.prepare('UPDATE import_daily SET access_checks=0,admin_access_checks=0,admin_preflight_checks=0,manager_preflight_checks=0,unknown_preflight_checks=0,history_delete_attempts=? WHERE day=?')
      .bind(attempts, day).run();
    await db.prepare('DELETE FROM import_access_daily WHERE day=?').bind(day).run();
  }
  const historyColumns = 'id,owner_uid,idempotency,payload_hash,status,total,cursor,results,succeeded,failed';
  await t.test('removing a completed history preserves catalog, receipt, cooldown and hidden idempotency after key rotation', async () => {
    await resetHistoryBudget();
    const before = await db.prepare('SELECT ' + historyColumns + ' FROM import_jobs WHERE id=?').bind(job.id).first();
    const beforeCooldown = await db.prepare('SELECT next_allowed FROM import_limits WHERE uid=?').bind('manager').first();
    const receipt = await read('importReceipts/' + job.id);
    const offers = await Promise.all(completed.results.map((result: { offerId: string }) => read('companyOffers/' + result.offerId)));
    const beforeWrites = firestoreWrites;
    const jobCount = await db.prepare('SELECT COUNT(*) AS n FROM import_jobs').first();
    const dispatches = await db.prepare('SELECT dispatches FROM import_daily WHERE day=?').bind(day).first();
    const removed = await request('imports/' + job.id, managerJwt, 'DELETE');
    assert.equal(removed.status, 200); assert.deepEqual(await removed.json(), { deletedIds: [job.id], unavailableIds: [] });
    assert.equal((await db.prepare('SELECT history_deleted FROM import_jobs WHERE id=?').bind(job.id).first<any>()).history_deleted, 1);
    assert.deepEqual(await db.prepare('SELECT ' + historyColumns + ' FROM import_jobs WHERE id=?').bind(job.id).first(), before);
    assert.equal((await request('imports/' + job.id, managerJwt)).status, 404);
    assert.equal((await request('imports/' + job.id, adminJwt)).status, 404, 'Hidden detail is unavailable even to an administrator.');
    for (const token of [managerJwt, adminJwt]) {
      const visible = await request('imports', token);
      assert.equal(visible.status, 200);
      assert.ok(!(await visible.json() as any).jobs.some((entry: { id: string }) => entry.id === job.id));
    }
    const repeated = await request('imports/' + job.id, managerJwt, 'DELETE');
    assert.equal(repeated.status, 200); assert.deepEqual(await repeated.json(), { deletedIds: [job.id], unavailableIds: [] },
      'Owned terminal removal is idempotent while each repeated attempt remains budgeted.');
    assert.equal((await request('imports', managerKey, 'POST', managerPayload, idempotency)).status, 409,
      'A hidden history cannot become a new import under its original idempotency key.');
    const rotated = await request('api-key', managerJwt, 'POST');
    assert.equal(rotated.status, 201); managerKey = (await rotated.json() as any).key;
    assert.equal((await request('imports', managerKey, 'POST', managerPayload, idempotency)).status, 409,
      'Rotating the API key does not discard the retained idempotency reservation.');
    assert.deepEqual(await db.prepare('SELECT COUNT(*) AS n FROM import_jobs').first(), jobCount);
    assert.deepEqual(await db.prepare('SELECT dispatches FROM import_daily WHERE day=?').bind(day).first(), dispatches);
    assert.deepEqual(await db.prepare('SELECT next_allowed FROM import_limits WHERE uid=?').bind('manager').first(), beforeCooldown);
    assert.deepEqual(await read('importReceipts/' + job.id), receipt, 'UI history removal does not delete the queue receipt.');
    assert.deepEqual(await Promise.all(completed.results.map((result: { offerId: string }) => read('companyOffers/' + result.offerId))), offers);
    assert.equal(firestoreWrites, beforeWrites, 'History removal and its retries never write catalog or receipt documents.');
  });

  const historyOwner = 'history-manager';
  const historyJwt = jwt(historyOwner, false, { iat: clock, auth_time: clock });
  let historyKey: string;
  let queuedHistory: string;
  await t.test('thirty selected histories disappear from both indexed lists without deleting durable rows', async () => {
    await resetHistoryBudget();
    await seed('accountAccess/' + historyOwner, { blocked: false, changeId: 'history-initial' });
    await seed('memberships/' + historyOwner, { active: true, companyId: 'company-a', changeId: 'history-initial', version: 1 });
    const key = await request('api-key', historyJwt, 'POST');
    assert.equal(key.status, 201); historyKey = (await key.json() as any).key;
    await db.prepare('UPDATE import_keys SET expires_at=? WHERE uid=?').bind(clock + 200 * 86400, historyOwner).run();
    const ids: string[] = [];
    for (let index = 0; index < 30; index++) ids.push(await seedJob(historyOwner, clock + (3100 + index) * 3600,
      [{ index: 0, kind: 'offer', success: true, message: 'Completed fixture' }], 1));
    for (const token of [historyJwt, adminJwt]) {
      const response = await request('imports', token);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json() as any).jobs.map((entry: { id: string }) => entry.id), [...ids].reverse());
    }
    historyDeleteBatch = undefined;
    const removed = await scheduler.fetch(new Request('https://import-runtime.invalid/api/v1/imports', { method: 'DELETE',
      headers: { Authorization: 'Bearer ' + historyJwt, 'X-Firebase-AppCheck': appCheckToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }) }), observed);
    assert.equal(removed.status, 200);
    const value = await removed.json() as any;
    assert.deepEqual(value.deletedIds.sort(), [...ids].sort()); assert.deepEqual(value.unavailableIds, []);
    const measuredDelete = historyDeleteBatch as { rowsWritten: number; statementWrites: number[] } | undefined;
    assert.ok(measuredDelete && measuredDelete.rowsWritten <= 1 + 3 * ids.length,
      'The atomic deletion batch is bounded by one reservation plus one row and two visibility entries per ID.');
    t.diagnostic(JSON.stringify({ historyDeleteItems: ids.length, historyDeleteBatch: measuredDelete }));
    const remaining = await request('imports', historyJwt);
    assert.equal(remaining.status, 200); assert.deepEqual(await remaining.json(), { jobs: [] });
    const global = await request('imports', adminJwt);
    assert.equal(global.status, 200);
    assert.ok((await global.json() as any).jobs.every((entry: { id: string }) => !ids.includes(entry.id)));
    assert.equal((await request('imports/' + ids[0], historyJwt)).status, 404);
    assert.equal((await request('imports/' + ids[0], adminJwt)).status, 404);
    for (const id of ids) {
      const row = await db.prepare('SELECT history_deleted,results,succeeded,failed FROM import_jobs WHERE id=?').bind(id).first<any>();
      assert.equal(row.history_deleted, 1); assert.equal(JSON.parse(row.results).length, 1);
      assert.equal(row.succeeded, 1); assert.equal(row.failed, 0);
    }
    assert.equal((await db.prepare('SELECT history_delete_attempts FROM import_daily WHERE day=?').bind(day).first<any>()).history_delete_attempts, 30);
  });

  await t.test('mixed bulk removal keeps foreign, missing, active and leased histories indistinguishably unavailable', async () => {
    await resetHistoryBudget();
    const owned: string[] = [];
    for (let index = 0; index < 7; index++) owned.push(await seedJob(historyOwner, clock + (3140 + index) * 3600,
      [{ index: 0, kind: 'offer', success: true, message: 'Retained results' }], 1));
    for (const [index, status] of ['completed', 'partial', 'failed', 'cancelled'].entries()) {
      await db.prepare('UPDATE import_jobs SET status=? WHERE id=?').bind(status, owned[index]).run();
    }
    await db.prepare('UPDATE import_jobs SET lease_until=? WHERE id=?').bind(clock + 3600, owned[4]).run();
    await db.prepare("UPDATE import_jobs SET status='queued',lease_until=0 WHERE id=?").bind(owned[5]).run();
    await db.prepare("UPDATE import_jobs SET status='processing',lease_until=? WHERE id=?").bind(clock - 1, owned[6]).run();
    queuedHistory = owned[5];
    const foreign = await seedJob('other-manager', clock + 90 * 3600,
      [{ index: 0, kind: 'offer', success: true, message: 'Foreign history' }], 1);
    const missing = randomUUID(), ids = [...owned, foreign, missing];
    const removed = await request('imports', historyJwt, 'DELETE', { ids });
    assert.equal(removed.status, 200);
    const value = await removed.json() as any;
    assert.deepEqual(value.deletedIds.sort(), owned.slice(0, 4).sort());
    assert.deepEqual(value.unavailableIds.sort(), [...owned.slice(4), foreign, missing].sort());
    for (const id of [...owned.slice(4), foreign]) assert.equal((await db.prepare('SELECT history_deleted FROM import_jobs WHERE id=?').bind(id).first<any>()).history_deleted, 0);
    assert.equal((await db.prepare('SELECT history_delete_attempts FROM import_daily WHERE day=?').bind(day).first<any>()).history_delete_attempts, ids.length,
      'The shared attempt reserve charges each requested ID, including unavailable ones.');
    const admin = await request('imports', adminJwt, 'DELETE', { ids: [foreign, owned[4], owned[5], owned[6], missing] });
    assert.equal(admin.status, 200); assert.deepEqual(await admin.json(), { deletedIds: [foreign], unavailableIds: [owned[4], owned[5], owned[6], missing] });
    await db.prepare('UPDATE import_jobs SET lease_until=? WHERE id=?').bind(clock - 1, owned[4]).run();
    const expiredLease = await request('imports/' + owned[4], adminJwt, 'DELETE');
    assert.equal(expiredLease.status, 200); assert.deepEqual(await expiredLease.json(), { deletedIds: [owned[4]], unavailableIds: [] });
    assert.equal((await db.prepare('SELECT history_deleted FROM import_jobs WHERE id=?').bind(owned[6]).first<any>()).history_deleted, 0,
      'An expired lease alone never makes a still-processing job removable.');
  });

  await t.test('malformed removal batches are bounded and never reserve attempts or hide histories', async () => {
    await resetHistoryBudget();
    const attempts = () => db.prepare('SELECT history_delete_attempts FROM import_daily WHERE day=?').bind(day).first();
    const before = await attempts();
    const invalid = [{ ids: [] }, { ids: [queuedHistory, queuedHistory] }, { ids: Array.from({ length: 31 }, () => randomUUID()) },
      { ids: ['not-a-uuid'] }, { ids: ['-'.repeat(36)] }, { ids: [null] }, { ids: queuedHistory }, { ids: [queuedHistory], extra: true }, {}, [], null];
    for (const payload of invalid) assert.equal((await request('imports', historyJwt, 'DELETE', payload)).status, 422, JSON.stringify(payload));
    assert.equal((await request('imports', historyJwt, 'DELETE', { ids: [queuedHistory] }, randomUUID(), { 'Content-Type': 'text/plain' })).status, 415);
    const malformed = await mf.dispatchFetch('https://import-runtime.invalid/api/v1/imports', { method: 'DELETE',
      headers: { Authorization: 'Bearer ' + historyJwt, 'X-Firebase-AppCheck': appCheckToken, 'Content-Type': 'application/json' }, body: '{"ids":[' });
    assert.equal(malformed.status, 422);
    const body = JSON.stringify({ ids: [queuedHistory] }) + ' '.repeat(4096);
    const oversized = await manual.fetch(new Request('https://import-runtime.invalid/api/v1/imports', { method: 'DELETE',
      headers: { Authorization: 'Bearer ' + historyJwt, 'X-Firebase-AppCheck': appCheckToken, 'Content-Type': 'application/json' },
      body }), environment);
    assert.equal(oversized.status, 413, 'The actual streamed body is bounded even without a Content-Length header.');
    const falseLength = await manual.fetch(new Request('https://import-runtime.invalid/api/v1/imports', { method: 'DELETE',
      headers: { Authorization: 'Bearer ' + historyJwt, 'X-Firebase-AppCheck': appCheckToken, 'Content-Type': 'application/json', 'Content-Length': '1' },
      body }), environment);
    assert.equal(falseLength.status, 413, 'A false smaller Content-Length cannot bypass the 4 KiB stream bound.');
    const invalidUtf8 = await manual.fetch(new Request('https://import-runtime.invalid/api/v1/imports', { method: 'DELETE',
      headers: { Authorization: 'Bearer ' + historyJwt, 'X-Firebase-AppCheck': appCheckToken, 'Content-Type': 'application/json' },
      body: new Uint8Array([0xff, 0xfe]) }), environment);
    assert.equal(invalidUtf8.status, 422);
    assert.deepEqual(await attempts(), before);
    assert.equal((await db.prepare('SELECT history_deleted FROM import_jobs WHERE id=?').bind(queuedHistory).first<any>()).history_deleted, 0);
    const missing = randomUUID(), compact = JSON.stringify({ ids: [missing] });
    const boundary = await manual.fetch(new Request('https://import-runtime.invalid/api/v1/imports', { method: 'DELETE',
      headers: { Authorization: 'Bearer ' + historyJwt, 'X-Firebase-AppCheck': appCheckToken, 'Content-Type': 'application/json' },
      body: compact + ' '.repeat(4096 - new TextEncoder().encode(compact).length) }), environment);
    assert.equal(boundary.status, 200); assert.deepEqual(await boundary.json(), { deletedIds: [], unavailableIds: [missing] });
  });

  await t.test('history removal rechecks App Check, token revocation, account, membership and active company access', async () => {
    await resetHistoryBudget();
    await db.prepare("UPDATE import_jobs SET status='completed',lease_until=0 WHERE id=?").bind(queuedHistory).run();
    const before = await db.prepare('SELECT history_delete_attempts FROM import_daily WHERE day=?').bind(day).first();
    assert.equal((await request('imports/' + queuedHistory, historyJwt, 'DELETE', undefined, randomUUID(), { 'X-Firebase-AppCheck': '' })).status, 403);
    const account = users.get(historyOwner)!;
    try {
      account.validSince = String(Math.floor(Date.now() / 1000) + 1);
      assert.equal((await request('imports/' + queuedHistory, historyJwt, 'DELETE')).status, 401);
    } finally { account.validSince = '0'; }
    try {
      await seed('accountAccess/' + historyOwner, { blocked: true, changeId: 'history-blocked' });
      assert.equal((await request('imports/' + queuedHistory, historyJwt, 'DELETE')).status, 403);
      assert.equal((await request('imports/' + queuedHistory, historyKey, 'DELETE')).status, 403);
    } finally { await seed('accountAccess/' + historyOwner, { blocked: false, changeId: 'history-restored' }); }
    try {
      await seed('memberships/' + historyOwner, { active: false, companyId: 'company-a', changeId: 'history-revoked', version: 2 });
      assert.equal((await request('imports/' + queuedHistory, historyJwt, 'DELETE')).status, 403);
    } finally { await seed('memberships/' + historyOwner, { active: true, companyId: 'company-a', changeId: 'history-restored', version: 3 }); }
    const company = await read('companies/company-a');
    try {
      await seed('companies/company-a', { ...company, status: 'inactive' });
      assert.equal((await request('imports/' + queuedHistory, historyJwt, 'DELETE')).status, 403);
    } finally { await seed('companies/company-a', company); }
    assert.deepEqual(await db.prepare('SELECT history_delete_attempts FROM import_daily WHERE day=?').bind(day).first(), before);
    assert.equal((await db.prepare('SELECT history_deleted FROM import_jobs WHERE id=?').bind(queuedHistory).first<any>()).history_deleted, 0);
    const allowed = await request('imports/' + queuedHistory, historyJwt, 'DELETE');
    assert.equal(allowed.status, 200); assert.deepEqual(await allowed.json(), { deletedIds: [queuedHistory], unavailableIds: [] });
  });

  await t.test('bulk history removal reserves its whole shared budget atomically at the concurrent final slot', async () => {
    await resetHistoryBudget(199);
    const ids: string[] = [];
    for (let index = 0; index < 2; index++) ids.push(await seedJob('admin', clock + (100 + index) * 3600,
      [{ index: 0, kind: 'offer', success: true, message: 'Quota fixture' }], 1));
    const exceeds = await request('imports', adminJwt, 'DELETE', { ids });
    assert.equal(exceeds.status, 429); assert.ok(Number(exceeds.headers.get('Retry-After')) > 0);
    assert.equal((await db.prepare('SELECT history_delete_attempts FROM import_daily WHERE day=?').bind(day).first<any>()).history_delete_attempts, 199,
      'An oversized remaining reservation cannot consume only part of a batch.');
    for (const id of ids) assert.equal((await db.prepare('SELECT history_deleted FROM import_jobs WHERE id=?').bind(id).first<any>()).history_deleted, 0);
    const responses = await Promise.all(ids.map(id => request('imports/' + id, adminJwt, 'DELETE')));
    assert.equal(responses.filter(response => response.status === 200).length, 1);
    assert.equal(responses.filter(response => response.status === 429).length, 1);
    const admitted = await responses.find(response => response.status === 200)!.json() as any;
    assert.equal(admitted.deletedIds.length, 1); assert.deepEqual(admitted.unavailableIds, []);
    assert.equal((await db.prepare('SELECT history_delete_attempts FROM import_daily WHERE day=?').bind(day).first<any>()).history_delete_attempts, 200);
    const rows = await Promise.all(ids.map(id => db.prepare('SELECT history_deleted FROM import_jobs WHERE id=?').bind(id).first<any>()));
    assert.deepEqual(rows.map((row: { history_deleted: number }) => row.history_deleted).sort(), [0, 1], 'The denied concurrent request changes no history.');
    const retry = await request('imports', adminJwt, 'DELETE', { ids });
    assert.equal(retry.status, 429); assert.deepEqual(await Promise.all(ids.map(id => db.prepare('SELECT history_deleted FROM import_jobs WHERE id=?').bind(id).first())), rows);
    const beforeFirebase = firebaseRequests;
    await scheduler.scheduled(environment);
    assert.equal(firebaseRequests, beforeFirebase, 'Retention cleanup shares the same exhausted 200-attempt reserve.');
  });

  await t.test('three thousand hidden histories leave bounded indexed lists and zero job reads on quota denial', async () => {
    await resetHistoryBudget();
    const uid = 'history-scan-budget', token = jwt(uid, false, { iat: clock, auth_time: clock });
    await seed('accountAccess/' + uid, { blocked: false, changeId: 'visible-history-fixture' });
    await seed('memberships/' + uid, { active: true, companyId: 'company-a', changeId: 'visible-history-fixture', version: 1 });
    const key = await request('api-key', token, 'POST');
    assert.equal(key.status, 201);
    await db.prepare('UPDATE import_keys SET expires_at=? WHERE uid=?').bind(clock + 200 * 86400, uid).run();
    // Place the hidden rows ahead of every visible row; a non-partial owner or
    // global ordering index would have to visit the entire hidden backlog first.
    await db.prepare('UPDATE import_jobs SET history_deleted=1,created_at=created_at+? WHERE owner_uid=?').bind(4000 * 3600, uid).run();
    assert.ok((await db.prepare('SELECT COUNT(*) AS n FROM import_jobs WHERE owner_uid=? AND history_deleted=1').bind(uid).first<{ n: number }>())!.n >= 3000);
    const visible: string[] = [];
    for (let index = 0; index < 30; index++) visible.push(await seedJob(uid, clock + (3200 + index) * 3600,
      [{ index: 0, kind: 'offer', success: true, message: 'Visible after backlog' }], 1));
    for (const [caller, column, index, owner, readBound] of [
      [token, 'access_checks', 'import_jobs_visible_owner', uid, 30],
      [adminJwt, 'admin_access_checks', 'import_jobs_visible_created', null, 90],
    ] as const) {
      await resetHistoryBudget();
      const sql = 'SELECT id,status,total,cursor,created_at,updated_at,succeeded,failed FROM import_jobs INDEXED BY ' + index +
        ' WHERE history_deleted=0 ' + (owner ? 'AND owner_uid=? ' : '') + 'ORDER BY created_at DESC LIMIT 30';
      const plan = await (owner ? db.prepare('EXPLAIN QUERY PLAN ' + sql).bind(owner) : db.prepare('EXPLAIN QUERY PLAN ' + sql)).all<{ detail: string }>();
      assert.ok(plan.results.some((row: { detail: string }) => row.detail.includes(index)));
      assert.ok(plan.results.every((row: { detail: string }) => !row.detail.includes('USE TEMP B-TREE')));
      historyRowsRead = -1;
      const response = await scheduler.fetch(new Request('https://import-runtime.invalid/api/v1/imports',
        { headers: { Authorization: 'Bearer ' + caller, 'X-Firebase-AppCheck': appCheckToken } }), observed);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json() as any).jobs.map((entry: { id: string }) => entry.id), [...visible].reverse());
      assert.ok(historyRowsRead > 0 && historyRowsRead <= readBound, index + ' must skip the hidden backlog.');
      t.diagnostic(JSON.stringify({ hiddenHistoryRows: 3000, role: owner ? 'manager' : 'admin', historyRowsRead, plan: plan.results }));
      batches.length = 0; historyRowsRead = -1;
      beforeBatch = async batch => {
        if (batch === 2) await db.prepare('UPDATE import_daily SET ' + column + '=500 WHERE day=?').bind(day).run();
      };
      try {
        const denied = await scheduler.fetch(new Request('https://import-runtime.invalid/api/v1/imports',
          { headers: { Authorization: 'Bearer ' + caller, 'X-Firebase-AppCheck': appCheckToken } }), observed);
        assert.equal(denied.status, 429); assert.equal(historyRowsRead, 0, 'The raced exhausted live quota opens no visible or hidden job scan.');
      } finally { beforeBatch = undefined; }
    }
  });
});
