import assert from 'node:assert/strict';
import test from 'node:test';
import { IMPORT_EXAMPLE, IMPORT_LIMITS, importDomain, normalizeImportPayload, profileForImport, validateImportEnvelope } from '../src/domain/apiImports.ts';

test('HTTP envelope validation bounds the whole request without validating individual records', () => {
  const offers = Array.from({ length: IMPORT_LIMITS.items }, (_, index) => ({ ...IMPORT_EXAMPLE.offers[0], externalId: String(index) }));
  offers[99].priceUah = 600.333;
  assert.deepEqual(validateImportEnvelope({ offers }), { companies: [], offers });
  assert.throws(() => normalizeImportPayload({ offers }), /Ціна/);
  assert.deepEqual(validateImportEnvelope({ companies: [null] }), { companies: [null], offers: [] });
  assert.deepEqual(validateImportEnvelope({ companies: null, offers: [null] }), { companies: [], offers: [null] });
  for (const value of [null, [], 'JSON', {}, { offers: [] }, { offers: {} }, { companies: {}, offers: [null] },
    { companies: [null], offers, }, { offers: [null], uid: 'other' }]) assert.throws(() => validateImportEnvelope(value));
});

test('import normalizes offers, derives profiles and never invents an unknown material profile', () => {
  const payload = normalizeImportPayload(IMPORT_EXAMPLE);
  assert.equal(payload.offers[0].offer.family, 'Стандартні');
  assert.equal(payload.offers[0].offer.type, 'PLA');
  assert.equal(payload.offers[0].offer.status, 'hidden');
  assert.equal(profileForImport(' petg ')?.nozzleRange, '225–250 °C');
  assert.equal(profileForImport('PA12'), undefined);
  assert.equal(normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], type: 'PA12' }] }).offers[0].familyExplicit, false);
  assert.equal(normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], type: 'PA12', family: 'Інженерні' }] }).offers[0].offer.family, 'Інженерні');
});
test('import accepts legacy publication flags but always stages non-blocked offers as drafts', () => {
  for (const status of ['published', 'hidden'] as const) {
    assert.equal(normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], status }] }).offers[0].offer.status, 'hidden');
  }
  assert.equal(normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], status: 'blocked' }] }).offers[0].offer.status, 'blocked');
  assert.throws(() => normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], status: 'unknown' }] }));
});
test('import rejects unknown fields, ownership forgery, duplicates, unsafe URLs and unbounded batches', () => {
  assert.throws(() => normalizeImportPayload({ ...IMPORT_EXAMPLE, uid: 'other' }));
  assert.throws(() => normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], createdBy: 'other' }] }));
  assert.throws(() => normalizeImportPayload({ offers: [IMPORT_EXAMPLE.offers[0], IMPORT_EXAMPLE.offers[0]] }));
  assert.throws(() => normalizeImportPayload({ offers: Array.from({ length: IMPORT_LIMITS.items + 1 }, (_, index) => ({ ...IMPORT_EXAMPLE.offers[0], externalId: String(index) })) }));
  for (const productUrl of ['http://shop.example.com/a', 'https://shop.example.com:443/a', 'https://user@shop.example.com/a', 'https://127.0.0.1/a']) {
    assert.throws(() => normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], productUrl }] }));
  }
  assert.equal(importDomain('https://SHOP.EXAMPLE.COM/item'), 'shop.example.com');
  assert.throws(() => normalizeImportPayload({ companies: [{ website: 'https://shop.example.com/', allowedDomains: ['evil.example.com'] }] }));
});
test('company JSON preserves omitted fields for later admin completion', () => {
  assert.deepEqual(normalizeImportPayload({ companies: [{ website: 'https://shop.example.com' }] }).companies,
    [{ website: 'https://shop.example.com/' }]);
  assert.equal(normalizeImportPayload({ companies: [{ website: 'https://shop.example.com', name: ' Seller ', status: 'disabled' }] }).companies[0].name, 'Seller');
});
