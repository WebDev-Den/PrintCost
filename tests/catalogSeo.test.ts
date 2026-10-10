import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { catalogProductPath, catalogProductStructuredData, type PublicCatalogProduct } from '../src/domain/catalogSeo.ts';

const product: PublicCatalogProduct = {
  path: '/products/offer/test-offer', id: 'offer:test-offer', name: 'PLA Білий 750 г', brand: 'Test Brand', type: 'PLA',
  colorName: 'Білий', spoolWeightGrams: 750, diameterMm: 1.75, packagingLabel: 'З котушкою',
  priceUah: 462.5, pricePerKg: 616.666667, inStock: true, storeName: 'Test Seller',
  storeUrl: 'https://shop.example.com/pla-white', description: 'Пластик для 3D-друку.',
  profileNozzle: '190–225 °C', profileBed: '50–60 °C', updatedAt: '2026-10-10T10:00:00.000Z',
};

test('product links keep company offers distinct from legacy SKUs and encode identifiers as single path segments', () => {
  assert.equal(catalogProductPath({ offerId: 'api_123', parentFilamentId: 'offer:api_123', id: 'offer:api_123' }), '/products/offer/api_123');
  const legacy = catalogProductPath({ parentFilamentId: 'PLA білий & 50%', id: 'PLA білий & 50%-white-0' });
  assert.equal(legacy, '/products/filament/PLA%20%D0%B1%D1%96%D0%BB%D0%B8%D0%B9%20%26%2050%25/PLA%20%D0%B1%D1%96%D0%BB%D0%B8%D0%B9%20%26%2050%25-white-0');
  assert.equal(catalogProductPath({ offerId: 'one/two?#', parentFilamentId: 'unused', id: 'unused' }), '/products/offer/one%2Ftwo%3F%23');
  assert.notEqual(catalogProductPath({ parentFilamentId: 'api_123', id: 'api_123' }), '/products/offer/api_123');
});

test('Product structured data reports the real pack price, public seller and availability without invented rich-result fields', () => {
  const schema = catalogProductStructuredData(product);
  assert.equal(schema['@context'], 'https://schema.org');
  assert.equal(schema['@type'], 'Product');
  assert.equal(schema.url, 'https://web-dev.pp.ua/products/offer/test-offer');
  assert.equal(schema.sku, product.id);
  assert.deepEqual(schema.brand, { '@type': 'Brand', name: product.brand });
  assert.equal(schema.offers.price, '462.50', 'The offer is a 750 g pack, not one kilogram.');
  assert.notEqual(schema.offers.price, product.pricePerKg.toFixed(2));
  assert.equal(schema.offers.priceCurrency, 'UAH');
  assert.equal(schema.offers.url, product.storeUrl);
  assert.deepEqual(schema.offers.seller, { '@type': 'Organization', name: product.storeName });
  assert.equal(schema.offers.availability, 'https://schema.org/InStock');
  assert.equal(catalogProductStructuredData({ ...product, inStock: false }).offers.availability, 'https://schema.org/OutOfStock');
  for (const field of ['image', 'review', 'aggregateRating', 'gtin', 'mpn']) assert.equal(Object.hasOwn(schema, field), false);
  for (const field of ['priceValidUntil', 'shippingDetails', 'hasMerchantReturnPolicy']) assert.equal(Object.hasOwn(schema.offers, field), false);
  const extra = { ...product, createdBy: 'private-owner', apiKey: 'private-key', email: 'private@example.com' };
  const serialized = JSON.stringify(catalogProductStructuredData(extra));
  assert.doesNotMatch(serialized, /private-owner|private-key|private@example\.com|createdBy|apiKey/);
});

async function parser() {
  const bundle = await build({ stdin: { contents: "export { parseProductResponse } from './src/pages/public/ProductPage.tsx';", resolveDir: process.cwd() },
    bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'product-ui-boundary', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.importer.endsWith('ProductPage.tsx') && !args.path.includes('/domain/')
        ? { path: args.path, namespace: 'ui-fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'ui-fixture' }, () => ({ contents:
        'export default {}; export const jsx=()=>{},jsxs=()=>{},useEffect=()=>{},useRef=()=>{},useState=()=>{},NavLink=()=>{},useLocation=()=>{},ArrowLeft=()=>{},ExternalLink=()=>{},Layers=()=>{},PublicNavbar=()=>{},Footer=()=>{},Button=()=>{},setPageMetadata=()=>{};' }));
    } }] });
  const module = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  return module.parseProductResponse as (value: unknown, path: string) => { status: number; path: string; product: PublicCatalogProduct | null } | null;
}

test('product bootstrap and API parser bind successful responses to the requested route and reject stale/error payloads', async () => {
  const parse = await parser();
  const response = { status: 200, path: product.path, product };
  assert.deepEqual(parse(response, product.path), response);
  for (const bad of [null, [], 'html', {}, { ...response, status: '200' }, { ...response, status: 201 },
    { ...response, path: '/products/offer/another' }, { ...response, product: { ...product, path: '/products/offer/another' } },
    { ...response, product: null }, { ...response, product: [] }, { ...response, status: 404 }, { ...response, status: 503 }]) {
    assert.equal(parse(bad, product.path), null);
  }
  for (const status of [404, 503]) {
    assert.deepEqual(parse({ status, path: product.path, product: null }, product.path), { status, path: product.path, product: null });
  }
});

test('public product response strips private and unknown fields instead of forwarding the raw server record', async () => {
  const parse = await parser();
  const input = { ...product, createdBy: 'private-owner', updatedBy: 'private-editor', companyId: 'internal-company',
    changeId: 'private-audit', email: 'private@example.com', apiKey: 'private-key', unknown: { nested: 'not-public' } };
  const result = parse({ status: 200, path: product.path, product: input, ownerUid: 'private-owner' }, product.path)!;
  assert.deepEqual(result, { status: 200, path: product.path, product });
  assert.doesNotMatch(JSON.stringify(result), /private-owner|private-editor|private-audit|private@example\.com|private-key|not-public|internal-company/);
  input.name = 'Changed afterwards';
  assert.equal(result.product?.name, product.name, 'The parser must not retain the raw mutable record.');
});

test('product parser rejects malformed numbers, identities, stock, dates and unsafe seller URLs', async () => {
  const parse = await parser();
  const reject = (changes: Record<string, unknown>) => assert.equal(parse({ status: 200, path: product.path, product: { ...product, ...changes } }, product.path), null, JSON.stringify(changes));
  for (const key of ['spoolWeightGrams', 'diameterMm', 'priceUah', 'pricePerKg']) {
    for (const value of [null, '600', -1, NaN, Infinity]) reject({ [key]: value });
  }
  reject({ spoolWeightGrams: 0 }); reject({ diameterMm: 0 }); reject({ priceUah: 0 }); reject({ pricePerKg: 0 });
  reject({ spoolWeightGrams: 100001 }); reject({ diameterMm: 11 }); reject({ priceUah: 10000001 });
  reject({ pricePerKg: 10000000001 });
  const maximumDerivedPrice = { ...product, priceUah: 10000000, spoolWeightGrams: 1, pricePerKg: 10000000000 };
  assert.deepEqual(parse({ status: 200, path: product.path, product: maximumDerivedPrice }, product.path)?.product, maximumDerivedPrice,
    'A valid maximum pack price and minimum weight yield a larger derived per-kilogram price.');
  reject({ id: '' }); reject({ id: 42 }); reject({ id: 'x'.repeat(241) });
  const maximumSku = { ...product, id: 'x'.repeat(240) };
  assert.deepEqual(parse({ status: 200, path: product.path, product: maximumSku }, product.path)?.product, maximumSku,
    'The shared SKU boundary accommodates a180-character legacy parent plus its generated color/packaging suffix.');
  reject({ name: '' }); reject({ name: {} }); reject({ description: 'x'.repeat(10001) });
  reject({ brand: 'x'.repeat(201) }); reject({ type: 'x'.repeat(81) }); reject({ colorName: 'x'.repeat(101) });
  reject({ inStock: 'true' }); reject({ inStock: null });
  reject({ updatedAt: 'yesterday' }); reject({ updatedAt: 1800000000000 });
  for (const storeUrl of ['javascript:alert(1)', 'data:text/html,x', '/seller', 'http://shop.example.com/pla', 'https://user:password@shop.example.com/pla',
    'https://shop.example.com:443/pla', 'https://shop.example.com:8443/pla']) reject({ storeUrl });
  const noTimestamp = { ...product }; delete noTimestamp.updatedAt;
  assert.deepEqual(parse({ status: 200, path: product.path, product: noTimestamp }, product.path)?.product, noTimestamp);
});
