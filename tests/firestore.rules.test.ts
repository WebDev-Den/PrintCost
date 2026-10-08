import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestContext, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, deleteField, doc, documentId, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, startAfter, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { INITIAL_MATERIALS, INITIAL_PRINTERS, INITIAL_PRICING_SETTINGS, getInitialCalculationSnapshots } from '../src/domain/defaultData.ts';
import { MANUFACTURERS_LIST, PUBLIC_FILAMENTS_CATALOG, STANDARD_TEMPERATURE_PROFILES } from '../src/domain/filamentsDirectory.ts';
import { api } from '../src/services/api.ts';
import { calculatePrintCost } from '../src/domain/calculator.ts';
import { CALCULATION_ALGORITHM_VERSION, extractTemplateParameters, validateCalculationTemplate } from '../src/domain/calculationTemplates.ts';
import { createTaxPreset, TAX_SOURCE_URLS, type TaxSettings } from '../src/domain/taxes.ts';

let environment: RulesTestEnvironment;
// Each run owns an isolated emulator namespace; clearFirestore never touches browser fixtures.
const testProjectId = `demo-kilog-rules-${crypto.randomUUID().slice(0, 8)}`;
const profile = { email: 'alice@example.com', fullName: 'Alice', workshopName: 'Майстерня', createdAt: '2026-10-08T10:00:00.000Z' };
const settings = { ...INITIAL_PRICING_SETTINGS, defaultPrinterId: null, filamentMappingPresets: {} };
const material = { ...INITIAL_MATERIALS[0], id: 'material' };
const printer = { ...INITIAL_PRINTERS[0], id: 'printer' };
const snapshot = JSON.parse(JSON.stringify({ ...getInitialCalculationSnapshots()[0], id: 'calculation', algorithmVersion: CALCULATION_ALGORITHM_VERSION }));
const user = (id: string, claims: Record<string, unknown> = {}) => environment.authenticatedContext(id, { email: `${id}@example.com`, email_verified: true, ...claims }).firestore();
const alice = () => user('alice', { email: profile.email });
const recentUser = (id = 'alice', ageSeconds = 0, claims: Record<string, unknown> = {}) => user(id, { auth_time: Math.floor(Date.now() / 1000) - ageSeconds, ...claims });
let snapshotCounter = 0;
function writeNewSnapshot(value: Record<string, unknown>) {
  const id = `new-snapshot-${++snapshotCounter}`;
  return setDoc(doc(alice(), `users/alice/calculations/${id}`), { ...value, id });
}
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

async function seedUnblockedAccess(id = 'alice') {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), `accountAccess/${id}`), { blocked: false, updatedAt: historicalTime, updatedBy: 'administrator', changeId: 'seed' });
  });
}

type Role = 'user' | 'manager' | 'admin';
type TestFirestore = ReturnType<RulesTestContext['firestore']>;
type RoleOptions = {
  blocked?: boolean; companyId?: string | null; action?: 'role' | 'block'; auditId?: string;
  reverseWrites?: boolean;
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
  const writes: Array<() => void> = [];
  if (options.omit !== 'registry') writes.push(() => batch.set(registryRef, {
    ...previous, version: previous.version + 1, lastChangeId: id,
    adminUids: [...previous.adminUids.filter((uid: string) => uid !== target), ...(role === 'admin' ? [target] : [])], ...options.registry,
  }));
  if (options.omit !== 'access') writes.push(() => batch.set(doc(db, `accountAccess/${target}`), { blocked, updatedAt: serverTimestamp(), updatedBy: actor, changeId: id, ...options.access }));
  if (options.omit !== 'membership') writes.push(() => batch.set(membershipRef, {
    companyId, active: role === 'manager', version: (oldMembership.data()?.version ?? 0) + 1,
    updatedAt: serverTimestamp(), updatedBy: actor, changeId: id, ...options.membership,
  }));
  if (options.omit !== 'audit') writes.push(() => batch.set(doc(db, `accessAudit/${id}`), {
    actorUid: actor, targetUid: target, action: options.action ?? 'role', role, companyId, blocked,
    createdAt: serverTimestamp(), registryVersion: previous.version + 1, ...options.audit,
  }));
  (options.reverseWrites ? writes.reverse() : writes).forEach(write => write());
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

type DeletionOptions = {
  changeId?: string; omit?: 'marker' | 'registry' | 'access' | 'membership' | 'audit';
  marker?: Record<string, unknown>; registry?: Record<string, unknown>; access?: Record<string, unknown>;
  membership?: Record<string, unknown>; audit?: Record<string, unknown>;
};
async function deletionBatch(db: TestFirestore, target = 'alice', options: DeletionOptions = {}) {
  const registryRef = doc(db, 'system/authorization');
  const memberRef = doc(db, `memberships/${target}`);
  const [registry, membership] = await Promise.all([getDoc(registryRef), getDoc(memberRef)]);
  const id = options.changeId ?? crypto.randomUUID();
  const batch = writeBatch(db);
  if (options.omit !== 'marker') batch.set(doc(db, `accountDeletion/${target}`), { uid: target, startedAt: serverTimestamp(), changeId: id, ...options.marker });
  if (options.omit !== 'registry' && (registry.exists() || options.registry)) batch.set(registryRef, {
    ...(registry.data() ?? { adminUids: ['administrator'], bootstrapUid: 'administrator', initializedAt: historicalTime, version: 0 }),
    adminUids: registry.data()?.adminUids.filter((uid: string) => uid !== target) ?? ['administrator'],
    version: (registry.data()?.version ?? 0) + 1, lastChangeId: id, ...options.registry,
  });
  if (options.omit !== 'access') batch.set(doc(db, `accountAccess/${target}`), { blocked: true, updatedAt: serverTimestamp(), updatedBy: target, changeId: id, ...options.access });
  if (options.omit !== 'membership') batch.set(memberRef, { companyId: null, active: false, version: (membership.data()?.version ?? 0) + 1, updatedAt: serverTimestamp(), updatedBy: target, changeId: id, ...options.membership });
  if (options.omit !== 'audit') batch.set(doc(db, `accessAudit/${id}`), { actorUid: target, targetUid: target, action: 'delete', role: 'user', companyId: null, blocked: true, createdAt: serverTimestamp(), registryVersion: (registry.data()?.version ?? -1) + 1, ...options.audit });
  return { batch, id };
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
    projectId: testProjectId,
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
    const value = JSON.parse(JSON.stringify({ ...item, id: `example-${index}`, algorithmVersion: CALCULATION_ALGORITHM_VERSION }));
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

test('32-admin role transitions with existing access and membership metadata retain budget headroom', async () => {
  const admins = ['administrator', 'alice', ...Array.from({ length: 30 }, (_, index) => `admin-${index}`)];
  await seedAuthorization(admins);
  await seedDirectory('alice');
  await seedUnblockedAccess('administrator');
  await seedUnblockedAccess();
  await environment.withSecurityRulesDisabled(async context => {
    for (const id of ['administrator', 'alice']) await setDoc(doc(context.firestore(), `memberships/${id}`), {
      companyId: null, active: false, version: 7, updatedAt: historicalTime, updatedBy: 'administrator', changeId: 'seed',
    });
  });
  const administrator = user('administrator');
  await (await companyBatch(administrator, 'administrator')).commit();
  for (const reverseWrites of [false, true]) {
    await assertSucceeds((await roleBatch(administrator, 'administrator', 'alice', 'manager', { companyId: 'company-a', reverseWrites })).commit());
    await assertSucceeds((await roleBatch(administrator, 'administrator', 'alice', 'user', { reverseWrites })).commit());
    await assertSucceeds((await roleBatch(administrator, 'administrator', 'alice', 'manager', { companyId: 'company-a', reverseWrites })).commit());
    await assertSucceeds((await roleBatch(administrator, 'administrator', 'alice', 'admin', { reverseWrites })).commit());
    const stale = await roleBatch(administrator, 'administrator', 'alice', 'user', { reverseWrites });
    await assertSucceeds((await roleBatch(administrator, 'administrator', 'alice', 'user', { action: 'block', blocked: true, reverseWrites })).commit());
    await assertFails(stale.commit());
    await assertSucceeds((await roleBatch(administrator, 'administrator', 'alice', 'user', { action: 'block', blocked: false, reverseWrites })).commit());
    await assertSucceeds((await roleBatch(administrator, 'administrator', 'alice', 'admin', { reverseWrites })).commit());
  }
  assert.equal((await getDoc(doc(administrator, 'system/authorization'))).data()?.adminUids.length, 32);
});

test('32-admin departures with existing metadata retain CAS and immutable bootstrap fields', async () => {
  const admins = ['administrator', 'alice', ...Array.from({ length: 30 }, (_, index) => `admin-${index}`)];
  await seedAuthorization(admins);
  await environment.withSecurityRulesDisabled(async context => {
    for (const id of ['alice', 'ordinary']) {
      await setDoc(doc(context.firestore(), `accountAccess/${id}`), { blocked: false, updatedAt: historicalTime, updatedBy: 'administrator', changeId: 'seed' });
      await setDoc(doc(context.firestore(), `memberships/${id}`), { companyId: null, active: false, version: 7, updatedAt: historicalTime, updatedBy: 'administrator', changeId: 'seed' });
    }
  });
  const administrator = user('administrator');
  const ordinary = recentUser('ordinary');
  const admin = recentUser();
  const stale = await deletionBatch(admin);
  await assertSucceeds((await deletionBatch(ordinary, 'ordinary')).batch.commit());
  assert.equal((await getDoc(doc(administrator, 'system/authorization'))).data()?.adminUids.length, 32);
  await assertFails(stale.batch.commit());
  await assertSucceeds((await deletionBatch(admin)).batch.commit());
  const registry = (await getDoc(doc(administrator, 'system/authorization'))).data()!;
  assert.equal(registry.adminUids.length, 31);
  assert.equal(registry.version, 3);
  assert.equal(registry.bootstrapUid, 'administrator');
  assert.ok(registry.initializedAt.isEqual(historicalTime));
  assert.equal(registry.adminUids.includes('alice'), false);
  await assertFails((await deletionBatch(admin)).batch.commit());
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
  await seedUnblockedAccess();
  const db = alice();
  await assertSucceeds(setDoc(doc(db, 'users/alice/calculations/calculation'), snapshot));
  for (const [index, regime] of ['fop1', 'fop2', 'fop3', 'general', 'manual'].entries()) {
    const tax = createTaxPreset(regime as TaxSettings['regime'], regime === 'fop3');
    if (regime === 'general' || regime === 'manual') tax.netTaxableIncomeUah = '-500';
    const input = { ...snapshot.input, tax, filaments: snapshot.input.filaments.map((row: Record<string, unknown>) => ({ ...row, priceVatMode: 'included', vatRatePercent: '20', vatRecoverable: false })) };
    const result = calculatePrintCost(input);
    const id = `taxed-${index}`;
    const value = { ...snapshot, id, input, result, status: result.status, clientName: 'C'.repeat(200), notes: 'N'.repeat(10000), sourceCalculationId: `source-${index}` };
    await assertSucceeds(setDoc(doc(db, `users/alice/calculations/${id}`), value));
    assert.equal((await getDoc(doc(db, `users/alice/calculations/${id}`))).data()?.result.tax.regime, regime);
    await assertSucceeds(setDoc(doc(db, `users/alice/calculations/${id}`), { ...value, title: `Saved ${regime}` }));
    await assertSucceeds(writeNewSnapshot({ ...value, sourceCalculationId: id, title: `Copy ${regime}` }));
  }
  const large = { ...snapshot, id: 'large', input: { ...snapshot.input, filaments: Array.from({ length: 500 }, () => snapshot.input.filaments[0]) } };
  await assertSucceeds(setDoc(doc(db, 'users/alice/calculations/large'), large));
  await assertFails(writeNewSnapshot({ ...large, input: { ...large.input, filaments: Array.from({ length: 501 }, () => snapshot.input.filaments[0]) } }));
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
    await assertFails(writeNewSnapshot({ ...value, input: { ...input, tax: { ...tax, ...patch } } }));
  }
  const missing = { ...result.tax };
  Reflect.deleteProperty(missing, 'vatUah');
  await assertFails(writeNewSnapshot({ ...value, result: { ...result, tax: missing } }));
  for (const patch of [
    { unifiedTaxUah: '-1' }, { vatUah: '-1' }, { totalPaymentsUah: 'NaN' }, { grossPriceUah: 100 },
    { netTaxableIncomeUah: '-1' }, { profitAfterTaxUah: '1e10' }, { marginAfterTaxPercent: '-1.0000001' },
    { incomeTaxUah: '1000000000000' }, { scenario: 'refund' }, { presetVersion: 'x'.repeat(65) }, { invented: true },
    { sourceUrls: ['https://evil.example/tax'] }, { sourceUrls: [TAX_SOURCE_URLS[0], 100] }, { sourceUrls: [...TAX_SOURCE_URLS, TAX_SOURCE_URLS[0]] },
  ]) await assertFails(writeNewSnapshot({ ...value, result: { ...result, tax: { ...result.tax, ...patch } } }));
  await assertSucceeds(writeNewSnapshot({ ...value, result: { ...result, tax: { ...result.tax, profitBeforeTaxUah: '-500.00', profitAfterTaxUah: '-600.00', marginAfterTaxPercent: '-60.00', netTaxableIncomeUah: '0.00' } } }));
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
    const amounts = Object.entries(original).filter(([key, v]) => typeof v === 'string' && (key.endsWith('Uah') || key.endsWith('Percent') || ['totalWeightGrams', 'totalEnergyKwh', 'averagePowerWatts', 'markupPercentActual'].includes(key)));
    for (const [field] of amounts) {
      for (const forged of [1, true, null, ['1'], { value: '1' }, '1|2']) {
        await assert.rejects(writeNewSnapshot(build({ ...original, [field]: forged }) as Record<string, unknown>), { code: 'permission-denied' }, `${location}.${field} accepted ${JSON.stringify(forged)}`);
      }
    }
    for (const field of Object.keys(original).filter(key => key !== 'tax')) {
      const missing = { ...original, unknownReplacement: true };
      Reflect.deleteProperty(missing, field);
      await assert.rejects(writeNewSnapshot(build(missing) as Record<string, unknown>), { code: 'permission-denied' }, `${location}.${field} can be replaced by an unknown key`);
    }
  }
  for (const field of ['fileSizeBytes', 'totalPredictionSeconds', 'totalWeightGrams']) {
    for (const forged of ['1', true, null, [], {}]) {
      await assertFails(writeNewSnapshot({ ...value, input: { ...input, job: { ...input.job, [field]: forged } } }));
    }
  }
  for (const field of ['fileName', 'fileSizeBytes', 'slicerSource', 'plates', 'totalPredictionSeconds', 'totalWeightGrams', 'warnings', 'parseStatus']) {
    const missing = { ...input.job, unknownReplacement: true };
    Reflect.deleteProperty(missing, field);
    await assertFails(writeNewSnapshot({ ...value, input: { ...input, job: missing } }));
  }
  await assertFails(writeNewSnapshot({ ...value, result: { ...result, totalDurationSeconds: '1' } }));
  await assertSucceeds(setDoc(ref, value));
});

test('fully taxed updates persist nonnull general bases and maximum manual precision', async () => {
  await seedUnblockedAccess();
  for (const [index, tax] of [
    { ...createTaxPreset('general', true), scenario: 'estimate' as const, customerPriceUah: '1500', netTaxableIncomeUah: '500' },
    { ...createTaxPreset('manual'), scenario: 'estimate' as const, customerPriceUah: '1500', netTaxableIncomeUah: '999999999999.999999', monthlyOrders: '1000000000', monthlyBillableHours: '1000000000' },
  ].entries()) {
    const id = `fully-taxed-${index}`;
    const ref = doc(alice(), `users/alice/calculations/${id}`);
    const input = { ...snapshot.input, tax };
    const result = calculatePrintCost(input);
    assert.ok(result.tax);
    const value = { ...snapshot, id, input, result, status: result.status, clientName: 'C'.repeat(200), notes: 'N'.repeat(10000), sourceCalculationId: `source-${index}` };
    await assertSucceeds(setDoc(ref, value));
    await assertSucceeds(setDoc(ref, { ...value, title: 'Updated complete taxable snapshot' }));
    assert.equal((await getDoc(ref)).data()?.result.tax.netTaxableIncomeUah, tax.netTaxableIncomeUah);
    await assertSucceeds(writeNewSnapshot({ ...value, sourceCalculationId: id, algorithmVersion: 'legacy' }));
  }
});

const templateFixture = () => ({
  id: 'template', name: 'PLA print', parameters: extractTemplateParameters(snapshot.input),
  materialMappings: { PLA: 'material' }, version: 1, createdAt: profile.createdAt, updatedAt: profile.createdAt,
});
let templateCounter = 0;
function writeNewTemplate(value: Record<string, unknown>) {
  const id = `template-case-${++templateCounter}`;
  return setDoc(doc(alice(), `users/alice/templates/${id}`), { ...value, id });
}

test('templates persist all scalar parameters, tax and 100 mappings with CAS updates', async () => {
  await seedUnblockedAccess();
  const fixture = templateFixture();
  const large = { ...fixture, parameters: { ...fixture.parameters, tax: createTaxPreset('general', true) }, materialMappings: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`CUSTOM-TYPE${i}`, `material-${i}`])) };
  const normalized = validateCalculationTemplate(large);
  const ref = doc(alice(), 'users/alice/templates/template');
  await assertSucceeds(setDoc(ref, normalized));
  await assertSucceeds(updateDoc(ref, { version: 2, name: 'Saved template', updatedAt: '2026-10-08T11:00:00.000Z' }));
  await assertFails(updateDoc(ref, { version: 2, name: 'Stale version' }));
  await assertFails(updateDoc(ref, { version: 4, name: 'Skipped version' }));
  await assertFails(updateDoc(ref, { version: 3, createdAt: '2020-01-01T00:00:00.000Z' }));
  await assertFails(updateDoc(ref, { version: 3, id: 'other' }));
  await assertSucceeds(getDocs(query(collection(alice(), 'users/alice/templates'), limit(51))));
  await assertFails(getDocs(query(collection(alice(), 'users/alice/templates'), limit(101))));
  await assertFails(getDocs(collection(alice(), 'users/alice/templates')));
  await assertSucceeds(writeNewTemplate({ ...fixture, materialMappings: {}, parameters: { ...fixture.parameters, selectedPrinterId: null, electricityTariffUahPerKwh: null } }));
  await assertSucceeds(deleteDoc(ref));
});

test('template schemas reject invalid parameters, mapping values, sizes and creation versions', async () => {
  const fixture = templateFixture();
  for (const patch of [
    { name: '' }, { name: ' ' }, { name: 'x'.repeat(121) }, { name: 1 }, { version: 0 }, { version: 2 }, { version: 1.5 },
    { createdAt: 'bad' }, { createdAt: '2026-10-08Tgarbage' }, { updatedAt: '2026-99-99T99:99:99Z' }, { updatedAt: 'bad' }, { updatedAt: 1 }, { updatedAt: 'x'.repeat(41) }, { role: 'admin' }, { ownerUid: 'bob' },
    { materialMappings: [] }, { materialMappings: null }, { materialMappings: { PLA: '' } }, { materialMappings: { PLA: ' ' } }, { materialMappings: { PLA: '.' } },
    { materialMappings: { PLA: '..' } }, { materialMappings: { PLA: 'users/bob/material' } }, { materialMappings: { PLA: 'x'.repeat(181) } },
  ]) await assertFails(writeNewTemplate({ ...fixture, ...patch }));
  for (const field of Object.keys(fixture)) {
    if (field === 'id') continue;
    const missing = { ...fixture, unknownReplacement: true };
    Reflect.deleteProperty(missing, field);
    await assertFails(writeNewTemplate(missing));
  }
  for (const patch of [
    { selectedPrinterId: '' }, { selectedPrinterId: 1 }, { selectedPrinterId: 'users/bob/printer' }, { averagePowerWatts: 10 },
    { machineHourlyRateUah: '1|2' }, { operatorFeeUah: '-1' }, { marginPercent: '100' }, { roundingMode: 'nearest' },
    { pricingMode: 'unknown' }, { minOrderPriceUah: 'NaN' }, { minOrderPriceUah: '1.1234567' }, { job: snapshot.input.job }, { filaments: [] },
    { tax: { ...createTaxPreset(), militaryTaxPercent: '100.000001' } },
  ]) await assertFails(writeNewTemplate({ ...fixture, parameters: { ...fixture.parameters, ...patch } }));
  for (const field of Object.keys(fixture.parameters)) {
    const missing = { ...fixture.parameters, unknownReplacement: true };
    Reflect.deleteProperty(missing, field);
    await assertFails(writeNewTemplate({ ...fixture, parameters: missing }));
  }
  const mappings = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`TYPE${i}`, `material-${i}`]));
  for (const bad of [1, true, null, [], {}, '', 'a/b']) {
    await assertFails(writeNewTemplate({ ...fixture, materialMappings: { ...mappings, TYPE99: bad } }));
  }
  await assertFails(writeNewTemplate({ ...fixture, materialMappings: { ...mappings, TYPE100: 'material-100' } }));
});

test('templates and default references are private to verified unblocked owners', async () => {
  const fixture = templateFixture();
  const ref = doc(alice(), 'users/alice/templates/template');
  await setDoc(ref, fixture);
  await seedAuthorization();
  for (const db of [user('bob'), user('administrator'), user('alice', { email_verified: false }), environment.unauthenticatedContext().firestore()]) {
    await assertFails(getDoc(doc(db, 'users/alice/templates/template')));
    await assertFails(getDocs(query(collection(db, 'users/alice/templates'), limit(51))));
    await assertFails(updateDoc(doc(db, 'users/alice/templates/template'), { name: 'Forbidden', version: 2 }));
    await assertFails(deleteDoc(doc(db, 'users/alice/templates/template')));
  }
  const settingsRef = doc(alice(), 'users/alice/settings/pricing');
  await assertSucceeds(setDoc(settingsRef, { ...settings, defaultTemplateId: 'template' }));
  await assertSucceeds(updateDoc(settingsRef, { defaultTemplateId: null }));
  for (const bad of ['', '.', '..', 'a/b', 'x'.repeat(181), 1, false]) await assertFails(updateDoc(settingsRef, { defaultTemplateId: bad }));
  await seedDirectory('alice');
  await (await roleBatch(user('administrator'), 'administrator', 'alice', 'user', { action: 'block', blocked: true })).commit();
  await assertFails(getDoc(ref));
  await assertFails(updateDoc(ref, { name: 'Blocked edit', version: 2 }));
  await assertFails(deleteDoc(ref));
  await assertFails(updateDoc(settingsRef, { defaultTemplateId: 'template' }));
});

test('historical payloads stay immutable while legacy metadata edits preserve exact money strings', async () => {
  const legacy = { ...snapshot, id: 'legacy', input: { ...snapshot.input, operatorFeeUah: '50.00' }, result: { ...snapshot.result, sellingPriceUah: '150.00' } };
  Reflect.deleteProperty(legacy, 'algorithmVersion');
  await environment.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), 'users/alice/calculations/legacy'), legacy); });
  const ref = doc(alice(), 'users/alice/calculations/legacy');
  await assertSucceeds(updateDoc(ref, { title: 'Edited legacy quote', clientName: 'Customer', notes: 'x'.repeat(10000) }));
  const saved = (await getDoc(ref)).data()!;
  assert.deepEqual(saved.input, legacy.input);
  assert.deepEqual(saved.result, legacy.result);
  assert.equal(saved.algorithmVersion, undefined);
  for (const patch of [
    { input: { ...legacy.input, operatorFeeUah: '50' } }, { 'input.operatorFeeUah': '50' },
    { result: { ...legacy.result, sellingPriceUah: '150' } }, { 'result.profitUah': '999' },
    { status: legacy.status === 'complete' ? 'incomplete' : 'complete' }, { fileName: 'changed.3mf' },
    { createdAt: '2020-01-01T00:00:00.000Z' }, { algorithmVersion: CALCULATION_ALGORITHM_VERSION }, { sourceCalculationId: 'other' }, { id: 'other' }, { extra: true },
  ]) await assertFails(updateDoc(ref, patch));
  for (const patch of [{ title: '' }, { title: ' ' }, { title: 'x'.repeat(301) }, { clientName: 'x'.repeat(201) }, { notes: 'x'.repeat(10001) }, { notes: null }]) await assertFails(updateDoc(ref, patch));
  await assertSucceeds(updateDoc(ref, { clientName: deleteField(), notes: deleteField() }));
});

test('new snapshots record bounded algorithm/source identities and retain immutable payloads', async () => {
  const legacyNew = { ...snapshot };
  Reflect.deleteProperty(legacyNew, 'algorithmVersion');
  await assertFails(writeNewSnapshot(legacyNew));
  for (const patch of [
    { algorithmVersion: '' }, { algorithmVersion: 'x'.repeat(65) }, { algorithmVersion: null }, { algorithmVersion: 1 },
    { sourceCalculationId: '' }, { sourceCalculationId: '   ' }, { sourceCalculationId: '\t\n' }, { sourceCalculationId: '.' }, { sourceCalculationId: '..' }, { sourceCalculationId: 'a/b' }, { sourceCalculationId: 1 }, { sourceCalculationId: 'x'.repeat(181) },
  ]) await assertFails(writeNewSnapshot({ ...snapshot, ...patch }));
  for (const patch of [{ sourceCalculationId: null }, { sourceCalculationId: 'legacy', algorithmVersion: 'legacy' }, { algorithmVersion: 'kilog-2026-previous' }]) await assertSucceeds(writeNewSnapshot({ ...snapshot, ...patch }));
  const ref = doc(alice(), 'users/alice/calculations/calculation');
  await setDoc(ref, snapshot);
  await assertSucceeds(updateDoc(ref, { title: 'Updated title', notes: 'Kept payload' }));
  await assertFails(updateDoc(ref, { algorithmVersion: 'legacy' }));
  await assertFails(updateDoc(ref, { sourceCalculationId: 'legacy' }));
  await assertFails(updateDoc(ref, { input: { ...snapshot.input, otherFeeUah: '100' } }));
  await assertFails(updateDoc(ref, { result: { ...snapshot.result, profitUah: '999' } }));
});

test('private history pagination uses deterministic tie-breakers without exposing another account', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const batch = writeBatch(context.firestore());
    for (let i = 0; i < 54; i++) {
      const id = `history-${String(i).padStart(3, '0')}`;
      batch.set(doc(context.firestore(), `users/alice/calculations/${id}`), { ...snapshot, id });
    }
    await batch.commit();
  });
  const history = collection(alice(), 'users/alice/calculations');
  const first = await assertSucceeds(getDocs(query(history, orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'), limit(51))));
  const second = await assertSucceeds(getDocs(query(history, orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'), startAfter(first.docs.at(-1)!), limit(51))));
  const ids = [...first.docs, ...second.docs].map(item => item.id);
  assert.equal(ids.length, 54);
  assert.equal(new Set(ids).size, 54);
  assert.equal(ids[0], 'history-053');
  assert.equal(ids.at(-1), 'history-000');
  await seedAuthorization();
  for (const db of [user('bob'), user('administrator')]) await assertFails(getDocs(query(collection(db, 'users/alice/calculations'), orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'), limit(51))));
});

test('self deletion atomically records tombstones and permits only owner cleanup', async () => {
  await seedAuthorization();
  await seedDirectory('alice');
  await seedUnblockedAccess();
  const db = recentUser();
  const rows: [string, Record<string, unknown>][] = [
    ['materials/material', material], ['printers/printer', printer], ['calculations/calculation', snapshot],
    ['templates/template', templateFixture()], ['settings/pricing', settings], ['likes/like', { filamentId: 'like' }],
  ];
  await setDoc(doc(db, 'users/alice'), profile);
  for (const [path, value] of rows) await setDoc(doc(db, `users/alice/${path}`), value);
  await environment.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), 'users/alice/settings/legacy'), { oldPreference: 'raw' }); });
  const { batch, id } = await deletionBatch(db);
  await assertSucceeds(batch.commit());
  assert.equal((await getDoc(doc(db, 'accountDeletion/alice'))).data()?.changeId, id);
  assert.equal((await getDoc(doc(db, 'accountAccess/alice'))).data()?.blocked, true);
  assert.equal((await getDoc(doc(db, 'memberships/alice'))).data()?.active, false);
  assert.deepEqual((await getDoc(doc(db, 'system/authorization'))).data()?.adminUids, ['administrator']);
  assert.equal((await getDoc(doc(user('administrator'), `accessAudit/${id}`))).data()?.action, 'delete');
  for (const [path] of rows) {
    await assertSucceeds(getDoc(doc(db, `users/alice/${path}`)));
    await assertSucceeds(getDocs(query(collection(db, `users/alice/${path.split('/')[0]}`), orderBy(documentId()), limit(100))));
    await assertFails(updateDoc(doc(db, `users/alice/${path}`), { extra: true }));
    await assertSucceeds(deleteDoc(doc(db, `users/alice/${path}`)));
  }
  await assertSucceeds(getDoc(doc(db, 'users/alice/settings/legacy')));
  await assertSucceeds(deleteDoc(doc(db, 'users/alice/settings/legacy')));
  await assertSucceeds(deleteDoc(doc(db, 'users/alice')));
  await assertSucceeds(deleteDoc(doc(db, 'userDirectory/alice')));
  await assertFails(setDoc(doc(db, 'users/alice'), profile));
  await assertFails(setDoc(doc(db, 'users/alice/materials/material'), material));
  await assertFails(setDoc(doc(db, 'users/alice/settings/pricing'), settings));
  await assertFails(setDoc(doc(db, 'userDirectory/alice'), { uid: 'alice', email: 'alice@example.com', displayName: 'Alice', verified: true, updatedAt: serverTimestamp() }));
  for (const path of ['accountDeletion/alice', 'accountAccess/alice', 'memberships/alice', `accessAudit/${id}`, 'system/authorization']) await assertFails(deleteDoc(doc(db, path)));
  await assertFails(updateDoc(doc(db, 'accountDeletion/alice'), { startedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db, 'accountDeletion/alice'), { uid: 'alice', startedAt: serverTimestamp(), changeId: crypto.randomUUID() }));
});

test('blocked and unverified self deletion works without creating a registry or restoring bootstrap', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'accountAccess/alice'), { blocked: true, updatedAt: historicalTime, updatedBy: 'administrator', changeId: 'seed' });
    await setDoc(doc(context.firestore(), 'users/alice/calculations/legacy'), { title: 'Legacy raw record' });
  });
  const db = recentUser('alice', 0, { email_verified: false });
  await assertFails(getDoc(doc(db, 'users/alice/calculations/legacy')));
  const { batch, id } = await deletionBatch(db);
  await assertSucceeds(batch.commit());
  assert.equal((await getDoc(doc(db, 'system/authorization'))).exists(), false);
  await assertSucceeds(getDoc(doc(db, 'users/alice/calculations/legacy')));
  await assertSucceeds(deleteDoc(doc(db, 'users/alice/calculations/legacy')));
  await assertFails(setDoc(doc(db, 'users/alice/calculations/new'), { ...snapshot, id: 'new' }));
  await environment.withSecurityRulesDisabled(async context => { assert.equal((await getDoc(doc(context.firestore(), `accessAudit/${id}`))).data()?.registryVersion, 0); });
  const bootstrap = user('alice', { email: 'web.developer.den@gmail.com' });
  await assertFails(bootstrapBatch(bootstrap, 'alice').commit());
});

test('deletion requires a recent trusted auth time, immutable timestamp and exact marker schema', async () => {
  await seedAuthorization();
  for (const claims of [{}, { auth_time: null }, { auth_time: true }, { auth_time: '123' }, { auth_time: 0 }, { auth_time: -1 }, { auth_time: Math.floor(Date.now() / 1000) - 301 }, { auth_time: Math.floor(Date.now() / 1000) + 30 }, { auth_time: Math.floor(Date.now() / 1000) + 0.5 }]) {
    const { batch } = await deletionBatch(user('alice', claims));
    await assertFails(batch.commit());
  }
  for (const marker of [{ uid: 'bob' }, { startedAt: historicalTime }, { startedAt: 'now' }, { changeId: 'not-a-uuid' }, { changeId: 1 }, { changeId: 'x'.repeat(129) }, { email: 'alice@example.com' }, { admin: true }]) {
    const { batch } = await deletionBatch(recentUser(), 'alice', { marker });
    await assertFails(batch.commit());
  }
  await assertFails(setDoc(doc(recentUser(), 'accountDeletion/bob'), { uid: 'bob', startedAt: serverTimestamp(), changeId: crypto.randomUUID() }));
  await assertFails(setDoc(doc(environment.unauthenticatedContext().firestore(), 'accountDeletion/alice'), { uid: 'alice', startedAt: serverTimestamp(), changeId: crypto.randomUUID() }));
  const { batch } = await deletionBatch(recentUser('alice', 299));
  await assertSucceeds(batch.commit());
});

test('deletion rejects omitted atomic components, spoofed audit and authority transitions', async () => {
  await seedAuthorization();
  await seedUnblockedAccess();
  for (const omit of ['marker', 'registry', 'access', 'membership', 'audit'] as const) await assertFails((await deletionBatch(recentUser(), 'alice', { omit })).batch.commit());
  const invalid: DeletionOptions[] = [
    { access: { blocked: false } }, { access: { updatedBy: 'administrator' } }, { access: { changeId: 'different' } },
    { membership: { active: true, companyId: 'company-a' } }, { membership: { version: 2 } }, { membership: { updatedBy: 'bob' } },
    { audit: { actorUid: 'administrator' } }, { audit: { targetUid: 'bob' } }, { audit: { role: 'admin' } }, { audit: { action: 'role' } },
    { audit: { blocked: false } }, { audit: { companyId: 'company-a' } }, { audit: { registryVersion: 0 } }, { audit: { email: 'alice@example.com' } },
    { registry: { adminUids: ['alice', 'administrator'] } }, { registry: { adminUids: ['bob'] } }, { registry: { bootstrapUid: 'alice' } },
    { registry: { initializedAt: serverTimestamp() } }, { registry: { version: 3 } }, { registry: { lastChangeId: 'different' } },
  ];
  for (const options of invalid) await assertFails((await deletionBatch(recentUser(), 'alice', options)).batch.commit());
  const schemas = (id: string): Record<string, Record<string, unknown>> => ({
    'accountDeletion/alice': { uid: 'alice', startedAt: serverTimestamp(), changeId: id },
    'system/authorization': { adminUids: ['administrator'], bootstrapUid: 'administrator', initializedAt: historicalTime, version: 2, lastChangeId: id },
    'accountAccess/alice': { blocked: true, updatedAt: serverTimestamp(), updatedBy: 'alice', changeId: id },
    'memberships/alice': { companyId: null, active: false, version: 1, updatedAt: serverTimestamp(), updatedBy: 'alice', changeId: id },
    [`accessAudit/${id}`]: { actorUid: 'alice', targetUid: 'alice', action: 'delete', role: 'user', companyId: null, blocked: true, createdAt: serverTimestamp(), registryVersion: 2 },
  });
  for (const [templatePath, data] of Object.entries(schemas('placeholder'))) {
    for (const field of Object.keys(data)) {
      const db = recentUser();
      const attempt = await deletionBatch(db);
      const path = templatePath.replace('placeholder', attempt.id);
      const replacement = { ...schemas(attempt.id)[path], unknownReplacement: true };
      Reflect.deleteProperty(replacement, field);
      attempt.batch.set(doc(db, path), replacement);
      await assertFails(attempt.batch.commit());
    }
  }
  const reused = crypto.randomUUID();
  await environment.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), `accessAudit/${reused}`), { old: true }); });
  await assertFails((await deletionBatch(recentUser(), 'alice', { changeId: reused })).batch.commit());
  assert.equal((await getDoc(doc(recentUser(), 'accountDeletion/alice'))).exists(), false);
});

test('a registry-free deletion cannot initialize authorization or invent nonzero audit versions', async () => {
  await assertFails((await deletionBatch(recentUser(), 'alice', { registry: {} })).batch.commit());
  await assertFails((await deletionBatch(recentUser(), 'alice', { audit: { registryVersion: 1 } })).batch.commit());
  await assertFails(setDoc(doc(recentUser(), 'accountAccess/alice'), { blocked: true, updatedAt: serverTimestamp(), updatedBy: 'alice', changeId: crypto.randomUUID() }));
  await assertSucceeds((await deletionBatch(recentUser())).batch.commit());
  assert.equal((await getDoc(doc(recentUser(), 'system/authorization'))).exists(), false);
});

test('last administrator deletion and concurrent departures preserve one administrator', async () => {
  await seedAuthorization(['alice']);
  await assertFails((await deletionBatch(recentUser())).batch.commit());
  assert.equal((await getDoc(doc(recentUser(), 'accountDeletion/alice'))).exists(), false);
  await seedAuthorization(['alice', 'bob']);
  const aliceDeparture = await deletionBatch(recentUser());
  const bobDeparture = await deletionBatch(recentUser('bob'), 'bob');
  const results = await Promise.allSettled([aliceDeparture.batch.commit(), bobDeparture.batch.commit()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const registry = (await getDoc(doc(recentUser(), 'system/authorization'))).data()!;
  assert.equal(registry.adminUids.length, 1);
  const remaining = registry.adminUids[0];
  await assertFails((await deletionBatch(recentUser(remaining), remaining)).batch.commit());
  const removed = remaining === 'alice' ? 'bob' : 'alice';
  await assertFails(setDoc(doc(recentUser(removed), 'filaments/new'), { ...PUBLIC_FILAMENTS_CATALOG[0], id: 'new' }));
});

test('deletion markers permanently reject role restoration and preserve company offers and audits', async () => {
  const { administrator } = await setupOffers();
  await setDoc(doc(recentUser(), 'companyOffers/offer-a'), offerData());
  const { batch, id } = await deletionBatch(recentUser());
  await assertSucceeds(batch.commit());
  for (const [role, options] of [['user', { action: 'block', blocked: false }], ['admin', {}], ['manager', { companyId: 'company-a' }], ['user', { action: 'block', blocked: true }]] as [Role, RoleOptions][]) {
    await assertFails((await roleBatch(administrator, 'administrator', 'alice', role, options)).commit());
  }
  await assertFails(updateDoc(doc(recentUser(), 'companyOffers/offer-a'), { status: 'hidden', version: 2, updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(recentUser(), 'companyOffers/offer-a')));
  await assertSucceeds(getDoc(doc(administrator, 'companyOffers/offer-a')));
  await assertSucceeds(getDoc(doc(administrator, `accessAudit/${id}`)));
  await assertFails(deleteDoc(doc(administrator, 'accountDeletion/alice')));
  await assertFails(deleteDoc(doc(administrator, 'accountAccess/alice')));
});

test('a deletion transaction cannot smuggle private or privileged mutations before revocation', async () => {
  await seedAuthorization(['alice', 'administrator']);
  await seedUnblockedAccess();
  const db = recentUser();
  await setDoc(doc(db, 'users/alice/materials/material'), material);
  const privateWrite = await deletionBatch(db);
  privateWrite.batch.update(doc(db, 'users/alice/materials/material'), { name: 'Changed during departure' });
  await assertFails(privateWrite.batch.commit());
  const privilegedWrite = await deletionBatch(db);
  privilegedWrite.batch.set(doc(db, 'filaments/new'), { ...PUBLIC_FILAMENTS_CATALOG[0], id: 'new' });
  await assertFails(privilegedWrite.batch.commit());
  assert.equal((await getDoc(doc(db, 'accountDeletion/alice'))).exists(), false);
  assert.equal((await getDoc(doc(db, 'users/alice/materials/material'))).data()?.name, material.name);
});

test('pending cleanup is owner-scoped, paged, fresh-authenticated and can resume in batches', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const batch = writeBatch(context.firestore());
    for (let i = 0; i < 101; i++) batch.set(doc(context.firestore(), `users/alice/materials/legacy-${i}`), { legacy: i });
    batch.set(doc(context.firestore(), 'users/alice/settings/old'), { preference: 'raw' });
    batch.set(doc(context.firestore(), 'users/alice'), profile);
    await batch.commit();
  });
  await assertSucceeds((await deletionBatch(recentUser())).batch.commit());
  const expired = recentUser('alice', 301);
  await assertSucceeds(getDocs(query(collection(expired, 'users/alice/materials'), orderBy(documentId()), limit(100))));
  await assertFails(deleteDoc(doc(expired, 'users/alice/materials/legacy-0')));
  await assertFails(deleteDoc(doc(expired, 'users/alice')));
  for (const context of [user('bob'), user('administrator', { admin: true }), environment.unauthenticatedContext().firestore()]) {
    await assertFails(getDoc(doc(context, 'accountDeletion/alice')));
    await assertFails(getDoc(doc(context, 'users/alice/materials/legacy-0')));
    await assertFails(getDocs(query(collection(context, 'users/alice/materials'), limit(100))));
    await assertFails(deleteDoc(doc(context, 'users/alice/materials/legacy-0')));
  }
  const db = recentUser();
  await assertFails(getDocs(query(collection(db, 'accountDeletion'), limit(100))));
  await assertFails(getDocs(query(collection(db, 'users/alice/settings'), limit(101))));
  await assertFails(getDocs(query(collection(db, 'users/alice/templates'), limit(101))));
  await assertFails(getDocs(query(collection(db, 'users/alice/materials'), limit(201))));
  await assertFails(getDocs(collection(db, 'users/alice/materials')));
  await assertFails(getDoc(doc(db, 'users/alice/unknown/secret')));
  const page = await getDocs(query(collection(db, 'users/alice/materials'), orderBy(documentId()), limit(100)));
  const cleanup = writeBatch(db);
  page.docs.forEach(item => cleanup.delete(item.ref));
  await assertSucceeds(cleanup.commit());
  const remaining = await getDocs(query(collection(db, 'users/alice/materials'), orderBy(documentId()), limit(100)));
  assert.equal(remaining.size, 1);
  await assertSucceeds(deleteDoc(remaining.docs[0].ref));
  await assertSucceeds(deleteDoc(doc(db, 'users/alice/settings/old')));
  await assertSucceeds(deleteDoc(doc(db, 'users/alice')));
  await assertFails(setDoc(doc(db, 'users/alice/materials/new'), { ...material, id: 'new' }));
});

test('unblocked tax snapshots with 500 rows and full metadata retain expression-budget headroom', async () => {
  await seedUnblockedAccess();
  const tax = { ...createTaxPreset('general', true), scenario: 'estimate' as const, customerPriceUah: '1500', netTaxableIncomeUah: '500' };
  const original = { ...snapshot.input, tax };
  const result = calculatePrintCost(original);
  assert.ok(result.tax);
  const input = { ...original, filaments: Array.from({ length: 500 }, () => snapshot.input.filaments[0]) };
  const value = { ...snapshot, input, result, status: result.status, clientName: 'C'.repeat(200), notes: 'N'.repeat(10000), sourceCalculationId: 'original', algorithmVersion: CALCULATION_ALGORITHM_VERSION };
  await assertSucceeds(writeNewSnapshot(value));
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
