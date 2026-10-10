import type { AnalyticsDatabase } from './analytics.ts';
import { ApiError, boundedText, createTokenVerifier, type VerifiedIdentity } from './firebase.ts';
import { createImportFirebase, digest } from './importFirebase.ts';
import { IMPORT_LIMITS, normalizeImportPayload, validateImportEnvelope, type ApiKeyMetadata, type ImportPayload, type ImportItemResult, type ImportJobSummary } from '../src/domain/apiImports.ts';

export interface ImportEnv {
  ANALYTICS_DB?: AnalyticsDatabase; FIREBASE_PROJECT_ID: string; FIREBASE_WEB_API_KEY?: string; FIREBASE_IMPORT_SERVICE_ACCOUNT?: string;
  IMPORT_QUEUE?: { send(body: { id: string; cursor: number } | { maintenance: 'imports' | 'analytics' }): Promise<void> };
  IMPORT_RATE_LIMIT?: { limit(input: { key: string }): Promise<{ success: boolean }> };
}
interface KeyRow { uid: string; hash: string; prefix: string; role: 'admin' | 'manager'; company_id: string | null; fingerprint: string; valid_since: number; created_at: number; expires_at: number }
interface JobRow { id: string; owner_uid: string; key_hash: string; fingerprint: string; payload: string | null; payload_hash: string; status: ImportJobSummary['status']; total: number; cursor: number; results: string; created_at: number; updated_at: number; expires_at: number; lease_until: number; attempts: number; error: string | null }
type JobSummaryRow = Pick<JobRow, 'id' | 'status' | 'total' | 'cursor' | 'created_at' | 'updated_at'> & { succeeded: number; failed: number };
type JobDetailRow = Pick<JobRow, 'id' | 'status' | 'total' | 'cursor' | 'created_at' | 'updated_at' | 'results' | 'error'>;
type JobReplayRow = JobSummaryRow & Pick<JobRow, 'payload_hash'> & { history_deleted: number };
export interface ImportMessage { body: unknown; ack(): void; retry(options?: { delaySeconds: number }): void }
const active = "status IN ('queued','processing')";
const summaryColumns = 'id,status,total,cursor,created_at,updated_at';
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
function json(value: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
}
function summary(job: JobDetailRow | JobSummaryRow, detail = false): ImportJobSummary & { error?: string } {
  const results = 'results' in job ? JSON.parse(job.results) as ImportItemResult[] : [];
  return { id: job.id, status: job.status, total: job.total, processed: job.cursor, succeeded: 'succeeded' in job ? job.succeeded : results.filter(result => result.success).length,
    failed: 'failed' in job ? job.failed : results.filter(result => !result.success).length, createdAt: iso(job.created_at), updatedAt: iso(job.updated_at),
    ...(detail ? { results, ...('error' in job && job.error ? { error: job.error } : {}) } : {}) };
}
export function createImportApi(fetcher: typeof fetch = fetch, now: () => Date = () => new Date()) {
  const firebase = createImportFirebase(fetcher, now);
  const verify = createTokenVerifier(fetcher, now);
  const seconds = () => Math.floor(now().getTime() / 1000);
  function configured(env: ImportEnv) {
    if (!env.ANALYTICS_DB || !env.FIREBASE_IMPORT_SERVICE_ACCOUNT || !env.IMPORT_QUEUE) throw new ApiError(503, 'API імпорту ще не активовано.');
    return env.ANALYTICS_DB;
  }
  function exhaustedBudget(): never {
    throw new ApiError(429, 'Денний ліміт перевірок API вичерпано. Спробуйте завтра (UTC).', 86400 - seconds() % 86400);
  }
  async function preliminaryBudget(db: AnalyticsDatabase, uid: string, key: KeyRow | null) {
    const day = now().toISOString().slice(0, 10);
    const known = key && key.expires_at > seconds() ? key : null;
    const limit = known ? known.role === 'admin' ? IMPORT_LIMITS.dailyAdminUidChecks : IMPORT_LIMITS.dailyManagerUidChecks : IMPORT_LIMITS.dailyUnrecognizedUidChecks;
    // A stored key selects only a quota; live Firebase permissions still decide access.
    const column = known ? known.role === 'admin' ? 'admin_preflight_checks' : 'manager_preflight_checks' : 'unknown_preflight_checks';
    const globalLimit = known ? known.role === 'admin' ? IMPORT_LIMITS.dailyAdminAccessChecks : IMPORT_LIMITS.dailyManagerAccessChecks : 100;
    const liveReserve = known ? known.role === 'admin' ? ' AND admin_access_checks<' + IMPORT_LIMITS.dailyAdminAccessChecks : ' AND access_checks<' + IMPORT_LIMITS.dailyManagerAccessChecks : '';
    // changes() prevents even a new UID row once the shared reserve is exhausted.
    const [reserved, result] = await db.batch([
      db.prepare(`INSERT INTO import_daily(day,${column}) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET ${column}=${column}+1 WHERE ${column}<?${liveReserve} RETURNING day`)
        .bind(day, globalLimit),
      db.prepare('INSERT INTO import_access_daily(day,uid,checks,limit_checks) SELECT ?,?,1,? WHERE changes()=1 ON CONFLICT(day,uid) DO UPDATE SET checks=checks+1,limit_checks=MAX(limit_checks,excluded.limit_checks) WHERE checks<MAX(limit_checks,excluded.limit_checks) RETURNING uid')
        .bind(day, uid, limit),
    ]);
    if (!reserved.results.length || !result.results.length) exhaustedBudget();
    return result.meta.size_after || 0;
  }
  function budget(db: AnalyticsDatabase, role: 'admin' | 'manager') {
    const column = role === 'admin' ? 'admin_access_checks' : 'access_checks';
    const limit = role === 'admin' ? IMPORT_LIMITS.dailyAdminAccessChecks : IMPORT_LIMITS.dailyManagerAccessChecks;
    return db.prepare(`INSERT INTO import_daily(day,${column}) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET ${column}=${column}+1 WHERE ${column}<? RETURNING day`)
      .bind(now().toISOString().slice(0, 10), limit);
  }
  async function authorize(request: Request, env: ImportEnv, jwtOnly = false) {
    const db = configured(env);
    if (env.IMPORT_RATE_LIMIT && !(await env.IMPORT_RATE_LIMIT.limit({ key: 'ip:' + (request.headers.get('CF-Connecting-IP') || 'unknown') })).success) throw new ApiError(429, 'Забагато запитів. Спробуйте через хвилину.');
    const bearer = /^Bearer (\S{1,8192})$/.exec(request.headers.get('Authorization') || '')?.[1];
    if (!bearer) throw new ApiError(401, 'Потрібен Authorization: Bearer.');
    let uid: string;
    let authTime: number | undefined;
    let identity: VerifiedIdentity | undefined;
    let key: KeyRow | null;
    let nextAllowed: number | null = null;
    if (bearer.startsWith('kg_api_')) {
      if (jwtOnly || !/^kg_api_[A-Za-z0-9_-]{43}$/.test(bearer)) throw new ApiError(401, 'Потрібна сесія кабінету.');
      key = await db.prepare('SELECT * FROM import_keys WHERE hash=?').bind(await digest(bearer)).first<KeyRow>();
      if (!key || key.expires_at <= seconds()) throw new ApiError(401, 'Ключ недійсний або прострочений.');
      uid = key.uid;
    } else {
      identity = await verify(bearer, env.FIREBASE_PROJECT_ID, env.FIREBASE_WEB_API_KEY, true);
      uid = identity.uid;
      authTime = identity.authTime;
      if (jwtOnly && request.method === 'GET') {
        // This informational cooldown snapshot never replaces the atomic import trigger.
        // Starting with the UID preserves cooldown metadata even when its key was revoked.
        const row = await db.prepare('SELECT k.*,l.next_allowed FROM (SELECT ? AS uid) AS caller LEFT JOIN import_keys AS k ON k.uid=caller.uid LEFT JOIN import_limits AS l ON l.uid=caller.uid')
          .bind(uid).first<KeyRow & { next_allowed: number | null }>();
        key = row?.uid ? row : null;
        nextAllowed = row?.next_allowed ?? null;
      } else key = await db.prepare('SELECT * FROM import_keys WHERE uid=?').bind(uid).first<KeyRow>();
    }
    if (env.IMPORT_RATE_LIMIT && !(await env.IMPORT_RATE_LIMIT.limit({ key: 'uid:' + uid })).success) throw new ApiError(429, 'Забагато запитів для цього акаунта. Спробуйте через хвилину.');
    const databaseSize = await preliminaryBudget(db, uid, key);
    const scope = identity?.validSince !== undefined
      ? await firebase.scopeForSession(env.FIREBASE_PROJECT_ID, bearer, identity, request.headers.get('X-Firebase-AppCheck') || undefined)
      : await firebase.scope(env.FIREBASE_PROJECT_ID, env.FIREBASE_IMPORT_SERVICE_ACCOUNT!, uid, db, false, identity);
    if (authTime !== undefined && authTime < scope.validSince) throw new ApiError(401, 'Сесію відкликано. Увійдіть знову.');
    if (authTime === undefined && key?.fingerprint !== scope.fingerprint) throw new ApiError(403, 'Права змінилися. Оновіть API-ключ у кабінеті.');
    // Read-only imports reserve the same live-role quota atomically with their gated read.
    if (jwtOnly || request.method !== 'GET') {
      if (!(await budget(db, scope.role).all()).results.length) exhaustedBudget();
    }
    return { db, scope, key, authTime, databaseSize, nextAllowed };
  }
  async function dispatch(env: ImportEnv, id: string, cursor: number) {
    const db = configured(env);
    // The durable job is the outbox; a failed send is recovered by the cron.
    // Keep these adjacent in one D1 transaction: changes() refers to the job claim.
    const [claimed, budget] = await db.batch([
      db.prepare('UPDATE import_jobs SET dispatch_at=? WHERE id=? AND cursor=? AND ' + active + ' RETURNING id').bind(seconds() + 300, id, cursor),
      db.prepare('INSERT INTO import_daily(day,dispatches) SELECT ?,1 WHERE changes()=1 ON CONFLICT(day) DO UPDATE SET dispatches=dispatches+1 WHERE dispatches<? RETURNING day')
        .bind(now().toISOString().slice(0, 10), IMPORT_LIMITS.dailyQueueMessages),
    ]);
    if (!claimed.results.length) return;
    if (!budget.results.length) {
      await db.prepare('UPDATE import_jobs SET dispatch_at=?,error=? WHERE id=? AND ' + active)
        .bind(seconds() + 86400 - seconds() % 86400, 'Денний ліміт черги вичерпано; завдання збережено до наступної доби UTC.', id).all();
      return;
    }
    try { await env.IMPORT_QUEUE!.send({ id, cursor }); }
    catch { await db.prepare('UPDATE import_jobs SET dispatch_at=? WHERE id=? AND cursor=? AND ' + active).bind(seconds() + 60, id, cursor).all(); }
  }
  async function terminal(db: AnalyticsDatabase, id: string, status: string, message: string) {
    await db.prepare('UPDATE import_jobs SET status=?,payload=NULL,error=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND ' + active)
      .bind(status, message, seconds(), id).all();
  }
  async function progress(db: AnalyticsDatabase, job: JobRow, lease: string, results: ImportItemResult[]) {
    const next = results.length, complete = next >= job.total;
    const failed = results.filter(result => !result.success).length;
    const status = complete ? failed === 0 ? 'completed' : failed === next ? 'failed' : 'partial' : 'queued';
    await db.prepare('UPDATE import_jobs SET cursor=?,results=?,status=CASE WHEN status=\'cancelled\' THEN status ELSE ? END,payload=CASE WHEN ? OR status=\'cancelled\' THEN NULL ELSE payload END,error=CASE WHEN status=\'cancelled\' THEN error ELSE NULL END,attempts=0,lease_token=NULL,lease_until=0,dispatch_at=0,updated_at=? WHERE id=? AND lease_token=?')
      .bind(next, JSON.stringify(results), status, complete ? 1 : 0, seconds(), job.id, lease).all();
    return { next, complete };
  }
  return {
    async refreshCredentials(env: ImportEnv) {
      const db = configured(env);
      await firebase.refreshCredentials(env.FIREBASE_PROJECT_ID, env.FIREBASE_IMPORT_SERVICE_ACCOUNT!, db);
    },
    async fetch(request: Request, env: ImportEnv): Promise<Response> {
      try {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin) throw new ApiError(403, 'Дозволені запити з кабінету або серверного програмного забезпечення.');
        const keyPath = url.pathname === '/api/v1/api-key';
        const jobId = /^\/api\/v1\/imports\/([0-9a-f-]{36})$/.exec(url.pathname)?.[1];
        if (!keyPath && !jobId && url.pathname !== '/api/v1/imports') throw new ApiError(404, 'Endpoint не знайдено.');
        if (keyPath ? !['GET','POST','DELETE'].includes(request.method) : jobId ? !['GET','DELETE'].includes(request.method) : !['GET','POST','DELETE'].includes(request.method)) throw new ApiError(405, 'Метод не підтримується.');
        if (request.method === 'POST' && url.pathname === '/api/v1/imports' && Number(request.headers.get('Content-Length')) > IMPORT_LIMITS.bytes) throw new ApiError(413, 'Завеликий запит.');
        if (request.method === 'DELETE' && !keyPath && !jobId && Number(request.headers.get('Content-Length')) > IMPORT_LIMITS.historyDeleteBytes) throw new ApiError(413, 'Завеликий запит.');
        const { db, scope, key, authTime, databaseSize, nextAllowed } = await authorize(request, env, keyPath);
        if (keyPath) {
          if (request.method === 'GET') {
            const metadata: ApiKeyMetadata | null = key ? { prefix: key.prefix, role: key.role, companyId: key.company_id,
              createdAt: iso(key.created_at), expiresAt: iso(key.expires_at), requiresRotation: key.fingerprint !== scope.fingerprint || key.expires_at <= seconds() } : null;
            return json({ key: metadata, role: scope.role, companyId: scope.companyId, nextImportAt: nextAllowed === null ? null : iso(nextAllowed), limits: IMPORT_LIMITS });
          }
          if (authTime === undefined || seconds() - authTime > 300) throw new ApiError(401, 'Для зміни ключа підтвердьте вхід ще раз.');
          if (request.method === 'POST' && !key && databaseSize >= 450 * 1024 * 1024) throw new ApiError(429, 'База імпорту очікує очищення. Спробуйте через годину.', 3600);
          const plaintext = 'kg_api_' + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
          const created = seconds(), expiry = created + 90 * 86400;
          const mutations = [db.prepare("UPDATE import_jobs INDEXED BY import_jobs_pending SET status='cancelled',payload=NULL,error='Ключ відкликано або оновлено.',updated_at=? WHERE owner_uid=? AND " + active).bind(created, scope.uid),
            db.prepare('DELETE FROM import_keys WHERE uid=?').bind(scope.uid)];
          if (request.method === 'POST') mutations.push(db.prepare('INSERT INTO import_keys(uid,hash,prefix,role,company_id,fingerprint,valid_since,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)')
            .bind(scope.uid, await digest(plaintext), plaintext.slice(0, 15), scope.role, scope.companyId, scope.fingerprint, scope.validSince, created, expiry));
          await db.batch(mutations);
          return request.method === 'DELETE' ? json({ revoked: true }) : json({ key: plaintext, metadata: { prefix: plaintext.slice(0, 15), role: scope.role, companyId: scope.companyId, createdAt: iso(created), expiresAt: iso(expiry), requiresRotation: false } }, 201);
        }
        if (request.method === 'GET') {
          if (jobId) {
            const [reserved, result] = await db.batch<JobDetailRow | { day: string }>([budget(db, scope.role),
              db.prepare('SELECT ' + summaryColumns + ',results,error FROM import_jobs WHERE id=? AND history_deleted=0 AND (?=\'admin\' OR owner_uid=?) LIMIT CASE WHEN changes()=1 THEN 1 ELSE 0 END').bind(jobId, scope.role, scope.uid)]);
            if (!reserved.results.length) exhaustedBudget();
            const job = result.results[0] as JobDetailRow | undefined;
            if (!job) throw new ApiError(404, 'Імпорт не знайдено.');
            return json(summary(job, true));
          }
          // LIMIT 0 stops before opening the job scan; a WHERE gate still scans on denial.
          const query = db.prepare('SELECT ' + summaryColumns + ',succeeded,failed FROM import_jobs INDEXED BY ' +
            (scope.role === 'admin' ? 'import_jobs_visible_created' : 'import_jobs_visible_owner') + ' WHERE history_deleted=0 ' +
            (scope.role === 'admin' ? '' : 'AND owner_uid=? ') + 'ORDER BY created_at DESC LIMIT CASE WHEN changes()=1 THEN 30 ELSE 0 END');
          const [reserved, jobs] = await db.batch<JobSummaryRow | { day: string }>([budget(db, scope.role), scope.role === 'admin' ? query : query.bind(scope.uid)]);
          if (!reserved.results.length) exhaustedBudget();
          return json({ jobs: (jobs.results as JobSummaryRow[]).map(job => summary(job)) });
        }
        if (request.method === 'DELETE') {
          let ids: string[];
          if (jobId) ids = [jobId];
          else {
            if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('Content-Type') || '')) throw new ApiError(415, 'Потрібен Content-Type: application/json.');
            let value: { ids?: unknown };
            try { value = JSON.parse(await boundedText(new Response(request.body, { headers: request.headers }), IMPORT_LIMITS.historyDeleteBytes)); }
            catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(422, 'Некоректний JSON.'); }
            if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !Array.isArray(value.ids) || !value.ids.length ||
              value.ids.length > IMPORT_LIMITS.historyDeleteItems || value.ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) ||
              new Set(value.ids).size !== value.ids.length) throw new ApiError(422, 'Передайте від 1 до 30 унікальних ID імпортів у полі ids.');
            ids = value.ids;
          }
          // Keep idempotency and receipts until normal retention; deleting history never reimports products.
          const [reserved, removed] = await db.batch<{ id: string } | { day: string }>([
            db.prepare('INSERT INTO import_daily(day,history_delete_attempts) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET history_delete_attempts=history_delete_attempts+excluded.history_delete_attempts WHERE history_delete_attempts+excluded.history_delete_attempts<=200 RETURNING day')
              .bind(now().toISOString().slice(0, 10), ids.length),
            db.prepare("UPDATE import_jobs SET history_deleted=1 WHERE changes()=1 AND id IN (" + ids.map(() => '?').join(',') + ") AND (?='admin' OR owner_uid=?) AND status NOT IN ('queued','processing') AND lease_until<=? RETURNING id")
              .bind(...ids, scope.role, scope.uid, seconds()),
          ]);
          if (!reserved.results.length) throw new ApiError(429, 'Денний ліміт видалення історії вичерпано. Спробуйте завтра (UTC).', 86400 - seconds() % 86400);
          const deletedIds = (removed.results as { id: string }[]).map(row => row.id);
          return json({ deletedIds, unavailableIds: ids.filter(id => !deletedIds.includes(id)) });
        }
        if (!key || key.expires_at <= seconds() || key.fingerprint !== scope.fingerprint) throw new ApiError(403, 'Спочатку створіть актуальний API-ключ у кабінеті.');
        if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('Content-Type') || '')) throw new ApiError(415, 'Потрібен Content-Type: application/json.');
        const idempotency = request.headers.get('Idempotency-Key') || '';
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(idempotency)) throw new ApiError(422, 'Потрібен Idempotency-Key: унікальний ID запиту (1–128 символів).');
        let serialized: string, value: unknown, envelope: ReturnType<typeof validateImportEnvelope>;
        try {
          serialized = await boundedText(new Response(request.body, { headers: request.headers }), IMPORT_LIMITS.bytes);
          value = JSON.parse(serialized);
          envelope = validateImportEnvelope(value);
        }
        catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(422, error instanceof Error ? error.message : 'Некоректний JSON.'); }
        if (scope.role !== 'admin' && envelope.companies.length) throw new ApiError(403, 'Компанії додає лише адміністратор.');
        // New jobs retain original JSON bytes. Existing normalized jobs keep their original retry semantics.
        const hash = 'raw:' + await digest(serialized);
        let legacyHash: string | undefined;
        async function matches(job: JobReplayRow) {
          if (job.payload_hash.startsWith('raw:')) return job.payload_hash === hash;
          try { legacyHash ??= await digest(JSON.stringify(normalizeImportPayload(value))); }
          catch (error) { throw new ApiError(422, error instanceof Error ? error.message : 'Некоректний JSON.'); }
          return job.payload_hash === legacyHash;
        }
        const replay = () => db.prepare('SELECT ' + summaryColumns + ',payload_hash,succeeded,failed,history_deleted FROM import_jobs WHERE owner_uid=? AND idempotency=?')
          .bind(scope.uid, idempotency).first<JobReplayRow>();
        const existing = await replay();
        if (existing) {
          if (!await matches(existing)) throw new ApiError(409, 'Idempotency-Key вже використано для іншого JSON.');
          if (existing.history_deleted) throw new ApiError(409, 'Цей імпорт видалено з історії. Для нового імпорту використайте новий Idempotency-Key.');
          return json({ ...summary(existing), statusUrl: '/api/v1/imports/' + existing.id }, 202);
        }
        if (databaseSize >= 450 * 1024 * 1024) throw new ApiError(429, 'База імпорту очікує очищення. Спробуйте через годину.', 3600);
        const id = crypto.randomUUID(), time = seconds();
        let accepted: JobReplayRow | undefined;
        try {
          const inserted = await db.prepare('INSERT INTO import_jobs(id,owner_uid,key_hash,fingerprint,idempotency,payload_hash,payload,total,interval_seconds,created_at,updated_at,expires_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM import_jobs WHERE owner_uid=? AND idempotency=?) RETURNING ' + summaryColumns + ',payload_hash,history_deleted,0 AS succeeded,0 AS failed')
            .bind(id, scope.uid, key.hash, scope.fingerprint, idempotency, hash, serialized, envelope.companies.length + envelope.offers.length,
              scope.role === 'admin' ? IMPORT_LIMITS.adminInterval : IMPORT_LIMITS.managerInterval, time, time, time + IMPORT_LIMITS.lifetime, scope.uid, idempotency).all<JobReplayRow>();
          accepted = inserted.results[0];
        } catch (error) {
          const message = String(error);
          if (message.includes('IMPORT_KEY_CHANGED')) throw new ApiError(403, 'Ключ змінився. Повторіть запит з актуальним ключем.');
          if (/IMPORT_(COOLDOWN|ACTIVE|BUSY|BUDGET)/.test(message)) {
            const limit = await db.prepare('SELECT next_allowed FROM import_limits WHERE uid=?').bind(scope.uid).first<{ next_allowed: number }>();
            const retry = message.includes('BUDGET') ? 86400 - time % 86400 : Math.max(60, (limit?.next_allowed || time) - time);
            throw new ApiError(429, message.includes('COOLDOWN') ? 'Ще не минув інтервал між імпортами.' : message.includes('ACTIVE') ? 'Попередній імпорт ще виконується.' : 'Черга або денний ліміт імпорту заповнені.', retry);
          }
          throw error;
        }
        accepted ??= await replay() ?? undefined;
        if (!accepted || !await matches(accepted)) throw new ApiError(409, 'Idempotency-Key вже використано.');
        if (accepted.history_deleted) throw new ApiError(409, 'Цей імпорт видалено з історії. Для нового імпорту використайте новий Idempotency-Key.');
        if (accepted.id === id) await dispatch(env, id, 0);
        return json({ ...summary(accepted), statusUrl: '/api/v1/imports/' + accepted.id }, 202);
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 503;
        return json({ error: { code: 'HTTP_' + status, message: error instanceof ApiError ? error.message : 'API тимчасово недоступне. Спробуйте пізніше.' } }, status,
          status === 429 || error instanceof ApiError && error.retryAfter ? { 'Retry-After': String(error instanceof ApiError ? error.retryAfter || 60 : 60) } : {});
      }
    },
    async queue(batch: { messages: ImportMessage[] }, env: ImportEnv) {
      const db = configured(env);
      for (const message of batch.messages) {
        const body = message.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) { message.ack(); continue; }
        const id = 'id' in body ? body.id : undefined, cursor = 'cursor' in body ? body.cursor : undefined;
        if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id) || typeof cursor !== 'number' || !Number.isSafeInteger(cursor) || cursor < 0 || cursor >= IMPORT_LIMITS.items) { message.ack(); continue; }
        const lease = crypto.randomUUID(), time = seconds();
        const claimed = await db.prepare("UPDATE import_jobs SET status='processing',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=? AND cursor=? AND lease_until<=? AND " + active + ' RETURNING *')
          .bind(lease, time + 600, time, id, cursor, time).all<JobRow>();
        const job = claimed.results[0];
        if (!job) { message.ack(); continue; }
        try {
          const key = await db.prepare('SELECT * FROM import_keys WHERE uid=? AND hash=? AND expires_at>?').bind(job.owner_uid, job.key_hash, time).first<KeyRow>();
          if (!key) throw new ApiError(403, 'Ключ відкликаний або прострочений.');
          if (job.expires_at <= time || job.attempts > IMPORT_LIMITS.retries + 1) {
            await terminal(db, id, 'failed', 'Імпорт прострочений або вичерпав повторні спроби.'); message.ack(); continue;
          }
          let payload: ImportPayload;
          if (job.payload_hash.startsWith('raw:')) {
            try { payload = normalizeImportPayload(JSON.parse(job.payload!)); }
            catch (error) {
              await terminal(db, id, 'failed', 'HTTP_422: ' + (error instanceof Error ? error.message : 'Некоректний JSON.'));
              message.ack(); continue;
            }
          } else payload = JSON.parse(job.payload!) as ImportPayload;
          const results = await firebase.process(env.FIREBASE_PROJECT_ID, env.FIREBASE_IMPORT_SERVICE_ACCOUNT!, job.owner_uid, job.fingerprint, id, payload, cursor, db);
          const { next, complete } = await progress(db, job, lease, results);
          if (!complete) await dispatch(env, id, next);
          message.ack();
        } catch (error) {
          if (error instanceof ApiError && error.status === 403 || job.attempts >= IMPORT_LIMITS.retries + 1) {
            try {
              const receipt = await firebase.receipt(env.FIREBASE_PROJECT_ID, env.FIREBASE_IMPORT_SERVICE_ACCOUNT!, id, db);
              if (receipt && receipt.length > cursor) {
                const recovered = await progress(db, job, lease, receipt);
                if (error instanceof ApiError && error.status === 403) await terminal(db, id, 'cancelled', error.message);
                else if (!recovered.complete) await dispatch(env, id, recovered.next);
                message.ack(); continue;
              }
            } catch { /* The terminal message warns that the last commit may be ambiguous. */ }
          }
          if (error instanceof ApiError && error.status === 403) { await terminal(db, id, 'cancelled', error.message); message.ack(); }
          else if (job.attempts >= IMPORT_LIMITS.retries + 1) { await terminal(db, id, 'failed', 'Firebase недоступний після повторних спроб. Остання порція могла бути записана: звірте каталог перед новим імпортом.'); message.ack(); }
          else {
            await db.prepare('UPDATE import_jobs SET lease_token=NULL,lease_until=0,dispatch_at=?,updated_at=? WHERE id=? AND lease_token=?')
              .bind(seconds() + 300, seconds(), id, lease).all();
            message.retry({ delaySeconds: 60 });
          }
        }
      }
    },
    async scheduled(env: ImportEnv) {
      if (!env.FIREBASE_IMPORT_SERVICE_ACCOUNT || !env.IMPORT_QUEUE || !env.ANALYTICS_DB) return;
      const db = env.ANALYTICS_DB, time = seconds(), day = now().toISOString().slice(0, 10);
      const [cleanup, , pending] = await db.batch<{ id: string; cursor: number }>([
        db.prepare('INSERT INTO import_daily(day,cleanup_claimed) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET cleanup_claimed=1 WHERE cleanup_claimed=0 RETURNING day').bind(day),
        db.prepare("UPDATE import_jobs SET status='failed',payload=NULL,error='Імпорт не завершився за 24 години.',updated_at=? WHERE expires_at<=? AND lease_until<=? AND " + active).bind(time, time, time),
        db.prepare('SELECT id,cursor FROM import_jobs WHERE dispatch_at<=? AND lease_until<=? AND ' + active + ' ORDER BY created_at LIMIT 5').bind(time, time),
      ]);
      // Claim before cleanup: retries cannot repeat writes after a partial failure.
      if (cleanup.results.length) await db.batch([
        db.prepare('DELETE FROM import_keys WHERE uid IN (SELECT uid FROM import_keys INDEXED BY import_keys_expiry WHERE expires_at<=? ORDER BY expires_at LIMIT 200)').bind(time),
        db.prepare('DELETE FROM import_limits WHERE uid IN (SELECT uid FROM import_limits INDEXED BY import_limits_expiry WHERE next_allowed<=? ORDER BY next_allowed LIMIT 200)').bind(time),
        db.prepare('DELETE FROM import_access_daily WHERE rowid IN (SELECT rowid FROM import_access_daily WHERE day<? LIMIT 1100)').bind(new Date((time - 2 * 86400) * 1000).toISOString().slice(0, 10)),
        db.prepare('DELETE FROM import_daily WHERE day IN (SELECT day FROM import_daily WHERE day<? LIMIT 32)').bind(new Date((time - IMPORT_LIMITS.retentionDays * 86400) * 1000).toISOString().slice(0, 10)),
      ]);
      for (const job of pending.results) await dispatch(env, job.id, job.cursor);
      const expired = await db.prepare("SELECT id FROM import_jobs WHERE created_at<? AND status NOT IN ('queued','processing') LIMIT 5").bind(time - IMPORT_LIMITS.retentionDays * 86400).all<{ id: string }>();
      for (const job of expired.results) {
        const reserved = await db.prepare('INSERT INTO import_daily(day,history_delete_attempts) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET history_delete_attempts=history_delete_attempts+1 WHERE history_delete_attempts<200 RETURNING day').bind(day).all();
        if (!reserved.results.length) break;
        await firebase.deleteReceipt(env.FIREBASE_PROJECT_ID, env.FIREBASE_IMPORT_SERVICE_ACCOUNT, job.id, db);
        await db.prepare('DELETE FROM import_jobs WHERE id=?').bind(job.id).all();
      }
    },
  };
}
