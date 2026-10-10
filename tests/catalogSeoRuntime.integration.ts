import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare';
import { encodeFields } from '../workers/importFirebase.ts';
import { PUBLIC_FILAMENTS_CATALOG, buildConcreteFilamentSkus, type PublicFilamentItem } from '../src/domain/filamentsDirectory.ts';
import { catalogProductPath } from '../src/domain/catalogSeo.ts';
import { toConcreteCompanyOffer, type CompanyOffer } from '../src/domain/companyOffers.ts';

const ORIGIN = 'https://web-dev.pp.ua';
const PROJECT = 'demo-kilog-catalog-runtime';
const DOCUMENTS = `projects/${PROJECT}/databases/(default)/documents/`;
const FIXTURE = 'https://catalog-fixture.invalid/read';
const ASSET_HTML = '<!doctype html><html lang="uk"><head><title>Fixture title</title><meta name="description" content="Fixture description"><meta property="og:title" content="Fixture title"><meta property="og:description" content="Fixture description"><meta property="og:type" content="website"><link rel="canonical" href="https://wrong.invalid"><meta name="robots" content="noindex"><meta property="og:url" content="https://wrong.invalid"></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';
const ASSET_CSP = "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'";
type RecordData = Record<string, unknown>;
interface FixtureCall { suffix: string; body?: any }

function company(id = 'seller', changes: RecordData = {}): RecordData {
  return { id, name: 'Продавець Runtime', status: 'active', allowedDomains: ['shop-runtime.invalid'],
    managerUid: 'private-manager', email: 'private-company@example.invalid', ...changes };
}
function offer(id: string, changes: RecordData = {}): CompanyOffer & RecordData {
  return { id, companyId: 'seller', name: `Runtime PLA ${id}`, brand: 'Runtime Brand', type: 'PLA', family: 'Стандартні',
    colorName: 'Білий', colorHex: '#ffffff', colorTone: 'white', packagingType: 'spool', spoolWeightGrams: 750,
    priceUah: 462.5, diameterMm: 1.75, description: 'Матеріал для 3D-друку.', productUrl: `https://shop-runtime.invalid/${encodeURIComponent(id)}`,
    inStock: true, status: 'published', createdBy: 'private-owner', updatedBy: 'private-editor', apiKey: 'private-key', version: 1,
    createdAt: '2026-10-10T09:00:00.000Z', updatedAt: '2026-10-10T10:00:00.000Z', ...changes } as CompanyOffer & RecordData;
}
function legacy(id: string, count: number, changes: RecordData = {}): PublicFilamentItem & RecordData {
  return { id, name: 'Runtime Legacy PLA', brand: 'Runtime Legacy', manufacturerId: 'runtime-brand', type: 'PLA', family: 'Стандартні',
    approxPricePerKgUah: 500, spoolWeightGrams: 1000, diameterMm: 1.75, inStock: true, densityGPerCm3: 1.24,
    description: 'Каталог багатьох кольорів.', primaryColorTone: 'white', packagingType: 'refill',
    popularColors: Array.from({ length: count }, (_, index) => ({ name: 'Колір ' + index, hex: '#ffffff', colorTone: 'multicolor' })),
    stores: [{ storeName: 'Runtime Legacy Seller', url: 'https://shop-runtime.invalid/legacy', priceUah: 500, inStock: true }],
    ...changes } as PublicFilamentItem & RecordData;
}
function projected(path: string, data: RecordData, fields: string[]) {
  assert.ok(fields.length > 0, 'Service-account catalog reads must always use a public field mask.');
  assert.ok(fields.every(field => !/createdBy|updatedBy|managerUid|apiKey|email|phone/.test(field)), 'Private actor and credential fields cannot be selected.');
  return { name: DOCUMENTS + path, fields: encodeFields(Object.fromEntries(fields.flatMap(field => Object.hasOwn(data, field) ? [[field, data[field]]] : []))) };
}

// Only transport is substituted: production catalog projection, HTMLRewriter,
// Cache API, native rate limit binding and atomic D1 reservations run in workerd.
async function runtime(records: Map<string, RecordData>, limit = 10_000) {
  const calls: FixtureCall[] = [];
  const assets: string[] = [];
  let unavailable = false;
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { createCatalogSeo } from './workers/catalogSeo.ts';
    import { ApiError } from './workers/firebase.ts';
    const fixture = { async catalogReader(project) { return {
      name(path) { return 'projects/' + project + '/databases/(default)/documents/' + path; },
      async call(suffix, body) {
        const response = await fetch('${FIXTURE}', { method: 'POST', body: JSON.stringify({ suffix, body }) });
        if (!response.ok) throw new ApiError(503, 'Fixture catalog unavailable.');
        return response.json();
      }
    }; } };
    export default createCatalogSeo(fixture);
  ` }, bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', target: 'es2022' });
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'catalog-runtime-' + randomUUID(), modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-10-08', bindings: { FIREBASE_PROJECT_ID: PROJECT, FIREBASE_IMPORT_SERVICE_ACCOUNT: 'fixture-not-a-credential' },
    d1Databases: ['ANALYTICS_DB'],
    ratelimits: { ANALYTICS_RATE_LIMIT: { namespace_id: 'catalog-runtime-' + randomUUID(), simple: { limit, period: 60 } } },
    serviceBindings: { ASSETS: request => {
      assets.push(new URL(request.url).pathname);
      return new RuntimeResponse(ASSET_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': ASSET_CSP, ETag: 'fixture-old-etag' } });
    } },
    outboundService: async request => {
      assert.equal(request.url, FIXTURE, 'Runtime tests never access real Firebase, external sites or credentials.');
      assert.equal(request.method, 'POST');
      const call = await request.json() as FixtureCall;
      calls.push(call);
      if (unavailable) return new RuntimeResponse('{}', { status: 503 });
      let response: unknown;
      if (call.suffix === ':runQuery') {
        const query = call.body.structuredQuery;
        const collection = query.from[0].collectionId;
        assert.ok(['companyOffers', 'filaments'].includes(collection));
        assert.deepEqual(query.orderBy, [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }]);
        assert.equal(query.limit, 20, 'Each catalog page has one bounded Firestore query.');
        assert.equal(Object.hasOwn(query, 'offset'), false, 'Offset pagination would charge reads for skipped products.');
        if (collection === 'companyOffers') assert.deepEqual(query.where, { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'published' } } });
        const fields = query.select.fields.map((field: { fieldPath: string }) => field.fieldPath);
        if (collection === 'companyOffers') assert.ok(!fields.includes('description'), 'Sitemap and list queries exclude large offer descriptions.');
        const after = query.startAt?.values[0].referenceValue;
        if (after) { assert.ok(after.startsWith(DOCUMENTS + collection + '/')); assert.equal(query.startAt.before, false); }
        response = [...records].filter(([path, data]) => path.startsWith(collection + '/') && (!after || DOCUMENTS + path > after) && (collection !== 'companyOffers' || data.status === 'published'))
          .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, query.limit)
          .map(([path, data]) => ({ document: projected(path, data, fields) }));
      } else if (call.suffix === ':batchGet') {
        const documents = call.body.documents as string[];
        assert.equal(new Set(documents).size, documents.length, 'Company reads are deduplicated within each page.');
        response = documents.map(name => {
          assert.ok(name.startsWith(DOCUMENTS + 'companies/') || name.startsWith(DOCUMENTS + 'temperatureProfiles/'));
          const path = name.slice(DOCUMENTS.length);
          const data = records.get(path);
          return data ? { found: projected(path, data, call.body.mask.fieldPaths) } : { missing: name };
        });
      } else {
        const url = new URL(call.suffix, 'https://masked-firestore.invalid');
        const parts = url.pathname.slice(1).split('/').map(decodeURIComponent);
        assert.ok(['companyOffers', 'companies', 'temperatureProfiles', 'filaments'].includes(parts[0]));
        assert.equal(parts.length, 2);
        const path = parts.join('/');
        const data = records.get(path);
        const fields = url.searchParams.getAll('mask.fieldPaths');
        assert.ok(fields.length > 0);
        response = data ? projected(path, data, fields) : null;
      }
      return new RuntimeResponse(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
    },
  }));
  const db = await mf.getD1Database('ANALYTICS_DB');
  await db.prepare(await readFile('migrations/0012_catalog_seo_budget.sql', 'utf8')).run();
  return { mf, db, calls, assets, bundleInputs: Object.keys(bundle.metafile.inputs), unavailable(value: boolean) { unavailable = value; },
    request(path: string, init?: Parameters<Miniflare['dispatchFetch']>[1]) { return mf.dispatchFetch(ORIGIN + path, init); } };
}

function jsonScript(html: string, id: string): any {
  const match = new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`).exec(html);
  assert.ok(match, `Server HTML must contain ${id} without executing JavaScript.`);
  return JSON.parse(match[1]);
}
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const privatePattern = /private-owner|private-editor|private-manager|private-key|private-company@example|createdBy|updatedBy|managerUid|apiKey/;

test('native catalog runtime renders public products and guards private data, errors, canonical URLs and cache', { timeout: 120_000 }, async t => {
  const name = 'PLA <script>alert("name")</script> & білий';
  const description = 'Опис </script><script>alert("description")</script> & \u2028\u2029 кінець';
  const records = new Map<string, RecordData>([
    ['companies/seller', company()], ['companies/inactive', company('inactive', { status: 'blocked' })],
    ['companyOffers/rendered', offer('rendered', { name, description })],
    ['companyOffers/draft', offer('draft', { status: 'hidden' })], ['companyOffers/blocked', offer('blocked', { status: 'blocked' })],
    ['companyOffers/inactive', offer('inactive', { companyId: 'inactive' })], ['companyOffers/missing-company', offer('missing-company', { companyId: 'missing' })],
    ['companyOffers/unauthorized-host', offer('unauthorized-host', { productUrl: 'https://child.shop-runtime.invalid/pla' })],
    ['companyOffers/mismatch', offer('different-id')],
    ['companyOffers/unsafe-url', offer('unsafe-url', { productUrl: 'https://shop-runtime.invalid:443/pla' })],
    ['temperatureProfiles/PLA', { nozzleRange: '192–212 °C', bedRange: '52–62 °C', notes: 'Runtime profile' }],
  ]);
  const r = await runtime(records);
  t.after(() => r.mf.dispose());
  await t.test('product HTML is crawlable before JS, escapes text and inert JSON, preserves CSP and real pack pricing', async () => {
    const response = await r.request('/products/offer/rendered');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Security-Policy'), ASSET_CSP);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=300');
    assert.equal(response.headers.get('X-Robots-Tag'), 'index, follow');
    assert.equal(response.headers.get('ETag'), null, 'The SPA entity tag cannot represent modified server HTML.');
    const html = await response.text();
    assert.match(html, /<h1[^>]*>PLA &lt;script&gt;alert\(&quot;name&quot;\)&lt;\/script&gt; &amp; білий<\/h1>/);
    assert.doesNotMatch(html.slice(html.indexOf('<body>')), /<script>alert\(/, 'Body text and inert JSON cannot create executable script elements.');
    assert.match(html, /192–212 °C/);
    assert.match(html, /href="https:\/\/web-dev\.pp\.ua\/products\/offer\/rendered"/);
    assert.doesNotMatch(html, /https:\/\/wrong\.invalid/);
    assert.doesNotMatch(html, privatePattern);
    const schema = jsonScript(html, 'catalog-jsonld');
    assert.equal(schema['@type'], 'Product'); assert.equal(schema.name, name); assert.equal(schema.description, description);
    assert.equal(schema.offers.price, '462.50'); assert.equal(schema.offers.priceCurrency, 'UAH');
    assert.equal(schema.offers.availability, 'https://schema.org/InStock');
    for (const key of ['image', 'aggregateRating', 'review', 'gtin']) assert.equal(Object.hasOwn(schema, key), false);
    const bootstrap = jsonScript(html, 'catalog-product-data');
    assert.equal(bootstrap.path, '/products/offer/rendered'); assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.product.description, description);
    assert.equal(bootstrap.product.profileNozzle, '192–212 °C');
    assert.ok(html.indexOf('id="catalog-product-data"') > html.indexOf('</div>'), 'React mounting must not remove the bootstrap payload.');
  });
  await t.test('public JSON contains projected product fields and no identity-dependent cache content', async () => {
    const path = '/api/catalog/products/offer/rendered';
    const first = await r.request(path);
    assert.equal(first.status, 200); assert.equal(first.headers.get('X-Robots-Tag'), 'noindex');
    const body = await first.text();
    assert.doesNotMatch(body, privatePattern);
    assert.deepEqual(Object.keys(JSON.parse(body)).sort(), ['path', 'product', 'status']);
    const before = r.calls.length;
    const repeat = await r.request(path, { headers: { Cookie: 'session=private-cookie', Authorization: 'Bearer private-token' } });
    assert.equal(await repeat.text(), body);
    assert.equal(r.calls.length, before, 'A native public-cache hit performs no D1/Firestore work and is invariant across identities.');
    const head = await r.request(path, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
  });
  await t.test('unpublished, inactive, unassigned, unauthorized and malformed offers return no-store 404', async () => {
    for (const id of ['draft', 'blocked', 'inactive', 'missing-company', 'unauthorized-host', 'mismatch', 'unsafe-url', 'missing']) {
      const response = await r.request('/api/catalog/products/offer/' + id);
      assert.equal(response.status, 404, id); assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(await response.json(), { path: '/products/offer/' + id, product: null, status: 404 });
    }
    const response = await r.request('/products/offer/draft');
    assert.equal(response.status, 404); assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
    const html = await response.text(); assert.doesNotMatch(html, /catalog-jsonld/); assert.doesNotMatch(html, privatePattern);
    assert.equal(jsonScript(html, 'catalog-product-data').product, null);
  });
  await t.test('legacy tombstones hide built-in variants and upstream failures never resurrect built-in products', async () => {
    const [first, second] = PUBLIC_FILAMENTS_CATALOG;
    const firstPath = catalogProductPath(buildConcreteFilamentSkus([first])[0]);
    records.set('filaments/' + first.id, { deleted: true });
    assert.equal((await r.request(firstPath)).status, 404);
    const secondPath = catalogProductPath(buildConcreteFilamentSkus([second])[0]);
    r.unavailable(true);
    const failure = await r.request(secondPath);
    assert.equal(failure.status, 503); assert.equal(failure.headers.get('Cache-Control'), 'no-store');
    assert.ok(failure.headers.get('Retry-After'));
    assert.doesNotMatch(await failure.text(), new RegExp(second.brand));
    r.unavailable(false);
    const recovered = await r.request(secondPath);
    assert.equal(recovered.status, 200, 'Transient errors were not stored in the public cache.');
    assert.equal(jsonScript(await recovered.text(), 'catalog-product-data').product.path, secondPath);
  });
  await t.test('canonical redirects and malformed path segments do not consume backend reads', async () => {
    const before = r.calls.length;
    for (const [url, location] of [[ORIGIN + '/products/offer/rendered?tracking=1', ORIGIN + '/products/offer/rendered'],
      ['https://kilo-g.fixture.workers.dev/products/offer/rendered', ORIGIN + '/products/offer/rendered'],
      [ORIGIN + '/catalog/offers?after=rendered&extra=1', ORIGIN + '/catalog/offers?after=rendered']]) {
      const response = await r.mf.dispatchFetch(url, { redirect: 'manual' });
      assert.equal(response.status, 308); assert.equal(response.headers.get('Location'), location);
    }
    for (const path of ['/products/offer/%ZZ', '/products/offer/a%2Fb', '/products/offer/id/extra', '/catalog/offers?after=a&after=b']) {
      const response = await r.request(path); assert.equal(response.status, 404, path); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
    const post = await r.request('/products/offer/rendered', { method: 'POST', body: '{}' });
    assert.equal(post.status, 405); assert.equal(post.headers.get('Allow'), 'GET, HEAD');
    assert.equal(r.calls.length, before);
  });
  await t.test('native D1 admits only the last daily query/read reservation and blocks before Firestore', async () => {
    for (const [queries, reads] of [[499, 0], [0, 4999]]) {
      await r.db.prepare('UPDATE catalog_seo_daily SET queries=?,reserved_reads=? WHERE day=?').bind(queries, reads, day()).run();
      const before = r.calls.length;
      const responses = await Promise.all([r.request('/api/catalog/products/offer/budget-a-' + queries), r.request('/api/catalog/products/offer/budget-b-' + queries)]);
      assert.deepEqual(responses.map(response => response.status).sort(), [404, 503]);
      assert.equal(r.calls.length - before, 1, 'The denied atomic reservation cannot reach the privileged Firestore reader.');
      assert.ok(responses.find(response => response.status === 503)!.headers.get('Retry-After'));
      const usage = await r.db.prepare('SELECT queries,reserved_reads FROM catalog_seo_daily WHERE day=?').bind(day()).first<{ queries: number; reserved_reads: number }>();
      assert.equal(usage!.queries, queries + 1); assert.equal(usage!.reserved_reads, reads + 1);
    }
  });
});

test('native offer price projection matches frontend Decimal rounding without bundling Decimal into the Worker', { timeout: 120_000 }, async t => {
  const cases = [750.25, 499.99, 1.000001, 113.3333, 99999.99].flatMap(spoolWeightGrams =>
    [0.01, 462.5, 10000000].map(priceUah => ({ spoolWeightGrams, priceUah })));
  cases.push({ spoolWeightGrams: 256, priceUah: 0.01 }, { spoolWeightGrams: 1, priceUah: 10000000 });
  const records = new Map<string, RecordData>([['companies/seller', company()]]);
  const offers = cases.map((values, index) => offer('price-' + index, values));
  for (const item of offers) records.set('companyOffers/' + item.id, item);
  const r = await runtime(records);
  t.after(() => r.mf.dispose());
  assert.ok(!r.bundleInputs.some(path => /(?:^|\/)node_modules\/decimal\.js(?:\/|$)/.test(path.replaceAll('\\', '/'))),
    'Server catalog projection must preserve the existing lean Worker dependency boundary.');
  for (const item of offers) {
    const expected = toConcreteCompanyOffer(item, { id: 'seller', name: String(company().name) });
    const response = await r.request('/api/catalog/products/offer/' + item.id);
    assert.equal(response.status, 200, `${item.priceUah} UAH / ${item.spoolWeightGrams} g`);
    const result = await response.json() as { product: { priceUah: number; pricePerKg: number; spoolWeightGrams: number } };
    assert.equal(result.product.priceUah, expected.priceUah);
    assert.equal(result.product.spoolWeightGrams, expected.spoolWeightGrams);
    assert.equal(result.product.pricePerKg, expected.calculatedPricePerKg, 'Worker six-place HALF_UP must match the existing frontend Decimal calculation.');
    if (item.spoolWeightGrams === 256) assert.equal(result.product.pricePerKg, 0.039063, 'A seventh-place tie rounds upward.');
    if (item.spoolWeightGrams === 1) assert.equal(result.product.pricePerKg, 10000000000, 'A legal maximum pack price can derive a10b UAH/kg value.');
  }
});

test('sitemap and crawlable pagination discover every public offer beyond the first page and all legacy variants', { timeout: 120_000 }, async t => {
  const records = new Map<string, RecordData>([['companies/seller', company()], ['companies/inactive', company('inactive', { status: 'blocked' })]]);
  // A completely filtered first page must still expose its raw-document cursor.
  for (let index = 0; index < 20; index++) records.set(`companyOffers/a-${String(index).padStart(3, '0')}`, offer(`a-${String(index).padStart(3, '0')}`, { companyId: 'inactive' }));
  const ids = Array.from({ length: 125 }, (_, index) => 'b-' + String(index).padStart(4, '0'));
  for (const id of ids) records.set('companyOffers/' + id, offer(id));
  records.set('companyOffers/draft', offer('draft', { status: 'hidden' }));
  const tombstone = PUBLIC_FILAMENTS_CATALOG[0];
  records.set('filaments/' + tombstone.id, { deleted: true });
  const expectedLegacy = buildConcreteFilamentSkus(PUBLIC_FILAMENTS_CATALOG.slice(1)).filter(sku => /^https:\/\//.test(sku.storeUrl)).map(catalogProductPath);
  const r = await runtime(records);
  t.after(() => r.mf.dispose());
  const first = await r.request('/catalog/offers');
  assert.equal(first.status, 200);
  const firstHtml = await first.text();
  assert.match(firstHtml, /href="\/catalog\/offers\?after=a-019"/);
  assert.doesNotMatch(firstHtml, /<script type="module"/);
  assert.doesNotMatch(firstHtml, /Runtime PLA a-/);
  const second = await r.request('/catalog/offers?after=a-019');
  assert.equal(second.status, 200);
  assert.match(await second.text(), /href="\/products\/offer\/b-0000"/);
  const response = await r.request('/sitemap.xml');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/xml; charset=utf-8');
  const xml = await response.text();
  const locations = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
  assert.equal(new Set(locations).size, locations.length, 'Sitemap URLs are unique.');
  for (const id of ids) assert.ok(locations.includes(ORIGIN + '/products/offer/' + id), `A published offer on a later page is discoverable: ${id}`);
  for (const path of expectedLegacy) assert.ok(locations.includes(ORIGIN + path), `Built-in legacy SKU is discoverable: ${path}`);
  assert.doesNotMatch(xml, /a-019|\/draft<|private-owner|private-editor|private-key/);
  assert.ok(!locations.some(location => location.includes('/filament/' + tombstone.id + '/')));
  assert.ok(locations.includes(ORIGIN + '/') && locations.includes(ORIGIN + '/filaments') && locations.includes(ORIGIN + '/privacy'));
  const offerPages = r.calls.filter(call => call.suffix === ':runQuery' && call.body.structuredQuery.from[0].collectionId === 'companyOffers');
  assert.ok(offerPages.length > 5);
  assert.ok(offerPages.every(call => call.body.structuredQuery.limit === 20));
  const before = r.calls.length;
  assert.equal(await (await r.request('/sitemap.xml')).text(), xml);
  assert.equal(r.calls.length, before, 'A sitemap cache hit does not rebuild the catalog.');
  const usage = await r.db.prepare('SELECT queries,reserved_reads FROM catalog_seo_daily WHERE day=?').bind(day()).first<{ queries: number; reserved_reads: number }>();
  assert.ok(usage!.queries < 100 && usage!.reserved_reads < 1000, 'Full sitemap reads are bounded and charged once per actual backend page.');
  const robots = await r.request('/robots.txt');
  assert.equal(robots.status, 200); assert.match(await robots.text(), /Disallow: \/app\nDisallow: \/auth\/\nDisallow: \/api\/\nSitemap: https:\/\/web-dev\.pp\.ua\/sitemap\.xml/);
});

test('large sitemap stops before the Free subrequest ceiling while late products remain crawlable through paginated HTML', { timeout: 120_000 }, async t => {
  const records = new Map<string, RecordData>([['companies/seller', company()]]);
  for (let index = 0; index < 425; index++) { const id = 'large-' + String(index).padStart(4, '0'); records.set('companyOffers/' + id, offer(id)); }
  const r = await runtime(records);
  t.after(() => r.mf.dispose());
  const manifest = await r.request('/sitemap.xml');
  assert.equal(manifest.status, 503); assert.equal(manifest.headers.get('Cache-Control'), 'no-store');
  assert.ok(manifest.headers.get('Retry-After'));
  assert.doesNotMatch(await manifest.text(), /<urlset|<loc>/, 'A incomplete manifest must never look like a successful sitemap.');
  assert.equal(r.calls.length, 40, 'The per-invocation guard leaves margin under50 external subrequests and denies transport41.');
  const lastProduct = await r.request('/api/catalog/products/offer/large-0424');
  assert.equal(lastProduct.status, 200);
  assert.equal((await lastProduct.json() as any).product.path, '/products/offer/large-0424');
  const latePage = await r.request('/catalog/offers?after=large-0399');
  assert.equal(latePage.status, 200);
  const html = await latePage.text();
  assert.match(html, /href="\/products\/offer\/large-0400"/);
  assert.match(html, /href="\/catalog\/offers\?after=large-0419"/);
  const finalPage = await r.request('/catalog/offers?after=large-0419');
  assert.equal(finalPage.status, 200); assert.match(await finalPage.text(), /href="\/products\/offer\/large-0424"/);
});

test('legacy parents with101 colors each split into two complete pages and a sitemap containing all202 SKUs', { timeout: 120_000 }, async t => {
  const first = legacy('aa-many', 101), second = legacy('ab-many', 101);
  const records = new Map<string, RecordData>(PUBLIC_FILAMENTS_CATALOG.map(item => ['filaments/' + item.id, { deleted: true }]));
  records.set('filaments/' + first.id, first); records.set('filaments/' + second.id, second);
  const r = await runtime(records);
  t.after(() => r.mf.dispose());
  const expectedFirst = buildConcreteFilamentSkus([first]).map(catalogProductPath);
  const expectedSecond = buildConcreteFilamentSkus([second]).map(catalogProductPath);
  const response = await r.request('/catalog/filaments');
  assert.equal(response.status, 200);
  const initial = await response.text();
  for (const path of expectedFirst) assert.ok(initial.includes(`href="${path}"`), path);
  assert.equal((initial.match(/href="\/products\/filament\//g) || []).length, 101);
  assert.match(initial, /href="\/catalog\/filaments\?after=aa-many"/);
  const next = await r.request('/catalog/filaments?after=aa-many');
  assert.equal(next.status, 200);
  const final = await next.text();
  for (const path of expectedSecond) assert.ok(final.includes(`href="${path}"`), path);
  assert.equal((final.match(/href="\/products\/filament\//g) || []).length, 101);
  const sitemap = await r.request('/sitemap.xml'); assert.equal(sitemap.status, 200);
  const locations = [...(await sitemap.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
  assert.equal(locations.filter(location => location.includes('/products/filament/')).length, 202);
  for (const path of [...expectedFirst, ...expectedSecond]) assert.ok(locations.includes(ORIGIN + path), path);
});

test('one valid200-color legacy parent preserves long generated SKU identities in HTML, JSON and sitemap', { timeout: 120_000 }, async t => {
  const material = legacy('z'.repeat(180), 200);
  const records = new Map<string, RecordData>(PUBLIC_FILAMENTS_CATALOG.map(item => ['filaments/' + item.id, { deleted: true }]));
  records.set('filaments/' + material.id, material);
  const r = await runtime(records);
  t.after(() => r.mf.dispose());
  const skus = buildConcreteFilamentSkus([material]);
  const last = skus.at(-1)!;
  assert.ok(last.id.length > 200 && last.id.length <= 240, 'Generated SKU needs more space than its valid180-character parent.');
  const list = await r.request('/catalog/filaments'); assert.equal(list.status, 200);
  const html = await list.text();
  assert.equal((html.match(/href="\/products\/filament\//g) || []).length, 200);
  const path = catalogProductPath(last);
  assert.ok(html.includes(`href="${path}"`));
  const product = await r.request('/api/catalog' + path); assert.equal(product.status, 200);
  assert.equal((await product.json() as any).product.id, last.id);
  const sitemap = await r.request('/sitemap.xml'); assert.equal(sitemap.status, 200);
  assert.equal([...(await sitemap.text()).matchAll(/<loc>[^<]*\/products\/filament\//g)].length, 200);
});

test('sitemap exhaustion returns a retryable no-store failure instead of a silently truncated public sitemap', { timeout: 120_000 }, async t => {
  const records = new Map<string, RecordData>([['companies/seller', company()]]);
  for (let index = 0; index < 21; index++) { const id = 'budget-' + String(index).padStart(3, '0'); records.set('companyOffers/' + id, offer(id)); }
  const r = await runtime(records);
  t.after(() => r.mf.dispose());
  await r.db.prepare('INSERT INTO catalog_seo_daily(day,queries,reserved_reads) VALUES(?,0,4990)').bind(day()).run();
  const response = await r.request('/sitemap.xml');
  assert.equal(response.status, 503); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.ok(response.headers.get('Retry-After')); assert.doesNotMatch(await response.text(), /<urlset|<loc>/);
  assert.equal(r.calls.length, 0, 'Quota denies the full page reservation before reading any remote catalog records.');
  await r.db.prepare('UPDATE catalog_seo_daily SET queries=0,reserved_reads=0 WHERE day=?').bind(day()).run();
  const retry = await r.request('/sitemap.xml'); assert.equal(retry.status, 200);
  assert.match(await retry.text(), /\/products\/offer\/budget-020/);
});

test('native SEO rate limiter blocks uncached reads with retryable failures before privileged catalog transport', { timeout: 120_000 }, async t => {
  const records = new Map<string, RecordData>();
  const r = await runtime(records, 1);
  t.after(() => r.mf.dispose());
  for (let attempt = 0; attempt < 2; attempt++) {
    const epoch = Math.floor(Date.now() / 60_000);
    const headers = { 'CF-Connecting-IP': `192.0.2.${80 + attempt}` };
    const first = await r.request('/api/catalog/products/offer/rate-a-' + attempt, { headers });
    assert.equal(first.status, 404);
    const before = r.calls.length;
    const denied = await r.request('/api/catalog/products/offer/rate-b-' + attempt, { headers });
    // Native windows align to wall-clock minutes; retry a rollover with a fresh IP.
    if (epoch !== Math.floor(Date.now() / 60_000)) continue;
    assert.equal(denied.status, 503); assert.equal(denied.headers.get('Cache-Control'), 'no-store');
    assert.ok(denied.headers.get('Retry-After')); assert.equal(r.calls.length, before);
    return;
  }
  assert.fail('Could not observe the quota within one native minute window.');
});
