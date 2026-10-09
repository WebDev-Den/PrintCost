import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDocFromServer, Timestamp, writeBatch } from 'firebase/firestore';
import { MAX_COMPANY_OFFER_BULK_ITEMS, type CompanyOfferInput } from '../src/domain/companyOffers.ts';
import type { companyOfferRepository as Repository } from '../src/services/companyOfferRepository.ts';

test('company catalog CRUD and 100-item bulk actions enforce live company rights, moderation and versions', { timeout: 120_000 }, async t => {
  const projectId = `demo-kilog-offers-${crypto.randomUUID().slice(0, 8)}`;
  const environment = await initializeTestEnvironment({ projectId,
    firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } });
  await mkdir(join(process.cwd(), 'output'), { recursive: true });
  const directory = await mkdtemp(join(process.cwd(), 'output/company-offer-test-'));
  const bundlePath = join(directory, 'repository.mjs');
  const timestamp = new Timestamp(123456, 0);
  const input: CompanyOfferInput = { name: 'Draft PLA', brand: 'Own Brand', type: 'PLA', family: 'Стандартні', colorName: 'White', colorHex: '#ffffff',
    colorTone: 'white', packagingType: 'spool', spoolWeightGrams: 1000, priceUah: 600, diameterMm: 1.75, description: '',
    productUrl: 'https://shop.example.com/pla', inStock: true, status: 'hidden' };
  const company = (id: string, status = 'active') => ({ id, name: id, website: 'https://shop.example.com/', allowedDomains: ['shop.example.com'], status,
    version: 1, createdBy: 'administrator', createdAt: timestamp, updatedBy: 'administrator', updatedAt: timestamp, changeId: 'seed-company' });
  const offer = (id: string, overrides: Record<string, unknown> = {}) => ({ ...input, id, companyId: 'company-a', version: 1,
    createdBy: 'manager', updatedBy: 'manager', createdAt: timestamp, updatedAt: timestamp, ...overrides });
  type Fixture = { db: ReturnType<ReturnType<typeof environment.authenticatedContext>['firestore']>;
    auth: { currentUser: { uid: string; emailVerified: boolean } | null }; demo: boolean; sessionAssertionsBeforeFailure?: number };
  const globals = globalThis as typeof globalThis & { companyOfferFixture?: Fixture };
  async function seed(records: Record<string, Record<string, unknown>>) {
    await environment.withSecurityRulesDisabled(async context => {
      const batch = writeBatch(context.firestore());
      Object.entries(records).forEach(([path, data]) => batch.set(doc(context.firestore(), path), data));
      await batch.commit();
    });
  }
  async function inspect(path: string) {
    let data: Record<string, unknown> | undefined;
    await environment.withSecurityRulesDisabled(async context => { data = (await getDocFromServer(doc(context.firestore(), path))).data(); });
    return data;
  }
  async function client(uid: string | null, verified = true) {
    const fixture: Fixture = { db: (uid ? environment.authenticatedContext(uid, { email_verified: verified }) : environment.unauthenticatedContext()).firestore(),
      auth: { currentUser: uid ? { uid, emailVerified: verified } : null }, demo: false };
    globals.companyOfferFixture = fixture;
    const module = await import(`${pathToFileURL(bundlePath).href}?client=${crypto.randomUUID()}`);
    return { repository: module.companyOfferRepository as typeof Repository, fixture };
  }
  const registry = { adminUids: ['administrator'], bootstrapUid: 'administrator', initializedAt: timestamp, version: 1, lastChangeId: 'seed-registry' };
  const membership = (companyId: string | null, active = !!companyId) => ({ companyId, active, version: 1, updatedAt: timestamp, updatedBy: 'administrator', changeId: 'seed-member' });
  try {
    const bundle = await build({ entryPoints: ['src/services/companyOfferRepository.ts'], bundle: true, write: false, format: 'esm', platform: 'node', external: ['firebase/*'],
      plugins: [{ name: 'company-offer-client', setup(builder) {
        builder.onResolve({ filter: /^\.\/(firebaseClient|authService)\.ts$/ }, args => args.importer.endsWith('companyOfferRepository.ts') ? { path: args.path, namespace: 'fixture' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.includes('firebaseClient')
          ? 'const fixture=globalThis.companyOfferFixture; export const firestoreDb=fixture.db; export const firebaseAuth=fixture.auth;'
          : 'const fixture=globalThis.companyOfferFixture; export const authService={isDemoSession:()=>fixture.demo,assertSession:(identity)=>{if(fixture.sessionAssertionsBeforeFailure!==undefined&&--fixture.sessionAssertionsBeforeFailure===0)throw new Error("Акаунт змінився після збереження.");if(fixture.demo||fixture.auth.currentUser?.uid!==identity)throw new Error("Акаунт змінився під час операції.")}};' }));
      } }] });
    await writeFile(bundlePath, bundle.outputFiles[0].text);
    await seed({ 'system/authorization': registry, 'companies/company-a': company('company-a'), 'companies/company-b': company('company-b'),
      'memberships/manager': membership('company-a'), 'memberships/foreign': membership('company-b'), 'memberships/customer': membership(null),
      ...Object.fromEntries(['administrator', 'manager', 'foreign', 'customer'].map(uid => [`accountAccess/${uid}`,
        { blocked: false, updatedAt: timestamp, updatedBy: 'administrator', changeId: 'seed-access' }])) });
    const manager = await client('manager'), admin = await client('administrator'), foreign = await client('foreign'),
      ordinary = await client('customer'), anonymous = await client(null), unverified = await client('manager', false);

    await t.test('manager creates, reads, edits and deletes only own offers, retaining creation identity and stale-write protection', async () => {
      const created = await manager.repository.save({ ...input, companyId: 'company-a', id: undefined });
      assert.equal(created.status, 'hidden'); assert.equal(created.version, 1); assert.equal(created.createdBy, 'manager');
      assert.equal((await manager.repository.getForCompany('company-a')).items[0].id, created.id);
      assert.equal((await anonymous.repository.getPublishedForCompany('company-a')).items.length, 0);
      const edited = await manager.repository.save({ ...input, companyId: 'company-a', id: created.id, version: 1, priceUah: 610 });
      assert.equal(edited.version, 2); assert.equal(edited.priceUah, 610); assert.equal(edited.createdAt, created.createdAt);
      await assert.rejects(manager.repository.save({ ...input, companyId: 'company-a', id: created.id, version: 1 }), /вже змінили/);
      await assert.rejects(manager.repository.save({ ...input, companyId: 'company-b' }), /своєю активною/);
      await assert.rejects(foreign.repository.getForCompany('company-a'), { code: 'permission-denied' });
      const published = await manager.repository.setStatus(created.id, 'published', 2);
      assert.equal(published.version, 3);
      assert.equal((await anonymous.repository.getPublishedForCompany('company-a')).items[0].id, created.id);
      const deleted = await manager.repository.bulkAction('company-a', [published], 'delete');
      assert.deepEqual(deleted.deletedIds, [created.id]); assert.deepEqual(deleted.failures, []);
      assert.equal(await inspect(`companyOffers/${created.id}`), undefined);
    });

    await t.test('100 drafts publish, hide and delete atomically without changing unselected offers or private data', async () => {
      const selected = Array.from({ length: MAX_COMPANY_OFFER_BULK_ITEMS }, (_, index) => ({ id: `bulk-${index}`, version: 1 }));
      await seed({ ...Object.fromEntries(selected.map(item => [`companyOffers/${item.id}`, offer(item.id)])),
        'companyOffers/retained': offer('retained'), 'users/manager/calculations/retained': { title: 'Saved quote' } });
      const published = await manager.repository.bulkAction('company-a', selected, 'publish');
      assert.equal(published.offers.length, 100); assert.deepEqual(published.failures, []);
      assert.ok(published.offers.every(item => item.status === 'published' && item.version === 2 && item.updatedBy === 'manager' && item.createdAt === timestamp.toDate().toISOString()));
      const hidden = await manager.repository.bulkAction('company-a', published.offers, 'hide');
      assert.equal(hidden.offers.length, 100); assert.ok(hidden.offers.every(item => item.status === 'hidden' && item.version === 3));
      const deleted = await manager.repository.bulkAction('company-a', hidden.offers, 'delete');
      assert.equal(deleted.deletedIds.length, 100); assert.deepEqual(deleted.failures, []);
      assert.equal(await inspect('companyOffers/bulk-99'), undefined);
      assert.deepEqual(await inspect('companyOffers/retained'), offer('retained'));
      assert.equal((await inspect('users/manager/calculations/retained'))?.title, 'Saved quote');
    });

    await t.test('stale versions, blocked offers and invalid domains report row failures while valid rows commit', async () => {
      await seed({ 'companyOffers/valid': offer('valid'), 'companyOffers/stale': offer('stale', { version: 2 }),
        'companyOffers/blocked': offer('blocked', { status: 'blocked' }), 'companyOffers/removed-host': offer('removed-host', { productUrl: 'https://old-shop.example.com/pla' }) });
      const result = await manager.repository.bulkAction('company-a', ['valid', 'stale', 'blocked', 'removed-host'].map(id => ({ id, version: 1 })), 'publish');
      assert.deepEqual(result.offers.map(item => item.id), ['valid']);
      assert.deepEqual(result.failures.map(item => item.id), ['stale', 'blocked', 'removed-host']);
      assert.equal((await inspect('companyOffers/stale'))?.version, 2); assert.equal((await inspect('companyOffers/blocked'))?.status, 'blocked');
      const managerDelete = await manager.repository.bulkAction('company-a', [{ id: 'blocked', version: 1 }], 'delete');
      assert.equal(managerDelete.deletedIds.length, 0); assert.equal(managerDelete.failures.length, 1);
      const adminPublish = await admin.repository.bulkAction('company-a', [{ id: 'blocked', version: 1 }], 'publish');
      assert.equal(adminPublish.offers.length, 0); assert.match(adminPublish.failures[0].message, /розблокуйте/);
      const adminDelete = await admin.repository.bulkAction('company-a', [{ id: 'blocked', version: 1 }], 'delete');
      assert.deepEqual(adminDelete.deletedIds, ['blocked']);
      const staleDelete = await manager.repository.bulkAction('company-a', [{ id: 'valid', version: 1 }], 'delete');
      assert.equal(staleDelete.deletedIds.length, 0); assert.equal((await inspect('companyOffers/valid'))?.version, 2);
    });

    await t.test('foreign company selections, customers, unverified/demo sessions and changed sessions never mutate', async () => {
      await seed({ 'companyOffers/foreign-offer': offer('foreign-offer', { companyId: 'company-b', status: 'published' }) });
      const target = [{ id: 'retained', version: 1 }];
      await assert.rejects(manager.repository.bulkAction('company-b', [{ id: 'foreign-offer', version: 1 }], 'delete'), /своєю активною/);
      const mixed = await manager.repository.bulkAction('company-a', [{ id: 'foreign-offer', version: 1 }], 'delete');
      assert.equal(mixed.failures.length, 1); assert.equal((await inspect('companyOffers/foreign-offer'))?.version, 1);
      // Unreadable/missing selections deny the entire transaction without widening private reads.
      await assert.rejects(manager.repository.bulkAction('company-a', [...target, { id: 'missing', version: 1 }], 'delete'), { code: 'permission-denied' });
      assert.equal((await inspect('companyOffers/retained'))?.version, 1);
      await assert.rejects(ordinary.repository.bulkAction('company-a', target, 'delete'), /Потрібні права/);
      await assert.rejects(unverified.repository.bulkAction('company-a', target, 'delete'), /підтвердженою/);
      manager.fixture.demo = true;
      await assert.rejects(manager.repository.bulkAction('company-a', target, 'delete'), /справжній акаунт/);
      manager.fixture.demo = false;
      const pending = manager.repository.bulkAction('company-a', target, 'delete');
      manager.fixture.auth.currentUser = { uid: 'changed-session', emailVerified: true };
      await assert.rejects(pending, /Акаунт змінився/);
      manager.fixture.auth.currentUser = { uid: 'manager', emailVerified: true };
      assert.equal((await inspect('companyOffers/retained'))?.version, 1);
    });

    await t.test('postcommit refresh failure reports saved IDs instead of suggesting the operation failed', async () => {
      await seed({ 'companyOffers/postcommit': offer('postcommit') });
      manager.fixture.sessionAssertionsBeforeFailure = 3;
      const result = await manager.repository.bulkAction('company-a', [{ id: 'postcommit', version: 1 }], 'publish');
      delete manager.fixture.sessionAssertionsBeforeFailure;
      assert.deepEqual(result.updatedIds, ['postcommit']); assert.equal(result.offers.length, 0);
      assert.match(result.reloadError!, /Зміни збережено/); assert.equal(result.failures.length, 0);
      assert.equal((await inspect('companyOffers/postcommit'))?.version, 2);
    });

    await t.test('concurrent bulk edits sharing one expected version accept only one transition', async () => {
      await seed({ 'companyOffers/concurrent': offer('concurrent') });
      const selection = [{ id: 'concurrent', version: 1 }];
      const results = await Promise.allSettled([
        manager.repository.bulkAction('company-a', selection, 'publish'), admin.repository.bulkAction('company-a', selection, 'hide'),
      ]);
      assert.equal(results.reduce((total, result) => total + (result.status === 'fulfilled' ? result.value.updatedIds.length : 0), 0), 1);
      for (const result of results) {
        if (result.status === 'rejected') assert.equal(result.reason.code, 'permission-denied');
        else if (!result.value.updatedIds.length) assert.match(result.value.failures[0].message, /вже змінили/);
      }
      assert.equal((await inspect('companyOffers/concurrent'))?.version, 2);
    });

    await t.test('live role revocation, blocking, deletion and disabled companies deny bulk mutations', async () => {
      const target = [{ id: 'retained', version: 1 }];
      await seed({ 'memberships/manager': membership(null) });
      await assert.rejects(manager.repository.bulkAction('company-a', target, 'delete'), /Потрібні права/);
      await seed({ 'memberships/manager': membership('company-a'), 'accountAccess/manager': { blocked: true, updatedAt: timestamp, updatedBy: 'administrator', changeId: 'seed' } });
      await assert.rejects(manager.repository.bulkAction('company-a', target, 'publish'), /Потрібні права/);
      await seed({ 'accountAccess/manager': { blocked: false, updatedAt: timestamp, updatedBy: 'administrator', changeId: 'seed' }, 'companies/company-a': company('company-a', 'disabled') });
      await assert.rejects(manager.repository.bulkAction('company-a', target, 'delete'), /Потрібні права/);
      const adminPublish = await admin.repository.bulkAction('company-a', target, 'publish');
      assert.equal(adminPublish.offers.length, 0); assert.match(adminPublish.failures[0].message, /активної компанії/);
      await seed({ 'companies/company-a': company('company-a'), 'accountDeletion/manager': { uid: 'manager', startedAt: timestamp, changeId: 'deleted' } });
      await assert.rejects(manager.repository.bulkAction('company-a', target, 'delete'), { code: 'permission-denied' });
      assert.equal((await inspect('companyOffers/retained'))?.version, 1);
    });

    await t.test('oversized, duplicate, malformed and unknown requests are rejected before writes', async () => {
      for (const selection of [[], Array.from({ length: 101 }, (_, index) => ({ id: `oversized-${index}`, version: 1 }))]) {
        await assert.rejects(admin.repository.bulkAction('company-a', selection, 'delete'), /від 1 до 100/);
      }
      await assert.rejects(admin.repository.bulkAction('company-a', [{ id: '../invalid', version: 1 }], 'delete'), /ідентифікатор/);
      for (const selection of [[{ id: 'retained', version: 0 }], [{ id: 'retained', version: 1 }, { id: 'retained', version: 2 }]]) {
        await assert.rejects(admin.repository.bulkAction('company-a', selection, 'delete'), /версії/);
      }
      await assert.rejects(admin.repository.bulkAction('company-a', [{ id: 'retained', version: 1 }], 'unknown' as never), /Невідома/);
    });
  } finally {
    delete globals.companyOfferFixture;
    await environment.cleanup();
    await rm(bundlePath, { force: true });
    await rmdir(directory);
  }
});
