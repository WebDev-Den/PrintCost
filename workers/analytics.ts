import { PUBLIC_FILAMENTS_CATALOG, buildConcreteFilamentSkus, type PublicFilamentItem } from '../src/domain/filamentsDirectory.ts';
import { ApiError, boundedText, createFirebaseReader, createTokenVerifier, type Document } from './firebase.ts';

const EVENT_TYPES = ['search', 'filter', 'no_results', 'impression', 'details', 'seller_click', 'add_material'] as const;
const MATERIAL_TYPES = ['all', 'PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'PLA-CF', 'PETG-CF', 'PA-CF', 'PVA', 'HIPS', 'other'] as const;
const DAILY_EVENT_LIMIT = 4000;
export type EventType = typeof EVENT_TYPES[number];
type Counts = Record<EventType, number>;
export interface AnalyticsEvent {
  id: string; type: EventType; offerId?: string; materialType?: typeof MATERIAL_TYPES[number];
  packaging?: 'all' | 'spool' | 'refill'; stock?: 'all' | 'in_stock' | 'out_of_stock'; hasSearch?: boolean; resultCount?: number;
}
interface Result<T = Record<string, unknown>> { results: T[]; meta: { changes?: number; rows_read?: number; rows_written?: number }; success: boolean }
interface Statement { bind(...values: (string | number | null)[]): Statement; all<T = Record<string, unknown>>(): Promise<Result<T>>; first<T = Record<string, unknown>>(): Promise<T | null> }
export interface AnalyticsDatabase { prepare(sql: string): Statement; batch<T = Record<string, unknown>>(statements: Statement[]): Promise<Result<T>[]> }
export interface AnalyticsEnv {
  ANALYTICS_DB?: AnalyticsDatabase;
  ANALYTICS_RATE_LIMIT?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  FIREBASE_PROJECT_ID: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}
interface Context { waitUntil(promise: Promise<unknown>): void }
export interface AnalyticsReport {
  companyId: string | null; from: string; to: string; totals: Counts;
  days: { day: string; counts: Counts }[];
  offers: { offerId: string; companyId: string | null; name: string | null; counts: Counts }[];
  offersLimit: number; offersTruncated: boolean; offersScanLimited: boolean;
  filters: { materialType: string; packaging: string; stock: string; hasSearch: boolean; counts: Counts }[];
  filtersLimit: number; filtersTruncated: boolean;
  budget: { day: string; accepted: number | null; limit: number }; notice: string;
}

let dayFormatter: Intl.DateTimeFormat | undefined;
function localDay(date: Date): string {
  return (dayFormatter ??= new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' })).format(date);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9_-]{1,200}$/;
const fields = ['id', 'type', 'offerId', 'materialType', 'packaging', 'stock', 'hasSearch', 'resultCount'];
const sumColumns = EVENT_TYPES.map(type => `SUM(${type}) AS ${type}`).join(', ');
const countScore = EVENT_TYPES.join('+');
const notice = 'Виміряна активність, не продажі. Підсумки й дні повні; пропозиції та фільтри — до 100 груп за період. Деталізація пропозицій доступна до 20 000 денних рядків: для більшого обсягу звузьте період. Дні звіту: Europe/Kyiv; спільна квота: UTC. Дедуплікація й детальні події: 30 днів; агрегати: 12 місяців. Дані звіту можуть затримуватися до 60 секунд.';
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' } });
}
function emptyCounts(): Counts { return Object.fromEntries(EVENT_TYPES.map(type => [type, 0])) as Counts; }
function retentionStart(date: Date) {
  const expiry = new Date(`${localDay(date)}T00:00:00Z`);
  expiry.setUTCFullYear(expiry.getUTCFullYear() - 1);
  return expiry.toISOString().slice(0, 10);
}
function counts(row: Record<string, unknown>): Counts {
  return Object.fromEntries(EVENT_TYPES.map(type => [type, Number(row[type] || 0)])) as Counts;
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }

export function validateEvents(value: unknown): AnalyticsEvent[] {
  if (!record(value) || Object.keys(value).length !== 1 || !Array.isArray(value.events) || !value.events.length || value.events.length > 20) {
    throw new ApiError(400, 'Потрібно від 1 до 20 подій.');
  }
  const ids = new Set<string>();
  return value.events.map((event: unknown) => {
    if (!record(event) || Object.keys(event).some(key => !fields.includes(key)) || typeof event.id !== 'string' || !UUID.test(event.id) ||
        typeof event.type !== 'string' || !EVENT_TYPES.includes(event.type as EventType)) throw new ApiError(400, 'Некоректна подія.');
    const id = event.id.toLowerCase();
    if (ids.has(id)) throw new ApiError(400, 'Ідентифікатори подій мають бути унікальними.');
    ids.add(id);
    const global = ['search', 'filter', 'no_results'].includes(event.type);
    if (global ? event.offerId !== undefined : typeof event.offerId !== 'string' || !ID.test(event.offerId)) {
      throw new ApiError(400, 'Некоректна пропозиція для події.');
    }
    if ((event.materialType !== undefined && !MATERIAL_TYPES.includes(event.materialType as typeof MATERIAL_TYPES[number])) ||
        (event.packaging !== undefined && !['all', 'spool', 'refill'].includes(event.packaging as string)) ||
        (event.stock !== undefined && !['all', 'in_stock', 'out_of_stock'].includes(event.stock as string)) ||
        (event.hasSearch !== undefined && typeof event.hasSearch !== 'boolean') ||
        (event.resultCount !== undefined && (!Number.isSafeInteger(event.resultCount) || Number(event.resultCount) < 0 || Number(event.resultCount) > 100000))) {
      throw new ApiError(400, 'Некоректні категорії події.');
    }
    return { ...event, id } as unknown as AnalyticsEvent;
  });
}

export function validateReport(url: URL) {
  if ([...url.searchParams.keys()].some(key => !['companyId', 'from', 'to'].includes(key)) ||
      ['companyId', 'from', 'to'].some(key => url.searchParams.getAll(key).length !== 1)) throw new ApiError(400, 'Некоректні параметри звіту.');
  const companyId = url.searchParams.get('companyId')!;
  const from = url.searchParams.get('from')!, to = url.searchParams.get('to')!;
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if ((companyId !== 'all' && (!ID.test(companyId) || companyId.length > 128)) || !validDate(from) || !validDate(to) ||
      from > to || (Date.parse(to) - Date.parse(from)) / 86400000 >= 366) throw new ApiError(400, 'Період звіту: не більше 366 днів.');
  return { companyId, from, to };
}

function allowedUrl(value: unknown, allowedDomains?: unknown): boolean {
  if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u0020\u007f]/.test(value) || !/^https:\/\/[a-z0-9.-]+(?:[/?#]|$)/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (allowedDomains === undefined || Array.isArray(allowedDomains) && allowedDomains.includes(url.hostname));
  } catch { return false; }
}

function validLegacy(value: Document, id: string): PublicFilamentItem | null {
  if (value.id !== id || typeof value.name !== 'string' || typeof value.brand !== 'string' || typeof value.type !== 'string' ||
      value.name.length > 300 || value.brand.length > 200 || value.type.length > 80 ||
      !Array.isArray(value.popularColors) || value.popularColors.length > 100 || !Array.isArray(value.stores) || value.stores.length > 20 ||
      !Number.isFinite(value.approxPricePerKgUah) || Number(value.approxPricePerKgUah) < 0 || Number(value.approxPricePerKgUah) > 10000000 ||
      !Number.isFinite(value.spoolWeightGrams) || Number(value.spoolWeightGrams) < 1 || Number(value.spoolWeightGrams) > 100000) return null;
  const storesValid = (stores: unknown) => stores === undefined || Array.isArray(stores) && stores.length <= 20 && stores.every(store =>
    record(store) && typeof store.url === 'string' && store.url.length <= 2000 &&
    (store.productTitle === undefined || typeof store.productTitle === 'string' && store.productTitle.length <= 400) &&
    (store.spoolWeightGrams === undefined || typeof store.spoolWeightGrams === 'number' && Number.isFinite(store.spoolWeightGrams) && store.spoolWeightGrams >= 1 && store.spoolWeightGrams <= 100000) &&
    (store.priceUah === undefined || typeof store.priceUah === 'number' && Number.isFinite(store.priceUah) && store.priceUah >= 0 && store.priceUah <= 10000000));
  if (!storesValid(value.stores) || !value.popularColors.every(color => record(color) && typeof color.name === 'string' &&
      color.name.length <= 100 && typeof color.hex === 'string' && storesValid(color.stores)) ||
      (value.badge !== undefined && typeof value.badge !== 'string')) return null;
  return value as unknown as PublicFilamentItem;
}

export function createAnalyticsWorker(dependencies: { fetcher?: typeof fetch; now?: () => Date } = {}) {
  const fetcher = dependencies.fetcher || fetch;
  const now = dependencies.now || (() => new Date());
  const read = createFirebaseReader(fetcher);
  const verifyToken = createTokenVerifier(fetcher, now);
  const publicCache = new Map<string, { expires: number; value: Document | null }>();
  const reportCache = new Map<string, { expires: number; value: string }>();
  async function publicRead(project: string, path: string, appCheckToken?: string): Promise<Document | null> {
    const key = `${project}/${path}`, cached = publicCache.get(key), time = now().getTime();
    if (cached && cached.expires > time) return cached.value;
    let value: Document | null;
    try { value = await read(project, path, undefined, appCheckToken); } catch (error) {
      // A denied attestation must not poison the shared catalogue cache.
      if (!(error instanceof ApiError) || error.status !== 403 || appCheckToken) throw error;
      return null;
    }
    if (publicCache.size >= 200) publicCache.delete(publicCache.keys().next().value!);
    publicCache.set(key, { expires: time + 60000, value });
    return value;
  }
  async function offerCompany(project: string, id: string, type: EventType, companies: Map<string, Promise<Document | null>>, appCheckToken?: string) {
    const offer = await publicRead(project, `companyOffers/${id}`, appCheckToken);
    if (offer) {
      if (offer.id !== id || offer.status !== 'published' || typeof offer.companyId !== 'string' || !ID.test(offer.companyId) || offer.companyId.length > 128 ||
          typeof offer.name !== 'string' || offer.name.length > 200) throw new ApiError(400, 'Пропозиція недоступна.');
      if (!companies.has(offer.companyId)) companies.set(offer.companyId, publicRead(project, `companies/${offer.companyId}`, appCheckToken));
      const company = await companies.get(offer.companyId);
      if (company?.status !== 'active' || !allowedUrl(offer.productUrl, company.allowedDomains)) throw new ApiError(400, 'Пропозиція недоступна.');
      const name = [offer.name, typeof offer.colorName === 'string' ? offer.colorName : '',
        typeof offer.spoolWeightGrams === 'number' ? `${offer.spoolWeightGrams} г` : ''].filter(Boolean).join(' · ').slice(0, 400);
      return { companyId: offer.companyId, name };
    }
    const suffix = /-(black|white|grey|red|blue|green|yellow|orange|purple|multicolor|special|col)-(\d+)(-refill)?$/.exec(id);
    if (!suffix) throw new ApiError(400, 'Пропозиція недоступна.');
    const parentId = id.slice(0, suffix.index);
    const override = await publicRead(project, `filaments/${parentId}`, appCheckToken);
    if (override?.deleted === true) throw new ApiError(400, 'Пропозиція недоступна.');
    const parent = override ? validLegacy(override, parentId) : PUBLIC_FILAMENTS_CATALOG.find(item => item.id === parentId);
    const sku = parent && buildConcreteFilamentSkus([parent]).find(item => item.id === id);
    if (!sku || (type === 'seller_click' && !allowedUrl(sku.storeUrl))) throw new ApiError(400, 'Пропозиція недоступна.');
    return { companyId: '', name: sku.name.slice(0, 400) };
  }

  async function access(project: string, token: string, companyId: string, appCheckToken?: string) {
    const uid = await verifyToken(token, project);
    const [account, registry, membership] = await Promise.all([
      read(project, `accountAccess/${uid}`, token, appCheckToken), read(project, 'system/authorization', token, appCheckToken), read(project, `memberships/${uid}`, token, appCheckToken),
    ]);
    if (account && account.blocked !== false) throw new ApiError(403, 'Доступ заборонено.');
    const admins = registry?.adminUids;
    if (!Array.isArray(admins) || admins.length > 32 || admins.some(item => typeof item !== 'string')) throw new ApiError(403, 'Доступ заборонено.');
    if (admins.includes(uid)) {
      if (companyId !== 'all' && !await read(project, `companies/${companyId}`, token, appCheckToken)) throw new ApiError(404, 'Компанію не знайдено.');
      return 'admin';
    }
    if (companyId === 'all' || membership?.active !== true || membership.companyId !== companyId) throw new ApiError(403, 'Доступ лише до звіту своєї компанії.');
    const company = await read(project, `companies/${companyId}`, token, appCheckToken);
    if (company?.status !== 'active') throw new ApiError(403, 'Компанія неактивна.');
    return 'manager';
  }

  async function cleanup(database: AnalyticsDatabase, date: Date) {
    const utcDay = date.toISOString().slice(0, 10);
    const metricExpiry = retentionStart(date);
    const eventExpiry = new Date(date.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    // One bounded chunk per UTC day. A backlog is drained without spending the next day's quota.
    await database.batch([
      database.prepare('INSERT INTO maintenance(day) VALUES(?) ON CONFLICT DO NOTHING').bind(utcDay),
      database.prepare('DELETE FROM events WHERE id IN (SELECT id FROM events WHERE utc_day < ? AND changes() = 1 LIMIT 4000)').bind(eventExpiry),
    ]).then(async results => {
      if (!results[0].meta.changes) return;
      await database.batch([
        database.prepare('DELETE FROM daily_totals WHERE (company_id,day) IN (SELECT company_id,day FROM daily_totals WHERE day < ? LIMIT 4001)').bind(metricExpiry),
        database.prepare('DELETE FROM daily_metrics WHERE (company_id,day,offer_id) IN (SELECT company_id,day,offer_id FROM daily_metrics WHERE day < ? LIMIT 4000)').bind(metricExpiry),
        database.prepare('DELETE FROM daily_filters WHERE (company_id,day,material_type,packaging,stock,has_search) IN (SELECT company_id,day,material_type,packaging,stock,has_search FROM daily_filters WHERE day < ? LIMIT 4252)').bind(metricExpiry),
        database.prepare('DELETE FROM day_budget WHERE day < ?').bind(metricExpiry),
        database.prepare('DELETE FROM maintenance WHERE day < ?').bind(utcDay),
      ]);
    });
  }

  async function ingest(request: Request, env: AnalyticsEnv, database: AnalyticsDatabase) {
    if (request.headers.get('Origin') !== new URL(request.url).origin) throw new ApiError(403, 'Дозволено лише запити з цього сайту.');
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError(415, 'Потрібен JSON.');
    let parsed: unknown;
    try { parsed = JSON.parse(await boundedText(new Response(request.body, { headers: request.headers }), 16384)); }
    catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'Некоректний JSON.'); }
    const events = validateEvents(parsed), date = now(), utcDay = date.toISOString().slice(0, 10), day = localDay(date);
    const placeholders = events.map(() => '?').join(',');
    const initial = await database.batch([
      database.prepare('SELECT accepted FROM day_budget WHERE day = ?').bind(utcDay),
      database.prepare(`SELECT id FROM events WHERE id IN (${placeholders})`).bind(...events.map(event => event.id)),
    ]);
    const existing = new Set(initial[1].results.map(row => String(row.id)));
    const fresh = events.filter(event => !existing.has(event.id));
    const acceptedBefore = Number(initial[0].results[0]?.accepted || 0);
    if (!fresh.length || acceptedBefore >= DAILY_EVENT_LIMIT) {
      return json({ accepted: 0, duplicates: existing.size, dropped: fresh.length, budget: { day: utcDay, accepted: null, limit: DAILY_EVENT_LIMIT }, notice }, fresh.length ? 429 : 200);
    }
    const companies = new Map<string, Promise<Document | null>>(), assignments = new Map<string, { companyId: string; name: string }>();
    const lookups = new Map<string, Promise<{ companyId: string; name: string }>>();
    // At most four simultaneous REST reads and 40 external reads for a 20-event batch.
    for (let offset = 0; offset < fresh.length; offset += 4) await Promise.all(fresh.slice(offset, offset + 4).map(async event => {
      if (!event.offerId) { assignments.set(event.id, { companyId: '', name: '' }); return; }
      const key = `${event.offerId}:${event.type === 'seller_click' ? 'seller' : 'view'}`;
      if (!lookups.has(key)) lookups.set(key, offerCompany(env.FIREBASE_PROJECT_ID, event.offerId, event.type, companies, request.headers.get('X-Firebase-AppCheck') || undefined));
      assignments.set(event.id, await lookups.get(key)!);
    }));
    const writes = fresh.map(event => database.prepare(`INSERT INTO events(id,day,utc_day,type,company_id,offer_id,offer_name,material_type,packaging,stock,has_search,result_count)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING id`).bind(event.id, day, utcDay, event.type, assignments.get(event.id)!.companyId, event.offerId || '', assignments.get(event.id)!.name,
        event.materialType || 'all', event.packaging || 'all', event.stock || 'all', event.hasSearch ? 1 : 0, event.resultCount ?? null));
    const results = await database.batch([...writes,
      database.prepare(`SELECT id FROM events WHERE id IN (${placeholders})`).bind(...events.map(event => event.id)),
    ]);
    const accepted = results.slice(0, writes.length).reduce((total, result) => total + result.results.length, 0);
    if (accepted) reportCache.clear();
    const duplicates = results[writes.length].results.length - accepted;
    const dropped = events.length - accepted - duplicates;
    const budget = { day: utcDay, accepted: null, limit: DAILY_EVENT_LIMIT };
    return json({ accepted, duplicates, dropped, budget, notice }, dropped ? 429 : accepted ? 202 : 200);
  }

  async function report(request: Request, env: AnalyticsEnv, database: AnalyticsDatabase) {
    const query = validateReport(new URL(request.url));
    if (query.from < retentionStart(now()) || query.to > localDay(now())) throw new ApiError(400, 'Звіт доступний за останні 12 місяців до сьогодні (Europe/Kyiv).');
    const token = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(request.headers.get('Authorization') || '')?.[1];
    if (!token) throw new ApiError(401, 'Увійдіть в акаунт.');
    const role = await access(env.FIREBASE_PROJECT_ID, token, query.companyId, request.headers.get('X-Firebase-AppCheck') || undefined);
    const scope = query.companyId === 'all' ? '' : query.companyId;
    const global = query.companyId === 'all';
    const date = now(), utcDay = date.toISOString().slice(0, 10);
    const cacheKey = `${env.FIREBASE_PROJECT_ID}/${query.companyId}/${query.from}/${query.to}`;
    const cached = reportCache.get(cacheKey);
    let serialized = cached && cached.expires > date.getTime() ? cached.value : undefined;
    if (!serialized) {
      // The primary key bounds company scans by day; the day index bounds global scans.
      const offerSource = `daily_metrics${global ? ' INDEXED BY metrics_retention' : ''}`;
      const offerWhere = `${global ? '' : 'company_id=? AND '}day BETWEEN ? AND ?`;
      const offerBindings = [...(global ? [] : [scope]), query.from, query.to];
      const results = await database.batch([
        database.prepare(`SELECT day,${EVENT_TYPES.join(',')} FROM daily_totals WHERE company_id=? AND day BETWEEN ? AND ? ORDER BY day`).bind(scope, query.from, query.to),
        // Materializing the bounded rows keeps the size check and aggregation in one snapshot.
        // The LEFT JOIN emits a size-only sentinel for empty or oversized detail sets.
        database.prepare(`WITH bounded AS MATERIALIZED (SELECT * FROM ${offerSource} WHERE ${offerWhere} LIMIT 20001),
          sized AS (SELECT COUNT(*) AS count FROM bounded),
          grouped AS (SELECT offer_id,company_id,MAX(CASE WHEN offer_name<>'' THEN day||'|'||offer_name END) AS label,${sumColumns},SUM(${countScore}) AS score
            FROM bounded,sized WHERE sized.count<=20000 GROUP BY company_id,offer_id ORDER BY score DESC,offer_id LIMIT 101)
          SELECT sized.count AS scan_count,grouped.* FROM sized LEFT JOIN grouped ON 1 ORDER BY grouped.score DESC,grouped.offer_id`).bind(...offerBindings),
        database.prepare(`SELECT material_type,packaging,stock,has_search,${sumColumns},SUM(${countScore}) AS score FROM daily_filters WHERE company_id=? AND day BETWEEN ? AND ? GROUP BY material_type,packaging,stock,has_search ORDER BY score DESC,material_type,packaging,stock,has_search LIMIT 101`).bind(scope, query.from, query.to),
      ]);
      const offersScanLimited = Number(results[1].results[0]?.scan_count || 0) > 20000;
      const offers = results[1].results.filter(row => typeof row.offer_id === 'string');
      const totals = emptyCounts();
      const days = results[0].results.map(row => { const values = counts(row); for (const type of EVENT_TYPES) totals[type] += values[type]; return { day: String(row.day), counts: values }; });
      const value: Omit<AnalyticsReport, 'budget'> = { companyId: global ? null : scope, from: query.from, to: query.to, totals, days,
        offers: offers.slice(0, 100).map(row => ({ offerId: String(row.offer_id), companyId: row.company_id ? String(row.company_id) : null, name: row.label ? String(row.label).slice(11) : null, counts: counts(row) })),
        offersLimit: 100, offersTruncated: offers.length > 100, offersScanLimited,
        filters: results[2].results.slice(0, 100).map(row => ({ materialType: String(row.material_type), packaging: String(row.packaging), stock: String(row.stock), hasSearch: row.has_search === 1, counts: counts(row) })),
        filtersLimit: 100, filtersTruncated: results[2].results.length > 100, notice };
      serialized = JSON.stringify(value);
      if (new TextEncoder().encode(serialized).length <= 192 * 1024) {
        if (reportCache.size >= 16) reportCache.delete(reportCache.keys().next().value!);
        reportCache.set(cacheKey, { expires: date.getTime() + 60000, value: serialized });
      }
    }
    const budget = role === 'admin' ? await database.prepare('SELECT accepted FROM day_budget WHERE day=?').bind(utcDay).first<{ accepted: number }>() : null;
    const currentBudget = { day: utcDay, accepted: role === 'admin' ? Number(budget?.accepted || 0) : null, limit: DAILY_EVENT_LIMIT };
    return new Response(`${serialized.slice(0, -1)},"budget":${JSON.stringify(currentBudget)}}`, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' },
    });
  }

  return {
    async fetch(request: Request, env: AnalyticsEnv, _context: Context): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (!path.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
      if (path !== '/api/analytics/events' && path !== '/api/analytics/report') return json({ error: 'Маршрут не знайдено.' }, 404);
      const expected = path.endsWith('/events') ? 'POST' : 'GET';
      if (request.method !== expected) return json({ error: 'Метод не підтримується.' }, 405);
      try {
        if (!env.ANALYTICS_DB || !env.ANALYTICS_RATE_LIMIT) throw new ApiError(503, 'Аналітика тимчасово недоступна.');
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.headers.get('CF-Connecting-IP') || 'local'));
        const key = `${path}:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
        if (!(await env.ANALYTICS_RATE_LIMIT.limit({ key })).success) throw new ApiError(429, 'Забагато запитів. Спробуйте пізніше.');
        return expected === 'POST' ? await ingest(request, env, env.ANALYTICS_DB) : await report(request, env, env.ANALYTICS_DB);
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 503;
        if (status === 503) console.error(JSON.stringify({ event: 'analytics_unavailable', status }));
        return json({ error: error instanceof ApiError ? error.message : 'Аналітика тимчасово недоступна.' }, status);
      }
    },
    async scheduled(_controller: unknown, env: AnalyticsEnv, context: Context) {
      if (env.ANALYTICS_DB) context.waitUntil(cleanup(env.ANALYTICS_DB, now()).catch(() => console.error(JSON.stringify({ event: 'analytics_cleanup_unavailable' }))));
    },
  };
}

export default createAnalyticsWorker();
