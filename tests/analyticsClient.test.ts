import assert from 'node:assert/strict';
import test from 'node:test';
import { ANALYTICS_EVENT_TYPES, analyticsAllowed, analyticsMaterialCategory, createAnalyticsClient, createImpressionGate, validateAnalyticsReport, type AnalyticsDimensions } from '../src/services/analyticsService.ts';

const ids = () => { let next = 0; return () => `00000000-0000-4000-8000-${(++next).toString().padStart(12, '0')}`; };
const okay = () => new Response('{}', { status: 202 });

test('analytics excludes demo, unconfigured, test and unknown hosts; only explicit development loopback enables fixtures', () => {
  const base = { hostname: 'web-dev.pp.ua', configured: true, production: true, demo: false, optedOut: false };
  assert.equal(analyticsAllowed(base), true);
  for (const change of [{ demo: true }, { configured: false }, { optedOut: true }, { override: 'false' }, { hostname: 'localhost' }, { hostname: 'random.example', override: 'true' }]) assert.equal(analyticsAllowed({ ...base, ...change }), false);
  assert.equal(analyticsAllowed({ ...base, hostname: 'localhost', production: false, override: 'true' }), true);
  assert.equal(analyticsAllowed({ ...base, hostname: 'localhost', production: true, override: 'true' }), false);
  assert.equal(analyticsAllowed({ ...base, override: 'true' }), false);
  assert.equal(analyticsAllowed({ ...base, hostname: 'localhost', production: false, override: 'true', demo: true }), false);
  assert.equal(analyticsMaterialCategory(' pla-cf '), 'PLA-CF');
  assert.equal(analyticsMaterialCategory('PLA+ custom brand'), 'other');
});

test('client sends whitelisted dimensions only, deduplicates page impressions and respects bounded batch/queue limits', async () => {
  const payloads: string[] = [];
  const client = createAnalyticsClient({ enabled: () => true, scope: () => 'private-user-uid', uuid: ids(), delayMs: 60000,
    fetcher: (async (_url, options) => { payloads.push(options!.body as string); assert.equal(options?.credentials, 'omit'); assert.equal(options?.headers && 'Authorization' in options.headers, false); return okay(); }) as typeof fetch });
  try {
    const details = { offerId: 'offer_fixture', materialType: 'PLA', packaging: 'spool', stock: 'in_stock', hasSearch: true, resultCount: 5,
      rawSearch: 'web.developer.den@gmail.com', email: 'someone@example.com', userId: 'private-user-uid', companyId: 'secret-company', ip: '192.0.2.1', fileName: 'privatefile.gcode' } as unknown as AnalyticsDimensions;
    client.impression('offer_fixture', details); client.impression('offer_fixture', details);
    client.track('details', details);
    await client.flush();
    const first = JSON.parse(payloads[0]);
    assert.equal(first.events.length, 2);
    assert.deepEqual(Object.keys(first.events[0]).sort(), ['hasSearch', 'id', 'materialType', 'offerId', 'packaging', 'resultCount', 'stock', 'type']);
    assert.equal(/@|private-user|secret-company|192\.0\.2|privatefile|rawSearch/.test(payloads[0]), false);
    client.beginPage(); client.impression('offer_fixture');
    for (let index = 0; index < 250; index++) client.track('search', { hasSearch: true, resultCount: index });
    assert.equal(client.pendingCount(), 100);
    while (client.pendingCount()) await client.flush();
    for (const payload of payloads) { assert.ok(JSON.parse(payload).events.length <= 20); assert.ok(new TextEncoder().encode(payload).length <= 16 * 1024); }
  } finally { client.reset(); }
});

test('failures remain soft, retries retain event UUID, and quota rejection drops a batch without retry', async () => {
  const sent: string[] = []; let status = 'offline';
  const client = createAnalyticsClient({ enabled: () => true, scope: () => '', uuid: ids(), delayMs: 60000,
    fetcher: (async (_url, options) => { sent.push(options!.body as string); if (status === 'offline') throw new Error('No network'); return status === 'quota' ? new Response('{}', { status: 429 }) : okay(); }) as typeof fetch });
  try {
    assert.doesNotThrow(() => client.track('seller_click', { offerId: 'valid-id' }));
    await assert.doesNotReject(client.flush()); assert.equal(client.pendingCount(), 1);
    status = 'online'; await client.flush(); assert.equal(client.pendingCount(), 0); assert.equal(sent[0], sent[1]);
    status = 'quota'; client.track('details', { offerId: 'valid-id' }); await client.flush(); assert.equal(client.pendingCount(), 0);
  } finally { client.reset(); }
});

test('opt-out and identity changes discard queued/in-flight prior-scope events; offline events expire after one hour', async () => {
  let enabled = true; let scope = 'first-user'; let now = 0; let calls = 0; let aborted: AbortSignal | undefined;
  let release: (() => void) | undefined;
  const payloads: string[] = [];
  const client = createAnalyticsClient({ enabled: () => enabled, scope: () => scope, now: () => now, uuid: ids(), delayMs: 60000,
    fetcher: (async (_url, options) => { calls++; payloads.push(options!.body as string); if (calls === 1) { aborted = options?.signal as AbortSignal; await new Promise<void>(resolve => { release = resolve; }); } return okay(); }) as typeof fetch });
  try {
    client.track('search'); enabled = false; assert.equal(client.pendingCount(), 0); await client.flush(); assert.equal(calls, 0);
    enabled = true; client.track('details', { offerId: 'old-offer' }); const first = client.flush();
    scope = 'second-user'; client.track('details', { offerId: 'new-offer' }); assert.equal(aborted?.aborted, true); release!(); await first;
    assert.equal(client.pendingCount(), 1); await client.flush(); assert.equal(JSON.parse(payloads[1]).events[0].offerId, 'new-offer');
    client.track('search'); now += 60 * 60 * 1000 + 1; await client.flush(); assert.equal(client.pendingCount(), 0); assert.equal(calls, 2);
  } finally { release?.(); client.reset(); }
});

test('actual impression gate requires at least 50% visibility continuously for one visible second and records once', () => {
  let now = 0; let next = 0; let visible = true; let count = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const advance = (ms: number) => { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } };
  const gate = createImpressionGate(() => { count++; }, { visible: () => visible,
    schedule: (callback, delay) => { const id = ++next; timers.set(id, { at: now + delay, callback }); return id as unknown as ReturnType<typeof setTimeout>; },
    cancel: timer => { timers.delete(timer as unknown as number); } });
  gate.intersection(0.49, true); advance(2000); assert.equal(count, 0);
  gate.intersection(0.5, true); advance(999); assert.equal(count, 0); gate.intersection(0.49, true); advance(1000); assert.equal(count, 0);
  gate.intersection(0.75, true); visible = false; gate.pageVisibilityChanged(); advance(2000); assert.equal(count, 0);
  visible = true; gate.pageVisibilityChanged(); advance(1000); assert.equal(count, 1);
  gate.intersection(0.1, true); gate.intersection(1, true); advance(2000); assert.equal(count, 1); gate.dispose();
});

test('malformed report categories or counts fail before React render; manager budget hides global acceptance', () => {
  const counts = Object.fromEntries(ANALYTICS_EVENT_TYPES.map(type => [type, 0]));
  const report = { companyId: 'company-id', from: '2026-10-01', to: '2026-10-08', totals: counts, days: [], offers: [], offersLimit: 100, offersTruncated: false, offersScanLimited: false,
    filters: [], filtersLimit: 100, filtersTruncated: false, budget: { day: '2026-10-08', accepted: null, limit: 2000 }, notice: 'Best effort' };
  assert.doesNotThrow(() => validateAnalyticsReport(report));
  assert.doesNotThrow(() => validateAnalyticsReport({ ...report, offersScanLimited: true }));
  assert.throws(() => validateAnalyticsReport({ ...report, offersScanLimited: undefined }));
  assert.throws(() => validateAnalyticsReport({ ...report, offersScanLimited: 'true' }));
  assert.throws(() => validateAnalyticsReport({ ...report, offersScanLimited: true, offers: [{ offerId: 'id', name: 'PLA', companyId: 'company-id', counts }] }));
  assert.doesNotThrow(() => validateAnalyticsReport({ ...report, offers: [{ offerId: 'id', name: 'PLA White', companyId: 'company-id', counts }] }));
  assert.doesNotThrow(() => validateAnalyticsReport({ ...report, offers: [{ offerId: 'id', name: null, companyId: 'company-id', counts }] }));
  assert.throws(() => validateAnalyticsReport({ ...report, offers: [{ offerId: 'id', name: { raw: 'invalid' }, companyId: 'company-id', counts }] }));
  assert.throws(() => validateAnalyticsReport({ ...report, filters: null }));
  assert.throws(() => validateAnalyticsReport({ ...report, totals: { ...counts, seller_click: -1 } }));
  assert.throws(() => validateAnalyticsReport({ ...report, offers: [{ offerId: 'id', companyId: 'company-id', counts: null }] }));
});
