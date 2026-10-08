import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, updateDoc } from 'firebase/firestore';
import { INITIAL_MATERIALS, INITIAL_PRINTERS, INITIAL_PRICING_SETTINGS, getInitialCalculationSnapshots } from '../src/domain/defaultData.ts';
import { MANUFACTURERS_LIST, PUBLIC_FILAMENTS_CATALOG, STANDARD_TEMPERATURE_PROFILES } from '../src/domain/filamentsDirectory.ts';
import { api } from '../src/services/api.ts';

let environment: RulesTestEnvironment;
const profile = { email: 'alice@example.com', fullName: 'Alice', workshopName: 'Майстерня', createdAt: '2026-10-08T10:00:00.000Z' };
const settings = { ...INITIAL_PRICING_SETTINGS, defaultPrinterId: null, filamentMappingPresets: {} };
const material = { ...INITIAL_MATERIALS[0], id: 'material' };
const printer = { ...INITIAL_PRINTERS[0], id: 'printer' };
const snapshot = JSON.parse(JSON.stringify({ ...getInitialCalculationSnapshots()[0], id: 'calculation' }));
const alice = () => environment.authenticatedContext('alice', { email: profile.email }).firestore();

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run with npm run test:rules');
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  environment = await initializeTestEnvironment({
    projectId: 'demo-kilog',
    firestore: { host, port: Number(port), rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
beforeEach(async () => { await environment.clearFirestore(); });
after(async () => { await environment?.cleanup(); });

test('public catalog is readable, anonymous writes and private data are denied', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  await assertSucceeds(getDocs(query(collection(anonymous, 'filaments'), limit(1000))));
  await assertSucceeds(getDocs(query(collection(anonymous, 'manufacturers'), limit(1000))));
  await assertSucceeds(getDocs(query(collection(anonymous, 'temperatureProfiles'), limit(200))));
  await assertFails(getDoc(doc(anonymous, 'users/alice')));
  await assertFails(setDoc(doc(anonymous, 'users/alice/materials/material'), material));
  await assertFails(setDoc(doc(anonymous, 'filaments/filament'), { ...PUBLIC_FILAMENTS_CATALOG[0], id: 'filament' }));
});

test('owner can persist profile, materials, printers, settings, calculations and likes', async () => {
  const user = alice();
  await assertSucceeds(setDoc(doc(user, 'users/alice'), profile));
  await assertSucceeds(updateDoc(doc(user, 'users/alice'), { fullName: 'Оператор', workshopName: '3D Studio' }));
  await assertSucceeds(setDoc(doc(user, 'users/alice/materials/material'), material));
  await assertSucceeds(setDoc(doc(user, 'users/alice/printers/printer'), printer));
  await assertSucceeds(setDoc(doc(user, 'users/alice/settings/pricing'), settings));
  await assertSucceeds(setDoc(doc(user, 'users/alice/calculations/calculation'), snapshot));
  await assertSucceeds(setDoc(doc(user, 'users/alice/likes/filament-sku'), { filamentId: 'filament-sku' }));
  await assertSucceeds(getDocs(query(collection(user, 'users/alice/materials'), limit(200))));
  await assertSucceeds(deleteDoc(doc(user, 'users/alice/materials/material')));
});

test('another user, including an admin, cannot read or write private account data', async () => {
  await setDoc(doc(alice(), 'users/alice'), profile);
  await setDoc(doc(alice(), 'users/alice/materials/material'), material);
  for (const context of [environment.authenticatedContext('bob'), environment.authenticatedContext('admin', { admin: true })]) {
    const user = context.firestore();
    await assertFails(getDoc(doc(user, 'users/alice')));
    await assertFails(getDoc(doc(user, 'users/alice/materials/material')));
    await assertFails(setDoc(doc(user, 'users/alice/settings/pricing'), settings));
    await assertFails(deleteDoc(doc(user, 'users/alice/materials/material')));
  }
});

test('profile cannot grant admin claims or change email/identity; entity identity is immutable', async () => {
  const user = alice();
  await setDoc(doc(user, 'users/alice'), profile);
  await assertFails(updateDoc(doc(user, 'users/alice'), { admin: true }));
  await assertFails(updateDoc(doc(user, 'users/alice'), { isAdmin: true }));
  await assertFails(updateDoc(doc(user, 'users/alice'), { email: 'other@example.com' }));
  await assertFails(updateDoc(doc(user, 'users/alice'), { createdAt: '2020-01-01' }));
  await setDoc(doc(user, 'users/alice/materials/material'), material);
  await assertFails(updateDoc(doc(user, 'users/alice/materials/material'), { id: 'other' }));
  await assertFails(updateDoc(doc(user, 'users/alice/materials/material'), { createdAt: '2020-01-01T10:00:00Z' }));
  await assertFails(setDoc(doc(user, 'users/alice/unknown/document'), { anything: true }));
});

test('settings and money validation reject invalid types, enums, unsafe margins and extra fields', async () => {
  const ref = doc(alice(), 'users/alice/settings/pricing');
  for (const invalid of [
    { defaultMarkupPercent: '-1' }, { defaultMarginPercent: '100' }, { defaultMarginPercent: '101' },
    { electricityTariffUahPerKwh: 5 }, { minOrderPriceUah: 'NaN' }, { minOrderPriceUah: '1e99' },
    { roundingMode: 'nearest' }, { pricingMode: 'magic' }, { theme: 'unknown' }, { owner: 'bob' },
  ]) await assertFails(setDoc(ref, { ...settings, ...invalid }));
  await assertFails(setDoc(doc(alice(), 'users/alice/materials/material'), { ...material, spoolsInStock: -1 }));
  await assertFails(setDoc(doc(alice(), 'users/alice/printers/printer'), { ...printer, costCalculationMode: 'wrong' }));
});

test('valid calculation snapshots include incomplete drafts; malformed nested data is rejected', async () => {
  const user = alice();
  for (const [index, item] of getInitialCalculationSnapshots().entries()) {
    const value = JSON.parse(JSON.stringify({ ...item, id: `example-${index}` }));
    await assertSucceeds(setDoc(doc(user, `users/alice/calculations/example-${index}`), value));
  }
  await assertFails(setDoc(doc(user, 'users/alice/calculations/calculation'), { ...snapshot, input: { ...snapshot.input, pricingMode: 'wrong' } }));
  await assertFails(setDoc(doc(user, 'users/alice/calculations/calculation'), { ...snapshot, result: { ...snapshot.result, sellingPriceUah: 100 } }));
  await assertFails(setDoc(doc(user, 'users/alice/calculations/calculation'), { ...snapshot, input: { ...snapshot.input, job: { ...snapshot.input.job, totalWeightGrams: -1 } } }));
});

test('only server-issued admin claims permit public catalog mutations, tombstones and reset', async () => {
  const user = alice();
  const admin = environment.authenticatedContext('administrator', { admin: true }).firestore();
  const filament = { ...PUBLIC_FILAMENTS_CATALOG[0], id: 'filament' };
  await assertFails(setDoc(doc(user, 'filaments/filament'), filament));
  await assertSucceeds(setDoc(doc(admin, 'filaments/filament'), filament));
  await assertSucceeds(setDoc(doc(admin, 'manufacturers/manufacturer'), { ...MANUFACTURERS_LIST[0], id: 'manufacturer' }));
  await assertSucceeds(setDoc(doc(admin, 'temperatureProfiles/PLA'), STANDARD_TEMPERATURE_PROFILES.PLA));
  await assertFails(updateDoc(doc(admin, 'filaments/filament'), { id: 'other' }));
  await assertFails(deleteDoc(doc(user, 'filaments/filament')));
  await assertSucceeds(setDoc(doc(admin, 'filaments/filament'), { id: 'filament', deleted: true }));
  await assertSucceeds(setDoc(doc(admin, 'temperatureProfiles/PLA'), { deleted: true }));
  await assertSucceeds(deleteDoc(doc(admin, 'filaments/filament')));
});

test('queries must carry bounded limits and only the owner can list private collections', async () => {
  const user = alice();
  await assertFails(getDocs(collection(user, 'users/alice/calculations')));
  await assertFails(getDocs(query(collection(user, 'users/alice/calculations'), limit(201))));
  await assertSucceeds(getDocs(query(collection(user, 'users/alice/calculations'), limit(200))));
  await assertFails(getDocs(query(collection(environment.authenticatedContext('bob').firestore(), 'users/alice/calculations'), limit(200))));
  await assertFails(getDocs(collection(user, 'filaments')));
});

test('demo persistence is explicit and isolated, failed real reads never use demo data', async () => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map<string, string>();
  const memoryStorage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage });
  try {
    localStorage.setItem('printcost_materials', JSON.stringify([{ id: 'another-account-secret' }]));
    await assert.rejects(api.materials.getAll(), /Firebase|акаунт/);
    await api.auth.enableDemoSession();
    const initial = await api.materials.getAll();
    assert.equal(initial.some((item) => item.id === 'another-account-secret'), false);
    const { id: _id, createdAt: _date, ...input } = INITIAL_MATERIALS[0];
    const created = await api.materials.create({ ...input, name: 'Демо матеріал' });
    assert.equal((await api.materials.getById(created.id))?.name, 'Демо матеріал');
    assert.equal(data.has('kilog_demo_materials'), true);
    await api.materials.archive(created.id);
    assert.equal((await api.materials.getById(created.id))?.isArchived, true);
    await api.materials.archive(created.id);
    assert.equal((await api.materials.getById(created.id))?.isArchived, false);
    await api.printers.setDefault(INITIAL_PRINTERS[1].id);
    assert.equal((await api.printers.getAll()).filter((item) => item.isDefault).length, 1);
    assert.equal((await api.settings.getSettings()).defaultPrinterId, INITIAL_PRINTERS[1].id);
    await assert.rejects(api.settings.importConfigJson('{"defaultMarginPercent":"100"}'), /Некоректні/);
    await assert.rejects(api.settings.importConfigJson('{"extra":true}'), /Невідомі поля/);
    await assert.rejects(api.settings.updateSettings({ defaultPrinterId: 'missing' }), /не існує/);
    const canonicalSettings = await api.settings.updateSettings({ electricityTariffUahPerKwh: '.5', defaultPackagingFeeUah: '12.', minOrderPriceUah: '650,50' });
    assert.equal(canonicalSettings.electricityTariffUahPerKwh, '0.5');
    assert.equal(canonicalSettings.defaultPackagingFeeUah, '12');
    assert.equal(canonicalSettings.minOrderPriceUah, '650.5');
    await assert.rejects(api.settings.updateSettings({ minOrderPriceUah: '0.1234567' }), /до 6/);
    await assert.rejects(api.settings.updateSettings({ minOrderPriceUah: 'NaN' }), /коректне/);
    const canonicalMaterial = await api.materials.update(created.id, { pricePerKgUah: '650,50', spoolWeightGrams: '1000.' });
    assert.equal(canonicalMaterial.pricePerKgUah, '650.5');
    assert.equal(canonicalMaterial.spoolWeightGrams, '1000');
    const { id: _snapshotId, createdAt: _snapshotDate, ...calculation } = snapshot;
    const canonicalCalculation = await api.calculations.save({ ...calculation, input: { ...calculation.input, electricityTariffUahPerKwh: '.5', operatorFeeUah: '12.', filaments: calculation.input.filaments.map((row: Record<string, unknown>) => ({ ...row, pricePerKgUah: '650,50' })) } });
    assert.equal(canonicalCalculation.input.electricityTariffUahPerKwh, '0.5');
    assert.equal(canonicalCalculation.input.operatorFeeUah, '12');
    assert.equal(canonicalCalculation.input.filaments[0].pricePerKgUah, '650.5');
    await assert.rejects(api.calculations.save({ ...calculation, input: { ...calculation.input, job: { ...calculation.input.job, plates: [null] } } }), /Некоректні дані/);
    const item = (await api.filaments.getAll())[0];
    await api.filaments.update(item.id, { inStock: false });
    const updated = await api.filaments.getById(item.id);
    assert.equal(updated?.inStock, false);
    assert.equal(updated?.stores.every((store) => store.inStock === false), true);
    assert.equal(updated?.popularColors.flatMap((color) => color.stores || []).every((store) => store.inStock === false), true);
    await api.filaments.delete(item.id);
    assert.equal(await api.filaments.getById(item.id), null);
    await api.catalog.reset();
    assert.ok(await api.filaments.getById(item.id));
    await api.auth.logout();
    await assert.rejects(api.materials.getAll(), /Firebase|акаунт/);
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
