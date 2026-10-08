import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestContext, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { INITIAL_MATERIALS, INITIAL_PRINTERS, INITIAL_PRICING_SETTINGS, getInitialCalculationSnapshots } from '../src/domain/defaultData.ts';
import { MANUFACTURERS_LIST, PUBLIC_FILAMENTS_CATALOG, STANDARD_TEMPERATURE_PROFILES } from '../src/domain/filamentsDirectory.ts';
import { api } from '../src/services/api.ts';

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
