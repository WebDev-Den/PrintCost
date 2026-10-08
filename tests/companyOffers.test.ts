import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCompanyOfferWrite, isOfferProductUrlAllowed, normalizeOfferProductUrl, toConcreteCompanyOffer,
  validateCompanyOfferInput, type CompanyOffer, type CompanyOfferInput } from '../src/domain/companyOffers.ts';
import { STANDARD_TEMPERATURE_PROFILES } from '../src/domain/filamentsDirectory.ts';

const fixture = (): CompanyOfferInput => ({ name: 'PLA Black 500g', brand: 'Own Brand', type: 'PLA', family: 'Стандартні',
  colorName: 'Black', colorHex: '#AABBCC', colorTone: 'black', packagingType: 'spool', spoolWeightGrams: 500,
  priceUah: 99.99, diameterMm: 1.75, description: '', productUrl: 'https://shop.example.com/pla-black', inStock: true, status: 'published' });

test('company offer validates real cents and bounded fields without accepting privileges', () => {
  for (const priceUah of [0.01, 900.29, 599.99, 10000000]) assert.equal(validateCompanyOfferInput({ ...fixture(), priceUah }, ['shop.example.com']).priceUah, priceUah);
  for (const priceUah of [0, -1, 10000000.01, NaN, Infinity, 600.333]) assert.throws(() => validateCompanyOfferInput({ ...fixture(), priceUah }, ['shop.example.com']), /Ціна/);
  for (const extra of [{ badge: 'Verified' }, { companyId: 'competitor' }, { isOfficialDistributor: true }]) {
    assert.throws(() => validateCompanyOfferInput({ ...fixture(), ...extra }, ['shop.example.com']), /невідомі поля/);
  }
  assert.throws(() => validateCompanyOfferInput({ ...fixture(), name: 'a'.repeat(201) }, ['shop.example.com']), /200/);
  assert.throws(() => validateCompanyOfferInput({ ...fixture(), spoolWeightGrams: Number.MIN_VALUE }, ['shop.example.com']), /Вага/);
  assert.throws(() => validateCompanyOfferInput({ ...fixture(), diameterMm: 0 }, ['shop.example.com']), /Діаметр/);
  assert.equal(validateCompanyOfferInput(fixture(), ['shop.example.com']).colorHex, '#aabbcc');
});

test('product URLs require the exact allowed HTTPS host and reject default ports before normalization', () => {
  assert.equal(normalizeOfferProductUrl('HTTPS://SHOP.EXAMPLE.COM/item?x=1#detail'), 'https://shop.example.com/item?x=1#detail');
  for (const productUrl of ['http://shop.example.com/item', 'javascript:alert(1)', 'https://user:pass@shop.example.com/item',
    'https://shop.example.com:443/item', 'https://shop.example.com:8443/item', 'https://shop.example.com\n/item',
    'https://shop.example.com.evil.test/item', 'https://evil.test/?shop.example.com', 'https://other.shop.example.com/item']) {
    assert.throws(() => validateCompanyOfferInput({ ...fixture(), productUrl }, ['shop.example.com']), /Посилання|посилання/);
  }
  assert.equal(isOfferProductUrlAllowed(fixture().productUrl, ['shop.example.com']), true);
  assert.equal(isOfferProductUrlAllowed(fixture().productUrl, ['new-shop.example.com']), false);
});

test('CAS and company boundaries prevent stale writes, reassignment and manager unblock', () => {
  const manager = { role: 'manager' as const, companyId: 'seller-a', blocked: false };
  const company = { id: 'seller-a', status: 'active' as const };
  const old = { companyId: 'seller-a', version: 2, status: 'published' as const };
  assert.doesNotThrow(() => assertCompanyOfferWrite(manager, company, old, 2, 'hidden'));
  assert.throws(() => assertCompanyOfferWrite(manager, company, old, 1, 'hidden'), /вже змінили/);
  assert.throws(() => assertCompanyOfferWrite(manager, { ...company, id: 'seller-b' }, old, 2, 'hidden'), /своєю активною/);
  assert.throws(() => assertCompanyOfferWrite(manager, { ...company, status: 'disabled' }, old, 2, 'published'), /своєю активною/);
  assert.throws(() => assertCompanyOfferWrite(manager, company, { ...old, status: 'blocked' }, 2, 'published'), /адміністратор/);
  assert.throws(() => assertCompanyOfferWrite(manager, company, null, undefined, 'blocked'), /адміністратор/);
  const admin = { role: 'admin' as const, companyId: null, blocked: false };
  assert.doesNotThrow(() => assertCompanyOfferWrite(admin, { ...company, status: 'disabled' }, { ...old, status: 'blocked' }, 2, 'hidden'));
  assert.throws(() => assertCompanyOfferWrite({ ...admin, blocked: true }, company, old, 2, 'hidden'), /Потрібні права/);
  assert.throws(() => assertCompanyOfferWrite(admin, { ...company, id: 'seller-b' }, old, 2, 'hidden'), /передати/);
});

test('card mapping preserves six-decimal kilogram prices, company identity and unknown material state', () => {
  const input = validateCompanyOfferInput(fixture(), ['shop.example.com']);
  const offer: CompanyOffer = { ...input, id: 'offer-a', companyId: 'seller-a', createdBy: 'manager', updatedBy: 'manager', version: 1,
    createdAt: '2026-10-08T12:00:00.000Z', updatedAt: '2026-10-08T12:00:00.000Z' };
  const company = { id: 'seller-a', name: 'Seller A' };
  const sku = toConcreteCompanyOffer(offer, company);
  assert.equal(sku.id, 'offer:offer-a');
  assert.equal(sku.offerId, offer.id); assert.equal(sku.companyId, company.id); assert.equal(sku.storeName, company.name);
  assert.equal(sku.calculatedPricePerKg, 199.98); assert.equal(sku.priceUah, 99.99);
  assert.equal(sku.profileNozzle, STANDARD_TEMPERATURE_PROFILES.PLA.nozzleRange);
  assert.equal(sku.badge, undefined); assert.equal(sku.isOfficialDistributor, undefined);
  assert.notEqual(toConcreteCompanyOffer({ ...offer, brand: 'Another Brand' }, company).manufacturerId, sku.manufacturerId);
  const fractional = toConcreteCompanyOffer({ ...offer, priceUah: 100.01, spoolWeightGrams: 330, name: 'n'.repeat(200) }, company);
  assert.equal(fractional.calculatedPricePerKg, 303.060606); assert.equal(fractional.name.length, 200);
  const unknown = toConcreteCompanyOffer({ ...offer, type: 'Own Polymer' }, company);
  assert.equal(unknown.profileNozzle, 'Уточніть у виробника'); assert.equal(unknown.type, 'Own Polymer');
  assert.equal(toConcreteCompanyOffer({ ...offer, packagingType: 'refill' }, company).packagingLabel, 'Рефіл (Refill)');
});
