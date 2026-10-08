import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestContext, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { INITIAL_MATERIALS, INITIAL_PRINTERS, INITIAL_PRICING_SETTINGS, getInitialCalculationSnapshots } from '../src/domain/defaultData.ts';
import { MANUFACTURERS_LIST, PUBLIC_FILAMENTS_CATALOG, STANDARD_TEMPERATURE_PROFILES } from '../src/domain/filamentsDirectory.ts';
import { api } from '../src/services/api.ts';
import { calculatePrintCost } from '../src/domain/calculator.ts';
import { createTaxPreset, TAX_SOURCE_URLS, type TaxSettings } from '../src/domain/taxes.ts';

let environment: RulesTestEnvironment;
const profile = { email: 'alice@example.com', fullName: 'Alice', workshopName: 'Майстерня', createdAt: '2026-10-08T10:00:00.000Z' };
const settings = { ...INITIAL_PRICING_SETTINGS, defaultPrinterId: null, filamentMappingPresets: {} };
const material = { ...INITIAL_MATERIALS[0], id: 'material' };
const printer = { ...INITIAL_PRINTERS[0], id: 'printer' };
const snapshot = JSON.parse(JSON.stringify({ ...getInitialCalculationSnapshots()[0], id: 'calculation' }));
const user = (id: string, claims: Record<string, unknown> = {}) => environment.authenticatedContext(id, { email: `${id}@example.com`, email_verified: true, ...claims }).firestore();
const alice = () => user('alice', { email: profile.email });
let changeCounter = 0;
const nextChange = () => `change-${++changeCounter}`;
const historicalTime = Timestamp.fromDate(new Date('2026-10-08T00:00:00Z'));

async function seedAuthorization(adminUids = ['administrator']) {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'system/authorization'), { adminUids, bootstrapUid: adminUids[0], initializedAt: historicalTime, version: 1, lastChangeId: 'seed' });
  });
}

async function seedDirectory(id: string, verified = true) {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), `userDirectory/${id}`), { uid: id, email: `${id}@example.com`, displayName: id, verified, updatedAt: historicalTime });
  });
}

type Role = 'user' | 'manager' | 'admin';
type TestFirestore = ReturnType<RulesTestContext['firestore']>;
type RoleOptions = {
  blocked?: boolean; companyId?: string | null; action?: 'role' | 'block'; auditId?: string;
  omit?: 'registry' | 'access' | 'membership' | 'audit';
  registry?: Record<string, unknown>; access?: Record<string, unknown>; membership?: Record<string, unknown>; audit?: Record<string, unknown>;
};

async function roleBatch(db: TestFirestore, actor: string, target: string, role: Role, options: RoleOptions = {}) {
  const registryRef = doc(db, 'system/authorization');
  const membershipRef = doc(db, `memberships/${target}`);
  const [registry, oldMembership] = await Promise.all([getDoc(registryRef), getDoc(membershipRef)]);
  const previous = registry.data()!;
  const id = options.auditId ?? nextChange();
  const blocked = options.blocked ?? false;
  const companyId = options.companyId ?? null;
  const batch = writeBatch(db);
  if (options.omit !== 'registry') batch.set(registryRef, {
    ...previous, version: previous.version + 1, lastChangeId: id,
    adminUids: [...previous.adminUids.filter((uid: string) => uid !== target), ...(role === 'admin' ? [target] : [])], ...options.registry,
  });
  if (options.omit !== 'access') batch.set(doc(db, `accountAccess/${target}`), { blocked, updatedAt: serverTimestamp(), updatedBy: actor, changeId: id, ...options.access });
  if (options.omit !== 'membership') batch.set(membershipRef, {
    companyId, active: role === 'manager', version: (oldMembership.data()?.version ?? 0) + 1,
    updatedAt: serverTimestamp(), updatedBy: actor, changeId: id, ...options.membership,
  });
  if (options.omit !== 'audit') batch.set(doc(db, `accessAudit/${id}`), {
    actorUid: actor, targetUid: target, action: options.action ?? 'role', role, companyId, blocked,
    createdAt: serverTimestamp(), registryVersion: previous.version + 1, ...options.audit,
  });
  return batch;
}

function bootstrapBatch(db: TestFirestore, id: string, auditId = nextChange(), omit?: 'audit' | 'membership' | 'access') {
  const batch = writeBatch(db);
  batch.set(doc(db, 'system/authorization'), { adminUids: [id], bootstrapUid: id, initializedAt: serverTimestamp(), version: 1, lastChangeId: auditId });
  if (omit !== 'access') batch.set(doc(db, `accountAccess/${id}`), { blocked: false, updatedAt: serverTimestamp(), updatedBy: id, changeId: auditId });
  if (omit !== 'membership') batch.set(doc(db, `memberships/${id}`), { companyId: null, active: false, version: 1, updatedAt: serverTimestamp(), updatedBy: id, changeId: auditId });
  if (omit !== 'audit') batch.set(doc(db, `accessAudit/${auditId}`), { actorUid: id, targetUid: id, action: 'bootstrap', role: 'admin', companyId: null, blocked: false, createdAt: serverTimestamp(), registryVersion: 1 });
  return batch;
}

async function companyBatch(db: TestFirestore, actor: string, id = 'company-a', overrides: Record<string, unknown> = {}, omitAudit = false) {
  const auditId = nextChange();
  const registry = (await getDoc(doc(db, 'system/authorization'))).data()!;
  const ref = doc(db, `companies/${id}`);
  const previous = (await getDoc(ref)).data();
  const batch = writeBatch(db);
  batch.set(ref, {
    id, name: 'Компанія A', website: 'https://shop.example.com', allowedDomains: ['shop.example.com'], status: 'active',
    createdBy: previous?.createdBy ?? actor, createdAt: previous?.createdAt ?? serverTimestamp(),
    version: (previous?.version ?? 0) + 1, updatedAt: serverTimestamp(), updatedBy: actor, changeId: auditId,
    ...overrides,
  });
  if (!omitAudit) batch.set(doc(db, `accessAudit/${auditId}`), { actorUid: actor, targetUid: '', action: 'company', role: 'user', companyId: id, blocked: false, createdAt: serverTimestamp(), registryVersion: registry.version });
  return batch;
}

function offerData(actor = 'alice', companyId = 'company-a', id = 'offer-a', overrides: Record<string, unknown> = {}) {
  return {
    id, companyId, createdBy: actor, updatedBy: actor, name: 'PLA White 1 кг', brand: 'Новий бренд', type: 'PLA', family: 'Стандартні',
    colorName: 'Білий', colorHex: '#ffffff', colorTone: 'white', packagingType: 'spool', spoolWeightGrams: 1000,
    priceUah: 599.99, diameterMm: 1.75, description: 'Пропозиція компанії', productUrl: 'https://shop.example.com/product/pla',
    inStock: true, status: 'published', version: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...overrides,
  };
}

async function setupOffers() {
  await seedAuthorization();
  await seedDirectory('alice');
  await seedDirectory('bob');
  const administrator = user('administrator');
  await (await companyBatch(administrator, 'administrator')).commit();
  await (await companyBatch(administrator, 'administrator', 'company-b', { name: 'Компанія B', website: 'https://shop-b.example.com', allowedDomains: ['shop-b.example.com'] })).commit();
  await (await roleBatch(administrator, 'administrator', 'alice', 'manager', { companyId: 'company-a' })).commit();
  await (await roleBatch(administrator, 'administrator', 'bob', 'manager', { companyId: 'company-b' })).commit();
  return { administrator, manager: alice(), otherManager: user('bob'), anonymous: environment.unauthenticatedContext().firestore() };
}

function taxSettings(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true, regime: 'fop3', scenario: 'cover', vatPayer: true, vatRatePercent: '20', unifiedTaxPercent: '3', incomeTaxPercent: '0', militaryTaxPercent: '1',
    monthlyUnifiedTaxUah: '0', monthlyMilitaryTaxUah: '0', monthlyEsvUah: '0', monthlyOtherUah: '0', monthlyOrders: '20', monthlyBillableHours: '100',
    allocationMode: 'orders', netTaxableIncomeUah: null, customerPriceUah: null, presetVersion: 'ua-2026-v1', presetEffectiveDate: '2026-01-01', ...overrides,
  };
}

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
  await seedAuthorization(['administrator']);
  await setDoc(doc(alice(), 'users/alice'), profile);
  await setDoc(doc(alice(), 'users/alice/materials/material'), material);
  for (const context of [environment.authenticatedContext('bob', { email_verified: true }), environment.authenticatedContext('administrator', { email_verified: true, admin: true })]) {
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

test('only verified unblocked registry administrators permit catalog mutations, tombstones and reset', async () => {
  await seedAuthorization();
  const user = alice();
  const admin = environment.authenticatedContext('administrator', { email_verified: true }).firestore();
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

test('bootstrap requires the exact verified email and all four atomic documents', async () => {
  const ownerEmail = 'web.developer.den@gmail.com';
  for (const [id, claims] of [['wrong', {}], ['unverified', { email: ownerEmail, email_verified: false }], ['claim-only', { admin: true }]] as const) {
    await assertFails(bootstrapBatch(user(id, claims), id).commit());
  }
  const bootstrap = user('founder', { email: ownerEmail });
  for (const omission of ['audit', 'membership', 'access'] as const) await assertFails(bootstrapBatch(bootstrap, 'founder', nextChange(), omission).commit());
  await assertSucceeds(bootstrapBatch(bootstrap, 'founder').commit());
  assert.deepEqual((await getDoc(doc(bootstrap, 'system/authorization'))).data()?.adminUids, ['founder']);
  await assertSucceeds(getDocs(query(collection(bootstrap, 'userDirectory'), limit(100))));
  await assertFails(bootstrapBatch(bootstrap, 'founder').commit());
  await assertFails(deleteDoc(doc(bootstrap, 'system/authorization')));
});

test('simultaneous bootstrap attempts cannot overwrite the first administrator', async () => {
  const claims = { email: 'web.developer.den@gmail.com' };
  const results = await Promise.allSettled([
    bootstrapBatch(user('founder-a', claims), 'founder-a').commit(),
    bootstrapBatch(user('founder-b', claims), 'founder-b').commit(),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  await environment.withSecurityRulesDisabled(async context => {
    const registry = (await getDoc(doc(context.firestore(), 'system/authorization'))).data()!;
    assert.equal(registry.adminUids.length, 1);
    assert.equal(registry.version, 1);
    assert.equal((await getDocs(collection(context.firestore(), 'accessAudit'))).size, 1);
  });
});

test('directory identity is token-controlled, bounded, private, and usable before verification', async () => {
  const aliceDb = alice();
  const value = { uid: 'alice', email: profile.email, displayName: 'Alice', verified: true, updatedAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(aliceDb, 'userDirectory/alice'), value));
  for (const patch of [{ uid: 'bob' }, { email: 'bob@example.com' }, { verified: false }, { displayName: 'x'.repeat(201) }, { role: 'admin' }, { updatedAt: historicalTime }]) {
    await assertFails(setDoc(doc(aliceDb, 'userDirectory/alice'), { ...value, ...patch }));
  }
  await assertFails(getDoc(doc(user('bob'), 'userDirectory/alice')));
  await assertFails(getDocs(query(collection(aliceDb, 'userDirectory'), limit(100))));
  const unverified = user('new-user', { email_verified: false });
  await assertSucceeds(setDoc(doc(unverified, 'userDirectory/new-user'), { uid: 'new-user', email: 'new-user@example.com', displayName: '', verified: false, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(unverified, 'userDirectory/new-user'), { verified: true, updatedAt: serverTimestamp() }));
  await seedAuthorization();
  const administrator = user('administrator');
  await assertSucceeds(getDocs(query(collection(administrator, 'userDirectory'), limit(100))));
  await assertFails(getDocs(query(collection(administrator, 'userDirectory'), limit(101))));
  await assertFails(getDocs(collection(administrator, 'userDirectory')));
  await assertFails(updateDoc(doc(administrator, 'userDirectory/alice'), { displayName: 'Admin rewrite', updatedAt: serverTimestamp() }));
});

test('custom claims and profile fields never grant registry or catalog authority', async () => {
  const forged = user('forged', { admin: true, role: 'admin' });
  await assertFails(setDoc(doc(forged, 'filaments/filament'), { ...PUBLIC_FILAMENTS_CATALOG[0], id: 'filament' }));
  await assertFails(setDoc(doc(forged, 'system/authorization'), { adminUids: ['forged'], bootstrapUid: 'forged', initializedAt: serverTimestamp(), version: 1, lastChangeId: nextChange() }));
  await seedAuthorization();
  await assertFails(setDoc(doc(forged, 'filaments/filament'), { ...PUBLIC_FILAMENTS_CATALOG[0], id: 'filament' }));
  await assertFails(updateDoc(doc(forged, 'system/authorization'), { adminUids: ['administrator', 'forged'] }));
  await assertFails(setDoc(doc(forged, 'memberships/forged'), { companyId: 'company-a', active: true, version: 1, updatedAt: serverTimestamp(), updatedBy: 'forged', changeId: nextChange() }));
  await assertFails(setDoc(doc(forged, 'accountAccess/forged'), { blocked: false, updatedAt: serverTimestamp(), updatedBy: 'forged', changeId: nextChange() }));
});

test('administrator grants and revokes another administrator with a fresh audit and canonical state', async () => {
  await seedAuthorization();
  await seedDirectory('administrator');
  await seedDirectory('alice');
  const administrator = user('administrator');
  await assertSucceeds((await roleBatch(administrator, 'administrator', 'alice', 'admin')).commit());
  await assertSucceeds(setDoc(doc(alice(), 'filaments/filament'), { ...PUBLIC_FILAMENTS_CATALOG[0], id: 'filament' }));
  await assertSucceeds((await roleBatch(administrator, 'administrator', 'alice', 'user')).commit());
  await assertFails(setDoc(doc(alice(), 'filaments/filament'), { ...PUBLIC_FILAMENTS_CATALOG[0], id: 'filament' }));
  assert.deepEqual((await getDoc(doc(administrator, 'system/authorization'))).data()?.adminUids, ['administrator']);
  assert.equal((await getDoc(doc(administrator, 'memberships/alice'))).data()?.version, 2);
  await assertFails((await roleBatch(administrator, 'administrator', 'administrator', 'user')).commit());
  await assertFails((await roleBatch(administrator, 'administrator', 'administrator', 'user', { blocked: true, action: 'block' })).commit());
  await seedDirectory('unverified', false);
  await assertFails((await roleBatch(administrator, 'administrator', 'unverified', 'admin')).commit());
});

test('roles cannot bypass atomic audit, forge actors, reuse events, or alter unrelated administrators', async () => {
  await seedAuthorization();
  await seedDirectory('alice');
  const administrator = user('administrator');
  for (const omission of ['registry', 'access', 'membership', 'audit'] as const) await assertFails((await roleBatch(administrator, 'administrator', 'alice', 'admin', { omit: omission })).commit());
  for (const options of [
    { audit: { actorUid: 'alice' } }, { audit: { targetUid: 'other' } }, { audit: { registryVersion: 99 } },
    { registry: { adminUids: ['administrator', 'alice', 'injected'] } }, { registry: { adminUids: ['administrator', 'alice', 'alice'] } },
    { registry: { bootstrapUid: 'alice' } }, { registry: { initializedAt: serverTimestamp() } },
    { access: { blocked: true } }, { access: { updatedBy: 'alice' } },
    { membership: { active: true, companyId: 'company-a' } }, { membership: { version: 99 } },
  ]) await assertFails((await roleBatch(administrator, 'administrator', 'alice', 'admin', options)).commit());
  const auditId = nextChange();
  await assertSucceeds((await roleBatch(administrator, 'administrator', 'alice', 'admin', { auditId })).commit());
  await assertFails((await roleBatch(administrator, 'administrator', 'alice', 'user', { auditId })).commit());
  await assertFails(updateDoc(doc(administrator, `accessAudit/${auditId}`), { role: 'user' }));
  await assertFails(deleteDoc(doc(administrator, `accessAudit/${auditId}`)));
  await assertFails(updateDoc(doc(administrator, 'memberships/alice'), { active: true }));
  await assertFails(updateDoc(doc(administrator, 'accountAccess/alice'), { blocked: true }));
});

test('concurrent demotions and blocks preserve at least one active administrator', async () => {
  await seedAuthorization(['administrator', 'alice']);
  await seedDirectory('administrator');
  await seedDirectory('alice');
  const adminDb = user('administrator');
  const aliceDb = alice();
  const [demote, block] = await Promise.all([
    roleBatch(adminDb, 'administrator', 'administrator', 'user'),
    roleBatch(aliceDb, 'alice', 'alice', 'user', { action: 'block', blocked: true }),
  ]);
  const results = await Promise.allSettled([demote.commit(), block.commit()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const registry = (await getDoc(doc(adminDb, 'system/authorization'))).data()!;
  assert.equal(registry.adminUids.length, 1);
  assert.equal(registry.version, 2);
});

test('blocking immediately revokes private CRUD and admin powers; own access state remains readable', async () => {
  await seedAuthorization(['administrator', 'alice']);
  await seedDirectory('alice');
  const aliceDb = alice();
  await setDoc(doc(aliceDb, 'users/alice'), profile);
  await setDoc(doc(aliceDb, 'users/alice/materials/material'), material);
  const administrator = user('administrator');
  await assertSucceeds((await roleBatch(administrator, 'administrator', 'alice', 'user', { action: 'block', blocked: true })).commit());
  await assertSucceeds(getDoc(doc(aliceDb, 'users/alice')));
  await assertSucceeds(getDoc(doc(aliceDb, 'accountAccess/alice')));
  await assertSucceeds(getDoc(doc(aliceDb, 'memberships/alice')));
  await assertFails(getDoc(doc(aliceDb, 'users/alice/materials/material')));
  await assertFails(getDocs(query(collection(aliceDb, 'users/alice/materials'), limit(200))));
  await assertFails(updateDoc(doc(aliceDb, 'users/alice/materials/material'), { name: 'Blocked update' }));
  await assertFails(deleteDoc(doc(aliceDb, 'users/alice/materials/material')));
  await assertFails(setDoc(doc(aliceDb, 'users/alice/settings/pricing'), settings));
  await assertFails(updateDoc(doc(aliceDb, 'users/alice'), { fullName: 'Blocked profile' }));
  await assertFails(getDocs(query(collection(aliceDb, 'userDirectory'), limit(100))));
  await assertFails(setDoc(doc(aliceDb, 'filaments/filament'), { ...PUBLIC_FILAMENTS_CATALOG[0], id: 'filament' }));
  await assertFails(updateDoc(doc(aliceDb, 'accountAccess/alice'), { blocked: false }));
  for (const role of ['user', 'manager', 'admin'] as const) {
    await assertFails((await roleBatch(administrator, 'administrator', 'alice', role, { companyId: role === 'manager' ? 'company-a' : null })).commit());
  }
  await assertSucceeds((await roleBatch(administrator, 'administrator', 'alice', 'user', { action: 'block', blocked: false })).commit());
  await assertSucceeds(getDoc(doc(aliceDb, 'users/alice/materials/material')));
  await assertFails(setDoc(doc(aliceDb, 'filaments/filament'), { ...PUBLIC_FILAMENTS_CATALOG[0], id: 'filament' }));
  await assertFails((await roleBatch(administrator, 'administrator', 'alice', 'user', { action: 'block', blocked: false })).commit());
});

test('unverified users can register a profile but cannot access private subcollections', async () => {
  const unverified = user('alice', { email: profile.email, email_verified: false });
  await assertSucceeds(setDoc(doc(unverified, 'users/alice'), profile));
  await assertSucceeds(getDoc(doc(unverified, 'users/alice')));
  await assertFails(setDoc(doc(unverified, 'users/alice/materials/material'), material));
  await assertFails(getDocs(query(collection(unverified, 'users/alice/materials'), limit(200))));
  await assertFails(setDoc(doc(unverified, 'users/alice/settings/pricing'), settings));
  await assertSucceeds(getDoc(doc(unverified, 'accountAccess/alice')));
  await assertSucceeds(getDoc(doc(unverified, 'memberships/alice')));
  await assertSucceeds(getDoc(doc(unverified, 'system/authorization')));
});

test('companies are public, bounded, administrator-only, versioned, and audited', async () => {
  await seedAuthorization();
  const administrator = user('administrator');
  await assertSucceeds((await companyBatch(administrator, 'administrator')).commit());
  const anonymous = environment.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anonymous, 'companies/company-a')));
  await assertSucceeds(getDocs(query(collection(anonymous, 'companies'), limit(200))));
  await assertFails(getDocs(query(collection(anonymous, 'companies'), limit(201))));
  await assertFails(getDocs(collection(anonymous, 'companies')));
  await assertFails((await companyBatch(alice(), 'alice', 'company-b')).commit());
  await assertFails((await companyBatch(administrator, 'administrator', 'company-b', {}, true)).commit());
  for (const invalid of [
    { name: 'x'.repeat(201) }, { name: '' }, { status: 'pending' }, { website: 'http://shop.example.com' },
    { website: '' }, { website: 'https://user:password@shop.example.com' }, { website: 'https://shop.example.com\\@evil.example.com' },
    { allowedDomains: [] }, { allowedDomains: ['a'.repeat(64) + '.example.com'] },
    { allowedDomains: ['shop.example.com', 100] }, { allowedDomains: Array(11).fill('shop.example.com') },
    { allowedDomains: ['shop.example.com', 'https://other.example.com'] }, { allowedDomains: ['SHOP.example.com'] },
    { allowedDomains: ['shop.example.com', 'shop.example.com'] }, { createdAt: historicalTime }, { createdBy: 'other' }, { secret: 'private' },
  ]) await assertFails((await companyBatch(administrator, 'administrator', 'company-b', invalid)).commit());
  await assertSucceeds((await companyBatch(administrator, 'administrator', 'company-a', { status: 'disabled' })).commit());
  assert.equal((await getDoc(doc(anonymous, 'companies/company-a'))).data()?.version, 2);
  for (const invalid of [{ version: 2 }, { createdBy: 'other' }, { createdAt: serverTimestamp() }, { id: 'company-b' }, { allowedDomains: [null] }, { name: 'x'.repeat(201) }]) {
    await assertFails((await companyBatch(administrator, 'administrator', 'company-a', invalid)).commit());
  }
  await assertFails(deleteDoc(doc(administrator, 'companies/company-a')));
});

test('manager assignment requires a verified target and active company, with no admin or directory authority', async () => {
  await seedAuthorization();
  await seedDirectory('alice');
  const administrator = user('administrator');
  await assertSucceeds((await companyBatch(administrator, 'administrator')).commit());
  await assertSucceeds((await companyBatch(administrator, 'administrator', 'company-b', { status: 'disabled' })).commit());
  await assertFails((await roleBatch(administrator, 'administrator', 'alice', 'manager', { companyId: 'missing' })).commit());
  await assertFails((await roleBatch(administrator, 'administrator', 'alice', 'manager', { companyId: 'company-b' })).commit());
  await assertFails((await roleBatch(administrator, 'administrator', 'alice', 'manager', { companyId: null })).commit());
  await assertSucceeds((await roleBatch(administrator, 'administrator', 'alice', 'manager', { companyId: 'company-a' })).commit());
  const membership = (await getDoc(doc(alice(), 'memberships/alice'))).data()!;
  assert.equal(membership.companyId, 'company-a');
  assert.equal(membership.active, true);
  await assertSucceeds((await companyBatch(administrator, 'administrator', 'company-b', { status: 'active' })).commit());
  await assertSucceeds((await roleBatch(administrator, 'administrator', 'alice', 'manager', { companyId: 'company-b' })).commit());
  assert.equal((await getDoc(doc(alice(), 'memberships/alice'))).data()?.companyId, 'company-b');
  assert.equal((await getDoc(doc(alice(), 'memberships/alice'))).data()?.version, 2);
  await assertFails(getDoc(doc(alice(), 'memberships/administrator')));
  await assertFails(getDocs(query(collection(alice(), 'memberships'), limit(100))));
  await assertFails(getDocs(query(collection(alice(), 'accountAccess'), limit(100))));
  await assertFails(getDocs(query(collection(alice(), 'accessAudit'), limit(100))));
  await assertFails((await companyBatch(alice(), 'alice', 'company-a', { name: 'Manager takeover' })).commit());
  await assertFails((await roleBatch(alice(), 'alice', 'alice', 'admin')).commit());
  await assertSucceeds((await roleBatch(administrator, 'administrator', 'alice', 'user', { action: 'block', blocked: true })).commit());
  const blockedMembership = (await getDoc(doc(alice(), 'memberships/alice'))).data()!;
  assert.equal(blockedMembership.companyId, null);
  assert.equal(blockedMembership.active, false);
});

test('32 administrators stay within Rules expression limits and a 33rd grant is denied', async () => {
  const admins = ['administrator', ...Array.from({ length: 31 }, (_, index) => `admin-${index}`)];
  await seedAuthorization(admins);
  await seedDirectory('alice');
  await seedDirectory('admin-30');
  const administrator = user('administrator');
  await assertFails((await roleBatch(administrator, 'administrator', 'alice', 'admin')).commit());
  await assertSucceeds((await roleBatch(administrator, 'administrator', 'admin-30', 'admin')).commit());
  await assertSucceeds((await companyBatch(administrator, 'administrator')).commit());
  await assertSucceeds((await roleBatch(administrator, 'administrator', 'alice', 'manager', { companyId: 'company-a' })).commit());
  assert.equal((await getDoc(doc(administrator, 'system/authorization'))).data()?.adminUids.length, 32);
});

test('a blocked designated bootstrap account cannot restore its own access', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'accountAccess/founder'), { blocked: true, updatedAt: historicalTime, updatedBy: 'external-recovery', changeId: 'recovery' });
  });
  const founder = user('founder', { email: 'web.developer.den@gmail.com' });
  await assertFails(bootstrapBatch(founder, 'founder').commit());
});

test('offers support own-company manager create/edit and public bounded published queries', async () => {
  const { manager, anonymous, administrator } = await setupOffers();
  const ref = doc(manager, 'companyOffers/offer-a');
  await assertSucceeds(setDoc(ref, offerData()));
  await assertSucceeds(updateDoc(ref, { priceUah: 900.29, version: 2, updatedAt: serverTimestamp(), updatedBy: 'alice' }));
  await assertSucceeds(getDoc(doc(anonymous, 'companyOffers/offer-a')));
  const published = await assertSucceeds(getDocs(query(collection(anonymous, 'companyOffers'), where('companyId', '==', 'company-a'), where('status', '==', 'published'), orderBy('createdAt', 'desc'), limit(50))));
  assert.equal(published.size, 1);
  await assertSucceeds(getDocs(query(collection(manager, 'companyOffers'), where('companyId', '==', 'company-a'), orderBy('createdAt', 'desc'), limit(50))));
  await assertSucceeds(getDocs(query(collection(administrator, 'companyOffers'), orderBy('createdAt', 'desc'), limit(50))));
  await assertFails(getDocs(query(collection(anonymous, 'companyOffers'), where('status', '==', 'published'), limit(50))));
  await assertFails(getDocs(query(collection(anonymous, 'companyOffers'), where('companyId', '==', 'company-a'), limit(50))));
  await assertFails(getDocs(query(collection(anonymous, 'companyOffers'), where('companyId', '==', 'company-a'), where('status', '==', 'published'), limit(51))));
  await assertFails(getDocs(collection(administrator, 'companyOffers')));
  await assertFails(deleteDoc(ref));
  await assertFails(deleteDoc(doc(administrator, 'companyOffers/offer-a')));
});

test('hidden and blocked offers are readable only by their active company manager or administrator', async () => {
  const { manager, otherManager, administrator, anonymous } = await setupOffers();
  await assertSucceeds(setDoc(doc(manager, 'companyOffers/offer-a'), offerData('alice', 'company-a', 'offer-a', { status: 'hidden' })));
  await assertSucceeds(getDoc(doc(manager, 'companyOffers/offer-a')));
  await assertSucceeds(getDoc(doc(administrator, 'companyOffers/offer-a')));
  await assertFails(getDoc(doc(anonymous, 'companyOffers/offer-a')));
  await assertFails(getDoc(doc(otherManager, 'companyOffers/offer-a')));
  await assertFails(getDocs(query(collection(otherManager, 'companyOffers'), where('companyId', '==', 'company-a'), limit(50))));
  await assertSucceeds(updateDoc(doc(administrator, 'companyOffers/offer-a'), { status: 'blocked', version: 2, updatedAt: serverTimestamp(), updatedBy: 'administrator' }));
  await assertSucceeds(getDoc(doc(manager, 'companyOffers/offer-a')));
  await assertFails(getDoc(doc(anonymous, 'companyOffers/offer-a')));
  for (const change of [{ status: 'published' }, { status: 'hidden' }, { priceUah: 800 }]) {
    await assertFails(updateDoc(doc(manager, 'companyOffers/offer-a'), { ...change, version: 3, updatedAt: serverTimestamp(), updatedBy: 'alice' }));
  }
  await assertSucceeds(updateDoc(doc(administrator, 'companyOffers/offer-a'), { status: 'published', version: 3, updatedAt: serverTimestamp(), updatedBy: 'administrator' }));
  await assertSucceeds(getDoc(doc(anonymous, 'companyOffers/offer-a')));
});

test('offer ownership and actors cannot be forged or moved across companies', async () => {
  const { manager, otherManager, administrator, anonymous } = await setupOffers();
  await assertFails(setDoc(doc(anonymous, 'companyOffers/offer-a'), offerData()));
  await assertFails(setDoc(doc(user('customer'), 'companyOffers/offer-a'), offerData('customer')));
  await assertFails(setDoc(doc(manager, 'companyOffers/offer-a'), offerData('bob')));
  await assertFails(setDoc(doc(manager, 'companyOffers/offer-a'), offerData('alice', 'company-b', 'offer-a', { productUrl: 'https://shop-b.example.com/product/pla' })));
  await assertFails(setDoc(doc(manager, 'companyOffers/offer-a'), offerData('alice', 'missing')));
  await assertFails(setDoc(doc(manager, 'companyOffers/offer-a'), offerData('alice', 'company-a', 'offer-a', { updatedBy: 'administrator' })));
  await assertFails(setDoc(doc(manager, 'companyOffers/offer-a'), offerData('alice', 'company-a', 'offer-a', { status: 'blocked' })));
  await assertSucceeds(setDoc(doc(manager, 'companyOffers/offer-a'), offerData()));
  await assertFails(updateDoc(doc(otherManager, 'companyOffers/offer-a'), { name: 'Takeover', version: 2, updatedAt: serverTimestamp(), updatedBy: 'bob' }));
  for (const change of [{ id: 'other' }, { companyId: 'company-b', productUrl: 'https://shop-b.example.com/product/pla' }, { createdBy: 'bob' }, { createdAt: serverTimestamp() }, { updatedBy: 'bob' }]) {
    await assertFails(updateDoc(doc(manager, 'companyOffers/offer-a'), { version: 2, updatedAt: serverTimestamp(), updatedBy: 'alice', ...change }));
  }
  await assertFails(updateDoc(doc(administrator, 'companyOffers/offer-a'), { companyId: 'company-b', productUrl: 'https://shop-b.example.com/product/pla', version: 2, updatedAt: serverTimestamp(), updatedBy: 'administrator' }));
  await assertFails(setDoc(doc(manager, 'filaments/forged'), { ...PUBLIC_FILAMENTS_CATALOG[0], id: 'forged' }));
});

test('offer product URLs require exact approved HTTPS hosts and reject credentials, ports and suffix attacks', async () => {
  const { manager } = await setupOffers();
  for (const productUrl of [
    'http://shop.example.com/product', 'javascript:alert(1)', 'https://shop.example.com.evil.example/product',
    'https://evilshop.example.com/product', 'https://sub.shop.example.com/product', 'https://shop.example.com@evil.example/product',
    'https://user:password@shop.example.com/product', 'https://shop.example.com:443/product', 'https://shop.example.com:8443/product',
    'https://shop.example.com\\@evil.example/product', 'https://shop.example.com%2eevil.example/product',
    'https://SHOP.example.com/product', 'https://shop.example.com./product', 'https://shop.example.com\n.evil.example/product',
  ]) await assertFails(setDoc(doc(manager, 'companyOffers/offer-a'), offerData('alice', 'company-a', 'offer-a', { productUrl })));
  for (const [index, productUrl] of ['https://shop.example.com', 'https://shop.example.com/product?sku=pla#white', 'https://shop.example.com/?next=https://other.example.com'].entries()) {
    await assertSucceeds(setDoc(doc(manager, `companyOffers/url-${index}`), offerData('alice', 'company-a', `url-${index}`, { productUrl })));
  }
});

test('offer create and update validate strict schemas, sizes, enums and exact two-decimal prices', async () => {
  const { manager } = await setupOffers();
  const ref = doc(manager, 'companyOffers/offer-a');
  const invalidValues = [
    { name: '' }, { name: 'x'.repeat(201) }, { brand: '' }, { brand: 'x'.repeat(201) }, { type: '' }, { type: 'x'.repeat(81) },
    { family: 'unknown' }, { colorName: '' }, { colorName: 'x'.repeat(101) }, { colorHex: 'red' }, { colorHex: '#FFFFFF' },
    { colorTone: 'ultraviolet' }, { packagingType: 'loose' }, { spoolWeightGrams: 0 }, { spoolWeightGrams: 0.5 }, { spoolWeightGrams: 100001 }, { spoolWeightGrams: '1000' },
    { priceUah: 0 }, { priceUah: -1 }, { priceUah: Number.NaN }, { priceUah: Number.POSITIVE_INFINITY }, { priceUah: 10000001 }, { priceUah: 600.333 }, { priceUah: 900.2900000000001 }, { priceUah: '600' },
    { diameterMm: 0 }, { diameterMm: 0.01 }, { diameterMm: 11 }, { diameterMm: '1.75' }, { description: 'x'.repeat(10001) },
    { productUrl: 'https://shop.example.com/' + 'x'.repeat(2000) },
    { inStock: 'yes' }, { status: 'pending' }, { version: 0 }, { version: 2 }, { verifiedSeller: true }, { createdAt: historicalTime }, { updatedAt: historicalTime },
  ];
  for (const invalid of invalidValues) await assertFails(setDoc(ref, offerData('alice', 'company-a', 'offer-a', invalid)));
  const missing = offerData();
  Reflect.deleteProperty(missing, 'brand');
  await assertFails(setDoc(ref, missing));
  await assertSucceeds(setDoc(ref, offerData()));
  for (const invalid of invalidValues.filter(value => !('createdAt' in value) && !('version' in value))) {
    await assertFails(updateDoc(ref, { version: 2, updatedAt: serverTimestamp(), updatedBy: 'alice', ...invalid }));
  }
  await assertFails(updateDoc(ref, { brand: deleteField(), version: 2, updatedAt: serverTimestamp(), updatedBy: 'alice' }));
  for (const [index, priceUah] of [0.01, 31, 95.12, 599.99, 900.29, 9999999.99, 10000000].entries()) {
    await assertSucceeds(setDoc(doc(manager, `companyOffers/price-${index}`), offerData('alice', 'company-a', `price-${index}`, { priceUah })));
  }
  await assertSucceeds(setDoc(doc(manager, 'companyOffers/boundary'), offerData('alice', 'company-a', 'boundary', { name: 'x'.repeat(200), spoolWeightGrams: 1, diameterMm: 0.1 })));
});

test('offer version comparisons reject stale edits and timestamps cannot be backdated', async () => {
  const { manager } = await setupOffers();
  const ref = doc(manager, 'companyOffers/offer-a');
  await setDoc(ref, offerData());
  await assertSucceeds(updateDoc(ref, { name: 'New name', version: 2, updatedAt: serverTimestamp(), updatedBy: 'alice' }));
  await assertFails(updateDoc(ref, { priceUah: 800, version: 2, updatedAt: serverTimestamp(), updatedBy: 'alice' }));
  await assertFails(updateDoc(ref, { priceUah: 800, version: 4, updatedAt: serverTimestamp(), updatedBy: 'alice' }));
  await assertFails(updateDoc(ref, { priceUah: 800, version: 3, updatedAt: historicalTime, updatedBy: 'alice' }));
  assert.equal((await getDoc(ref)).data()?.name, 'New name');
});

test('disabled companies hide published offers and stop manager mutations while admins retain moderation', async () => {
  const { manager, administrator, anonymous } = await setupOffers();
  await setDoc(doc(manager, 'companyOffers/offer-a'), offerData());
  await (await companyBatch(administrator, 'administrator', 'company-a', { status: 'disabled' })).commit();
  await assertFails(getDoc(doc(anonymous, 'companyOffers/offer-a')));
  await assertFails(getDocs(query(collection(anonymous, 'companyOffers'), where('companyId', '==', 'company-a'), where('status', '==', 'published'), limit(50))));
  await assertFails(getDoc(doc(manager, 'companyOffers/offer-a')));
  await assertFails(updateDoc(doc(manager, 'companyOffers/offer-a'), { name: 'Disabled edit', version: 2, updatedAt: serverTimestamp(), updatedBy: 'alice' }));
  await assertFails(setDoc(doc(manager, 'companyOffers/offer-new'), offerData('alice', 'company-a', 'offer-new')));
  await assertSucceeds(getDoc(doc(administrator, 'companyOffers/offer-a')));
  await assertSucceeds(updateDoc(doc(administrator, 'companyOffers/offer-a'), { status: 'blocked', version: 2, updatedAt: serverTimestamp(), updatedBy: 'administrator' }));
});

test('removed offer hosts forbid edits and republishing but allow an administrator to block the unchanged URL', async () => {
  const { manager, administrator } = await setupOffers();
  const ref = doc(manager, 'companyOffers/offer-a');
  await setDoc(ref, offerData());
  await (await companyBatch(administrator, 'administrator', 'company-a', { allowedDomains: ['new-shop.example.com'] })).commit();
  await assertFails(updateDoc(ref, { priceUah: 700, version: 2, updatedAt: serverTimestamp(), updatedBy: 'alice' }));
  await assertFails(updateDoc(doc(administrator, 'companyOffers/offer-a'), { status: 'published', version: 2, updatedAt: serverTimestamp(), updatedBy: 'administrator' }));
  await assertFails(updateDoc(doc(administrator, 'companyOffers/offer-a'), { status: 'blocked', productUrl: 'https://shop.example.com/changed', version: 2, updatedAt: serverTimestamp(), updatedBy: 'administrator' }));
  await assertSucceeds(updateDoc(doc(administrator, 'companyOffers/offer-a'), { status: 'blocked', version: 2, updatedAt: serverTimestamp(), updatedBy: 'administrator' }));
  await assertFails(updateDoc(doc(administrator, 'companyOffers/offer-a'), { status: 'published', version: 3, updatedAt: serverTimestamp(), updatedBy: 'administrator' }));
  await assertSucceeds(updateDoc(doc(administrator, 'companyOffers/offer-a'), { status: 'published', productUrl: 'https://new-shop.example.com/pla', version: 3, updatedAt: serverTimestamp(), updatedBy: 'administrator' }));
});

test('manager role revocation, blocking or unverified token immediately denies offer management', async () => {
  const { manager, administrator } = await setupOffers();
  await setDoc(doc(manager, 'companyOffers/offer-a'), offerData('alice', 'company-a', 'offer-a', { status: 'hidden' }));
  const unverified = user('alice', { email: profile.email, email_verified: false });
  await assertFails(getDoc(doc(unverified, 'companyOffers/offer-a')));
  await assertFails(updateDoc(doc(unverified, 'companyOffers/offer-a'), { name: 'Unverified edit', version: 2, updatedAt: serverTimestamp(), updatedBy: 'alice' }));
  await (await roleBatch(administrator, 'administrator', 'alice', 'user')).commit();
  await assertFails(getDoc(doc(manager, 'companyOffers/offer-a')));
  await assertFails(updateDoc(doc(manager, 'companyOffers/offer-a'), { status: 'published', version: 2, updatedAt: serverTimestamp(), updatedBy: 'alice' }));
  await (await roleBatch(administrator, 'administrator', 'alice', 'manager', { companyId: 'company-a' })).commit();
  await (await roleBatch(administrator, 'administrator', 'alice', 'user', { action: 'block', blocked: true })).commit();
  await assertFails(getDoc(doc(manager, 'companyOffers/offer-a')));
  await assertFails(updateDoc(doc(manager, 'companyOffers/offer-a'), { name: 'Blocked edit', version: 2, updatedAt: serverTimestamp(), updatedBy: 'alice' }));
});

test('private material VAT metadata is optional, strict and owner-only', async () => {
  const ref = doc(alice(), 'users/alice/materials/material');
  await assertSucceeds(setDoc(ref, material));
  await assertSucceeds(updateDoc(ref, { priceVatMode: 'included', vatRatePercent: '20', vatRecoverable: true }));
  for (const invalid of [
    { priceVatMode: 'inclusive' }, { priceVatMode: null }, { vatRatePercent: 20 }, { vatRatePercent: '-1' },
    { vatRatePercent: '100.000001' }, { vatRatePercent: 'NaN' }, { vatRatePercent: '1e2' }, { vatRatePercent: '20.0000001' },
    { vatRecoverable: 'true' }, { vatRecoverable: null }, { taxCreditUah: '100' },
  ]) await assertFails(updateDoc(ref, invalid));
  await assertSucceeds(updateDoc(ref, { priceVatMode: 'excluded', vatRatePercent: '100', vatRecoverable: false }));
  await assertFails(updateDoc(doc(user('bob'), 'users/alice/materials/material'), { vatRecoverable: true }));
  await seedAuthorization();
  await assertFails(updateDoc(doc(user('administrator'), 'users/alice/materials/material'), { vatRecoverable: true }));
});

test('tax settings retain legacy records and validate regimes, bases, precision and bounded values', async () => {
  const ref = doc(alice(), 'users/alice/settings/pricing');
  await assertSucceeds(setDoc(ref, settings));
  await assertSucceeds(setDoc(ref, { ...settings, tax: taxSettings() }));
  const accepted = [
    { regime: 'manual', vatPayer: true, unifiedTaxPercent: '100', incomeTaxPercent: '50.123456', militaryTaxPercent: '0', netTaxableIncomeUah: '-500', customerPriceUah: '999999999999.999999' },
    { regime: 'fop1', vatPayer: false, unifiedTaxPercent: '0', incomeTaxPercent: '0', militaryTaxPercent: '0', monthlyUnifiedTaxUah: '300', monthlyMilitaryTaxUah: '800' },
    { regime: 'fop2', vatPayer: false, unifiedTaxPercent: '0', incomeTaxPercent: '0', militaryTaxPercent: '0', allocationMode: 'hours' },
    { regime: 'fop3', vatPayer: false, unifiedTaxPercent: '5' },
    { regime: 'general', unifiedTaxPercent: '0', incomeTaxPercent: '18', militaryTaxPercent: '5', netTaxableIncomeUah: '-999999999999.999999' },
  ];
  for (const value of accepted) await assertSucceeds(setDoc(ref, { ...settings, tax: taxSettings(value) }));
  const rejected = [
    { enabled: 'true' }, { regime: 'unknown' }, { scenario: 'refund' }, { vatPayer: 'true' }, { vatRatePercent: '-1' }, { vatRatePercent: '100.000001' },
    { unifiedTaxPercent: 3 }, { incomeTaxPercent: 'NaN' }, { militaryTaxPercent: '1.0000001' },
    { monthlyEsvUah: '-1' }, { monthlyOtherUah: '1000000000000' }, { monthlyOtherUah: '1000000000000.000001' }, { monthlyOtherUah: '1000000000001' },
    { monthlyOrders: '0.5' }, { monthlyOrders: '1000000001' }, { monthlyBillableHours: '-1' }, { monthlyBillableHours: '1000000000.000001' },
    { allocationMode: 'minutes' }, { customerPriceUah: '-1' }, { customerPriceUah: 100 }, { netTaxableIncomeUah: '-1000000000000.000001' },
    { presetVersion: '' }, { presetVersion: 'x'.repeat(65) }, { presetEffectiveDate: 'yesterday' }, { extra: true },
    { regime: 'fop1', vatPayer: true }, { regime: 'fop2', vatPayer: false, unifiedTaxPercent: '1' },
    { regime: 'fop3', vatPayer: false, unifiedTaxPercent: '3' }, { regime: 'fop3', vatPayer: true, unifiedTaxPercent: '5' },
    { regime: 'fop3', militaryTaxPercent: '0' }, { regime: 'fop3', monthlyUnifiedTaxUah: '1' },
    { regime: 'general', unifiedTaxPercent: '0', incomeTaxPercent: '18', militaryTaxPercent: '4' },
  ];
  for (const value of rejected) await assertFails(setDoc(ref, { ...settings, tax: taxSettings(value) }));
  const missing = taxSettings();
  Reflect.deleteProperty(missing, 'monthlyEsvUah');
  await assertFails(setDoc(ref, { ...settings, tax: missing }));
  await assertFails(setDoc(ref, { ...settings, tax: null }));
  await assertFails(setDoc(doc(user('bob'), 'users/alice/settings/pricing'), { ...settings, tax: taxSettings() }));
});

test('taxed snapshots save actual domain results while legacy and 500-row snapshots remain valid', async () => {
  const db = alice();
  await assertSucceeds(setDoc(doc(db, 'users/alice/calculations/calculation'), snapshot));
  for (const [index, regime] of ['fop1', 'fop2', 'fop3', 'general', 'manual'].entries()) {
    const tax = createTaxPreset(regime as TaxSettings['regime'], regime === 'fop3');
    if (regime === 'general' || regime === 'manual') tax.netTaxableIncomeUah = '-500';
    const input = { ...snapshot.input, tax, filaments: snapshot.input.filaments.map((row: Record<string, unknown>) => ({ ...row, priceVatMode: 'included', vatRatePercent: '20', vatRecoverable: false })) };
    const result = calculatePrintCost(input);
    const id = `taxed-${index}`;
    const value = { ...snapshot, id, input, result, status: result.status };
    await assertSucceeds(setDoc(doc(db, `users/alice/calculations/${id}`), value));
    assert.equal((await getDoc(doc(db, `users/alice/calculations/${id}`))).data()?.result.tax.regime, regime);
    await assertSucceeds(setDoc(doc(db, `users/alice/calculations/${id}`), { ...value, title: `Saved ${regime}` }));
  }
  const large = { ...snapshot, id: 'large', input: { ...snapshot.input, filaments: Array.from({ length: 500 }, () => snapshot.input.filaments[0]) } };
  await assertSucceeds(setDoc(doc(db, 'users/alice/calculations/large'), large));
  await assertFails(setDoc(doc(db, 'users/alice/calculations/large'), { ...large, input: { ...large.input, filaments: Array.from({ length: 501 }, () => snapshot.input.filaments[0]) } }));
  await assertFails(setDoc(doc(user('bob'), 'users/alice/calculations/calculation'), snapshot));
});

test('tax snapshot input and result enforce strict fields, signed profit rules and trusted preset sources', async () => {
  const tax = createTaxPreset('fop3', true);
  tax.monthlyEsvUah = '0';
  const input = { ...snapshot.input, tax };
  const result = calculatePrintCost(input);
  const value = { ...snapshot, input, result, status: result.status };
  const ref = doc(alice(), 'users/alice/calculations/calculation');
  await assertSucceeds(setDoc(ref, value));
  for (const patch of [{ vatRatePercent: '101' }, { regime: 'unknown' }, { customerPriceUah: '-1' }, { monthlyEsvUah: '-1' }, { fakeExemption: true }]) {
    await assertFails(setDoc(ref, { ...value, input: { ...input, tax: { ...tax, ...patch } } }));
  }
  const missing = { ...result.tax };
  Reflect.deleteProperty(missing, 'vatUah');
  await assertFails(setDoc(ref, { ...value, result: { ...result, tax: missing } }));
  for (const patch of [
    { unifiedTaxUah: '-1' }, { vatUah: '-1' }, { totalPaymentsUah: 'NaN' }, { grossPriceUah: 100 },
    { netTaxableIncomeUah: '-1' }, { profitAfterTaxUah: '1e10' }, { marginAfterTaxPercent: '-1.0000001' },
    { incomeTaxUah: '1000000000000' }, { scenario: 'refund' }, { presetVersion: 'x'.repeat(65) }, { invented: true },
    { sourceUrls: ['https://evil.example/tax'] }, { sourceUrls: [TAX_SOURCE_URLS[0], 100] }, { sourceUrls: [...TAX_SOURCE_URLS, TAX_SOURCE_URLS[0]] },
  ]) await assertFails(setDoc(ref, { ...value, result: { ...result, tax: { ...result.tax, ...patch } } }));
  await assertSucceeds(setDoc(ref, { ...value, result: { ...result, tax: { ...result.tax, profitBeforeTaxUah: '-500.00', profitAfterTaxUah: '-600.00', marginAfterTaxPercent: '-60.00', netTaxableIncomeUah: '0.00' } } }));
});

test('numeric batches reject coercion, separators and every missing mandatory field', async () => {
  const tax = createTaxPreset('fop3', true);
  tax.monthlyEsvUah = '0';
  const input = { ...snapshot.input, tax };
  const result = calculatePrintCost(input);
  const value = { ...snapshot, input, result, status: result.status };
  const ref = doc(alice(), 'users/alice/calculations/calculation');
  await assertSucceeds(setDoc(ref, value));
  const groups: [string, Record<string, unknown>, (patch: Record<string, unknown>) => unknown][] = [
    ['input', input, patch => ({ ...value, input: patch })],
    ['result', result as unknown as Record<string, unknown>, patch => ({ ...value, result: patch })],
    ['input.tax', tax as unknown as Record<string, unknown>, patch => ({ ...value, input: { ...input, tax: patch } })],
    ['result.tax', result.tax as unknown as Record<string, unknown>, patch => ({ ...value, result: { ...result, tax: patch } })],
  ];
  for (const [location, original, build] of groups) {
    const amounts = Object.entries(original).filter(([key, v]) => typeof v === 'string' && (key.endsWith('Uah') || key.endsWith('Percent') || key === 'totalWeightGrams' || key === 'totalEnergyKwh'));
    for (const [field] of amounts) {
      for (const forged of [1, true, null, ['1'], { value: '1' }, '1|2']) {
        await assert.rejects(setDoc(ref, build({ ...original, [field]: forged }) as typeof value), { code: 'permission-denied' }, `${location}.${field} accepted ${JSON.stringify(forged)}`);
      }
    }
    for (const field of Object.keys(original).filter(key => key !== 'tax')) {
      const missing = { ...original, unknownReplacement: true };
      Reflect.deleteProperty(missing, field);
      await assert.rejects(setDoc(ref, build(missing) as typeof value), { code: 'permission-denied' }, `${location}.${field} can be replaced by an unknown key`);
    }
  }
  for (const field of ['fileSizeBytes', 'totalPredictionSeconds', 'totalWeightGrams']) {
    for (const forged of ['1', true, null, [], {}]) {
      await assertFails(setDoc(ref, { ...value, input: { ...input, job: { ...input.job, [field]: forged } } }));
    }
  }
  for (const field of ['fileName', 'fileSizeBytes', 'slicerSource', 'plates', 'totalPredictionSeconds', 'totalWeightGrams', 'warnings', 'parseStatus']) {
    const missing = { ...input.job, unknownReplacement: true };
    Reflect.deleteProperty(missing, field);
    await assertFails(setDoc(ref, { ...value, input: { ...input, job: missing } }));
  }
  await assertFails(setDoc(ref, { ...value, result: { ...result, totalDurationSeconds: '1' } }));
  await assertSucceeds(setDoc(ref, value));
});

test('fully taxed updates persist nonnull general bases and maximum manual precision', async () => {
  const ref = doc(alice(), 'users/alice/calculations/calculation');
  for (const tax of [
    { ...createTaxPreset('general', true), scenario: 'estimate' as const, customerPriceUah: '1500', netTaxableIncomeUah: '500' },
    { ...createTaxPreset('manual'), scenario: 'estimate' as const, customerPriceUah: '1500', netTaxableIncomeUah: '999999999999.999999', monthlyOrders: '1000000000', monthlyBillableHours: '1000000000' },
  ]) {
    const input = { ...snapshot.input, tax };
    const result = calculatePrintCost(input);
    assert.ok(result.tax);
    const value = { ...snapshot, input, result, status: result.status };
    await assertSucceeds(setDoc(ref, value));
    await assertSucceeds(setDoc(ref, { ...value, title: 'Updated complete taxable snapshot' }));
    assert.equal((await getDoc(ref)).data()?.result.tax.netTaxableIncomeUah, tax.netTaxableIncomeUah);
  }
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
