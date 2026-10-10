import { firebaseAuth, firebaseConfigured, getAppCheckHeaders } from './firebaseClient.ts';
import { authService } from './authService.ts';
import { getCookieConsent, subscribeCookieConsent } from './cookieConsentService.ts';

export const ANALYTICS_EVENT_TYPES = ['search', 'filter', 'no_results', 'impression', 'details', 'seller_click', 'add_material'] as const;
export type AnalyticsEventType = typeof ANALYTICS_EVENT_TYPES[number];
export const ANALYTICS_MATERIAL_TYPES = ['all', 'PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'PLA-CF', 'PETG-CF', 'PA-CF', 'PVA', 'HIPS', 'other'] as const;
export type AnalyticsMaterialType = typeof ANALYTICS_MATERIAL_TYPES[number];
export interface AnalyticsDimensions {
  offerId?: string; materialType?: AnalyticsMaterialType; packaging?: 'all' | 'spool' | 'refill';
  stock?: 'all' | 'in_stock' | 'out_of_stock'; hasSearch?: boolean; resultCount?: number;
}
export interface AnalyticsEvent extends AnalyticsDimensions { id: string; type: AnalyticsEventType }
export type AnalyticsCounts = Record<AnalyticsEventType, number>;
export interface AnalyticsReport {
  companyId: string | null; from: string; to: string; totals: AnalyticsCounts;
  days: Array<{ day: string; counts: AnalyticsCounts }>;
  offers: Array<{ offerId: string; name: string | null; companyId: string | null; counts: AnalyticsCounts }>;
  offersLimit: number; offersTruncated: boolean; offersScanLimited: boolean;
  filters: Array<{ materialType: AnalyticsMaterialType; packaging: string; stock: string; hasSearch: boolean; counts: AnalyticsCounts }>;
  filtersLimit: number; filtersTruncated: boolean;
  budget: { day: string; accepted: number | null; limit: number }; notice: string;
}
const PRODUCTION_HOSTS = ['web-dev.pp.ua', 'kilo-g.web-developer-den.workers.dev'];
const MAX_QUEUE = 100;
const MAX_BATCH = 20;
const MAX_BODY_BYTES = 16 * 1024;
const QUEUE_TTL_MS = 60 * 60 * 1000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function analyticsMaterialCategory(value: unknown): AnalyticsMaterialType {
  const type = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (type === 'ALL') return 'all';
  return ANALYTICS_MATERIAL_TYPES.includes(type as AnalyticsMaterialType) ? type as AnalyticsMaterialType : 'other';
}
export function analyticsAllowed(input: { hostname: string; configured: boolean; production: boolean; demo: boolean; optedOut: boolean; override?: string }): boolean {
  if (input.demo || input.optedOut || input.override === 'false' || !input.configured) return false;
  if (input.override === 'true') return !input.production && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(input.hostname);
  return input.production && PRODUCTION_HOSTS.includes(input.hostname);
}

export function createImpressionGate(onImpression: () => void, options: {
  visible: () => boolean; schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  let sufficientlyVisible = false;
  let recorded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = options.cancel || clearTimeout;
  const update = () => {
    if (timer !== undefined) cancel(timer); timer = undefined;
    if (!recorded && sufficientlyVisible && options.visible()) timer = (options.schedule || setTimeout)(() => {
      timer = undefined;
      if (!sufficientlyVisible || !options.visible()) return;
      recorded = true;
      try { onImpression(); } catch { /* Best effort only. */ }
    }, 1000);
  };
  return {
    intersection(ratio: number, intersecting: boolean) {
      const next = intersecting && Number.isFinite(ratio) && ratio >= 0.5;
      if (next !== sufficientlyVisible) { sufficientlyVisible = next; update(); }
    },
    pageVisibilityChanged: update,
    dispose() { recorded = true; if (timer !== undefined) cancel(timer); timer = undefined; },
  };
}

export function validateAnalyticsReport(value: unknown): AnalyticsReport {
  const fail = (): never => { throw new Error('Сервер повернув некоректний звіт.'); };
  if (!value || typeof value !== 'object') fail();
  const report = value as AnalyticsReport;
  const date = (day: unknown) => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day);
  const integer = (number: unknown) => Number.isSafeInteger(number) && (number as number) >= 0;
  const counts = (data: unknown) => data !== null && typeof data === 'object' && ANALYTICS_EVENT_TYPES.every(type => integer((data as AnalyticsCounts)[type]));
  if ((report.companyId !== null && typeof report.companyId !== 'string') || !date(report.from) || !date(report.to) || !counts(report.totals)
    || !Array.isArray(report.days) || report.days.length > 366 || report.days.some(day => !day || !date(day.day) || !counts(day.counts))
    || !Array.isArray(report.offers) || report.offers.length > 100 || report.offers.some(offer => !offer || typeof offer.offerId !== 'string' || !offer.offerId || offer.offerId.length > 180 || (offer.name !== null && (typeof offer.name !== 'string' || offer.name.length > 1000)) || (offer.companyId !== null && typeof offer.companyId !== 'string') || !counts(offer.counts))
    || !Array.isArray(report.filters) || report.filters.length > 100 || report.filters.some(filter => !filter || !ANALYTICS_MATERIAL_TYPES.includes(filter.materialType)
      || !['all', 'spool', 'refill'].includes(filter.packaging) || !['all', 'in_stock', 'out_of_stock'].includes(filter.stock) || typeof filter.hasSearch !== 'boolean' || !counts(filter.counts))
    || report.offersLimit !== 100 || report.filtersLimit !== 100 || typeof report.offersTruncated !== 'boolean' || typeof report.filtersTruncated !== 'boolean'
    || typeof report.offersScanLimited !== 'boolean' || (report.offersScanLimited && report.offers.length > 0)
    || !report.budget || !date(report.budget.day) || !integer(report.budget.limit) || (report.budget.accepted !== null && !integer(report.budget.accepted))
    || typeof report.notice !== 'string' || report.notice.length > 2000) fail();
  return report;
}
function eventPayload(type: AnalyticsEventType, dimensions: AnalyticsDimensions, id: string): AnalyticsEvent | null {
  if (!ANALYTICS_EVENT_TYPES.includes(type) || !uuidPattern.test(id)) return null;
  const event: AnalyticsEvent = { id, type };
  if (dimensions.offerId !== undefined) {
    if (typeof dimensions.offerId !== 'string' || !/^[a-zA-Z0-9_:.~-]{1,180}$/.test(dimensions.offerId)) return null;
    event.offerId = dimensions.offerId;
  }
  if (['impression', 'details', 'seller_click', 'add_material'].includes(type) && !event.offerId) return null;
  if (dimensions.materialType !== undefined) event.materialType = analyticsMaterialCategory(dimensions.materialType);
  if (dimensions.packaging !== undefined && ['all', 'spool', 'refill'].includes(dimensions.packaging)) event.packaging = dimensions.packaging;
  if (dimensions.stock !== undefined && ['all', 'in_stock', 'out_of_stock'].includes(dimensions.stock)) event.stock = dimensions.stock;
  if (typeof dimensions.hasSearch === 'boolean') event.hasSearch = dimensions.hasSearch;
  if (Number.isInteger(dimensions.resultCount) && dimensions.resultCount! >= 0 && dimensions.resultCount! <= 100000) event.resultCount = dimensions.resultCount;
  return event;
}

/** Bounded best-effort queue: no persistent identifiers or event storage. */
export function createAnalyticsClient(options: { enabled: () => boolean; scope: () => string; fetcher?: typeof fetch; uuid?: () => string; delayMs?: number; now?: () => number }) {
  let queue: Array<{ event: AnalyticsEvent; queuedAt: number }> = [];
  const now = options.now || Date.now;
  const prune = () => { queue = queue.filter(item => now() - item.queuedAt <= QUEUE_TTL_MS); };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  let sending = false;
  let scope = options.scope();
  let epoch = 0;
  let failures = 0;
  const impressions = new Set<string>();
  const fetcher = options.fetcher || fetch;
  const reset = () => {
    epoch++; queue = []; impressions.clear(); failures = 0;
    if (timer) clearTimeout(timer); timer = undefined;
    controller?.abort(); controller = null; sending = false;
  };
  const ready = () => {
    const current = options.scope();
    if (current !== scope) { reset(); scope = current; }
    if (!options.enabled()) { reset(); return false; }
    return true;
  };
  const schedule = (delay = options.delayMs ?? 1500) => {
    if (!timer) timer = setTimeout(() => { timer = undefined; void flush(); }, delay);
  };
  const flush = async (): Promise<void> => {
    if (!ready() || sending) return;
    prune();
    if (!queue.length) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (timer) clearTimeout(timer); timer = undefined;
    const batch: typeof queue = [];
    while (queue.length && batch.length < MAX_BATCH) {
      const candidate = queue[0];
      if (new TextEncoder().encode(JSON.stringify({ events: [...batch, candidate].map(item => item.event) })).length > MAX_BODY_BYTES) break;
      batch.push(queue.shift()!);
    }
    if (!batch.length) { queue.shift(); return; }
    const requestEpoch = epoch;
    const requestScope = scope;
    const abort = new AbortController();
    controller = abort; sending = true;
    const timeout = setTimeout(() => abort.abort(), 8000);
    try {
      const response = await fetcher('/api/analytics/events', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'omit', body: JSON.stringify({ events: batch.map(item => item.event) }), signal: abort.signal });
      if (!response.ok && response.status !== 429) throw new Error('Analytics unavailable');
      if (requestEpoch === epoch && requestScope === options.scope()) failures = 0;
    } catch {
      if (requestEpoch === epoch && requestScope === options.scope() && options.enabled()) {
        queue = [...batch, ...queue].slice(0, MAX_QUEUE); prune(); failures++;
      }
    } finally {
      clearTimeout(timeout);
      if (requestEpoch === epoch) {
        sending = false; controller = null;
        if (queue.length && failures < 3 && ready()) schedule(failures ? 15000 : 0);
      }
    }
  };
  const track = (type: AnalyticsEventType, dimensions: AnalyticsDimensions = {}) => {
    try {
      if (!ready()) return;
      const event = eventPayload(type, dimensions, (options.uuid || (() => crypto.randomUUID()))());
      if (!event) return;
      queue.push({ event, queuedAt: now() }); if (queue.length > MAX_QUEUE) queue.shift();
      failures = 0; schedule();
    } catch { /* Analytics never prevents catalogue actions. */ }
  };
  return {
    track, flush, reset,
    beginPage() { impressions.clear(); },
    impression(offerId: string, dimensions: AnalyticsDimensions = {}) {
      try { if (!ready() || impressions.has(offerId)) return;
        impressions.add(offerId); track('impression', { ...dimensions, offerId }); } catch { /* Best effort only. */ }
    },
    pendingCount() { ready(); prune(); return queue.length; },
  };
}

const env = import.meta.env || {};
const client = createAnalyticsClient({
  enabled: () => typeof window !== 'undefined' && analyticsAllowed({ hostname: window.location.hostname,
    configured: firebaseConfigured, production: env.PROD === true, demo: authService.isDemoSession(), optedOut: getCookieConsent() !== true, override: env.VITE_ANALYTICS_ENABLED }),
  scope: () => authService.getSessionIdentity(),
  fetcher: async (url, options) => {
    const headers = new Headers(options?.headers);
    const attestation = await getAppCheckHeaders(options?.signal ?? undefined);
    for (const [name, value] of Object.entries(attestation)) headers.set(name, value);
    return fetch(url, { ...options, headers });
  },
});
export const analyticsService = {
  track: client.track, impression: client.impression, beginPage: client.beginPage,
  reset: client.reset,
  async getReport(companyId: string, from: string, to: string, signal?: AbortSignal): Promise<AnalyticsReport> {
    const current = firebaseAuth?.currentUser;
    const identity = authService.getSessionIdentity();
    if (!current || authService.isDemoSession() || !current.emailVerified) throw new Error('Для звіту потрібен підтверджений акаунт менеджера або адміністратора.');
    const token = await current.getIdToken();
    authService.assertSession(identity);
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) abort.abort();
    const timeout = setTimeout(cancel, 10000);
    try {
      let response: Response;
      try {
        const attestation = await getAppCheckHeaders(abort.signal);
        authService.assertSession(identity);
        response = await fetch(`/api/analytics/report?${new URLSearchParams({ companyId, from, to })}`, { headers: { ...attestation, Authorization: `Bearer ${token}` }, signal: abort.signal, cache: 'no-store' });
      } catch { throw new Error('Не вдалося завантажити аналітику. Перевірте з’єднання та повторіть запит.'); }
      authService.assertSession(identity);
      if (!response.ok) throw new Error(response.status === 403 ? 'Доступ до звіту відсутній або змінився.' : response.status === 400 ? 'Оберіть період у межах останніх 12 місяців, до 366 днів включно й без майбутніх дат.' : 'Не вдалося завантажити аналітику. Повторіть запит.');
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new Error('Не вдалося прочитати звіт. Перевірте з’єднання та повторіть запит.'); }
      const report = validateAnalyticsReport(payload);
      authService.assertSession(identity);
      if (report.companyId !== (companyId === 'all' ? null : companyId) || report.from !== from || report.to !== to) throw new Error('Область або період звіту не відповідає запиту.');
      return report;
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); }
  },
};
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void client.flush(); });
  subscribeCookieConsent(client.reset);
}
