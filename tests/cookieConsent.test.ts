import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { COOKIE_CONSENT_KEY, COOKIE_CONSENT_MAX_AGE_MS, getCookieConsent, parseCookieConsent,
  setCookieConsent, subscribeCookieConsent } from '../src/services/cookieConsentService.ts';

test('only a current, versioned explicit decision is accepted; invalid and expired values stay undecided', () => {
  const now = 1_800_000_000_000;
  const raw = (changes = {}) => JSON.stringify({ version: 1, analytics: true, savedAt: now, ...changes });
  assert.equal(parseCookieConsent(raw(), now), true);
  assert.equal(parseCookieConsent(raw({ analytics: false }), now), false);
  for (const invalid of [null, '', 'false', '{', 'null', '{}', raw({ version: 2 }), raw({ analytics: 'true' }),
    raw({ savedAt: -1 }), raw({ savedAt: now + 1 }), raw({ savedAt: 1.5 }), raw({ savedAt: now - COOKIE_CONSENT_MAX_AGE_MS })]) {
    assert.equal(parseCookieConsent(invalid, now), null);
  }
  assert.equal(parseCookieConsent(raw({ savedAt: now - COOKIE_CONSENT_MAX_AGE_MS + 1 }), now), true);
});

function browserFixture() {
  const values = new Map<string, string>();
  let blocked = false;
  let writeBlocked = false;
  const storage = { getItem(key: string) { if (blocked) throw new Error('blocked'); return values.get(key) ?? null; },
    setItem(key: string, value: string) { if (blocked || writeBlocked) throw new Error('blocked'); values.set(key, value); } };
  const browser = new EventTarget();
  const previous = ['localStorage', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  return { values, browser, block(value: boolean) { blocked = value; }, blockWrites(value: boolean) { writeBlocked = value; }, restore() {
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  } };
}

test('legacy opt-out flags do not create consent; both choices persist with no personal data', () => {
  const fixture = browserFixture();
  try {
    fixture.values.set('kilog_analytics_opt_out', 'false');
    assert.equal(getCookieConsent(), null);
    setCookieConsent(false); assert.equal(getCookieConsent(), false);
    const stored = JSON.parse(fixture.values.get(COOKIE_CONSENT_KEY)!);
    assert.deepEqual(Object.keys(stored).sort(), ['analytics', 'savedAt', 'version']);
    setCookieConsent(true); assert.equal(getCookieConsent(), true);
    fixture.values.delete(COOKIE_CONSENT_KEY); assert.equal(getCookieConsent(), null);
  } finally { fixture.restore(); }
});

test('blocked storage keeps a choice effective in memory without breaking the page', () => {
  const fixture = browserFixture(); fixture.block(true);
  try {
    assert.doesNotThrow(() => setCookieConsent(true)); assert.equal(getCookieConsent(), true);
    assert.doesNotThrow(() => setCookieConsent(false)); assert.equal(getCookieConsent(), false);
  } finally { fixture.restore(); }
});

test('withdrawal takes priority over a stale persisted opt-in if storage cannot be written', () => {
  const fixture = browserFixture();
  try {
    setCookieConsent(true); assert.equal(getCookieConsent(), true);
    fixture.blockWrites(true); setCookieConsent(false);
    assert.equal(JSON.parse(fixture.values.get(COOKIE_CONSENT_KEY)!).analytics, true);
    assert.equal(getCookieConsent(), false);
    fixture.blockWrites(false); setCookieConsent(false); assert.equal(getCookieConsent(), false);
  } finally { fixture.restore(); }
});

test('choice changes, cross-tab updates and storage clearing notify subscribers; unrelated storage does not', () => {
  const fixture = browserFixture(); let updates = 0;
  const unsubscribe = subscribeCookieConsent(() => updates++);
  const storageEvent = (key: string | null) => Object.assign(new Event('storage'), { key });
  try {
    setCookieConsent(false); assert.equal(updates, 1);
    fixture.browser.dispatchEvent(storageEvent('kilog_theme')); assert.equal(updates, 1);
    fixture.values.set(COOKIE_CONSENT_KEY, JSON.stringify({ version: 1, analytics: true, savedAt: Date.now() }));
    fixture.browser.dispatchEvent(storageEvent(COOKIE_CONSENT_KEY)); assert.equal(updates, 2); assert.equal(getCookieConsent(), true);
    fixture.values.clear(); fixture.browser.dispatchEvent(storageEvent(null)); assert.equal(updates, 3); assert.equal(getCookieConsent(), null);
    unsubscribe(); setCookieConsent(false); assert.equal(updates, 3);
  } finally { unsubscribe(); fixture.restore(); }
});

test('production analytics sends only after opt-in and discards queued events immediately on withdrawal', async () => {
  const fixture = browserFixture();
  Object.assign(fixture.browser, { location: { hostname: 'web-dev.pp.ua' } });
  const originalFetch = globalThis.fetch; const bodies: string[] = [];
  globalThis.fetch = async (_url, options) => { bodies.push(String(options?.body)); return new Response('{}', { status: 202 }); };
  let service: { track: (type: string, fields?: object) => void; reset: () => void } | undefined;
  const flush = async () => { fixture.browser.dispatchEvent(new Event('online')); await new Promise(resolve => setImmediate(resolve)); };
  try {
    const bundle = await build({ entryPoints: ['src/services/analyticsService.ts'], bundle: true, write: false, format: 'esm', platform: 'browser',
      define: { 'import.meta.env': JSON.stringify({ PROD: true }) }, plugins: [{ name: 'consent-boundaries', setup(builder) {
        builder.onResolve({ filter: /(?:firebaseClient|authService)\.ts$/ }, args => ({ path: args.path, namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.includes('firebaseClient')
          ? 'export const firebaseConfigured=true; export const firebaseAuth=null; export const getAppCheckHeaders=async()=>({});'
          : "export const authService={isDemoSession:()=>false,getSessionIdentity:()=>''};" }));
      } }] });
    service = (await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)).analyticsService;
    service!.track('search'); await flush(); assert.equal(bodies.length, 0);
    setCookieConsent(false); service!.track('search'); await flush(); assert.equal(bodies.length, 0);
    setCookieConsent(true); service!.track('details', { offerId: 'consent-fixture' }); await flush(); assert.equal(bodies.length, 1);
    assert.equal(JSON.parse(bodies[0]).events[0].offerId, 'consent-fixture');
    service!.track('search'); setCookieConsent(false); await flush(); assert.equal(bodies.length, 1);
    setCookieConsent(true); await flush(); assert.equal(bodies.length, 1);
    fixture.values.delete(COOKIE_CONSENT_KEY);
    fixture.browser.dispatchEvent(Object.assign(new Event('storage'), { key: COOKIE_CONSENT_KEY }));
    service!.track('search'); await flush(); assert.equal(bodies.length, 1);
  } finally { service?.reset(); globalThis.fetch = originalFetch; fixture.restore(); }
});
