import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp, writeBatch } from 'firebase/firestore';
import { MAX_CATALOG_BULK_ITEMS, PUBLIC_FILAMENTS_CATALOG, type PublicFilamentItem } from '../src/domain/filamentsDirectory.ts';

test('bulk catalog actions update/delete 100 atomically, preserve other records and enforce current admin rights', async () => {
  const projectId = `demo-kilog-bulk-${crypto.randomUUID().slice(0, 8)}`;
  assert.ok(projectId.startsWith('demo-'));
  const environment = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } });
  const adminDb = environment.authenticatedContext('administrator', { email_verified: true }).firestore();
  const fixture = { db: adminDb, auth: { currentUser: { uid: 'administrator' } } };
  const globals = globalThis as typeof globalThis & { catalogBulkFixture?: typeof fixture };
  globals.catalogBulkFixture = fixture;
  const directory = await mkdtemp(join(process.cwd(), 'output/catalog-bulk-test-'));
  const bundlePath = join(directory, 'api.mjs');
  const base = PUBLIC_FILAMENTS_CATALOG[0];
  const items: PublicFilamentItem[] = Array.from({ length: MAX_CATALOG_BULK_ITEMS + 1 }, (_, index) => JSON.parse(JSON.stringify({
    ...base, id: `bulk-${index.toString().padStart(3, '0')}`, name: `Bulk fixture ${index}`, inStock: true, stockStatusLabel: 'В наявності',
    approxPricePerKgUah: 500 + index,
    stores: base.stores.map(store => ({ ...store, inStock: true })),
    popularColors: [{ ...base.popularColors[0], stores: base.stores.map(store => ({ ...store, inStock: true })) }, ...base.popularColors.slice(1)],
  })));
  const ids = items.slice(0, 100).map(item => item.id);
  const readSelected = () => Promise.all(ids.map(async id => (await getDoc(doc(adminDb, 'filaments', id))).data()));
  const registry = (adminUids: string[], version: number) => ({ adminUids, bootstrapUid: 'administrator', initializedAt: Timestamp.now(), version, lastChangeId: `fixture-${version}` });
  try {
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const batch = writeBatch(db);
      batch.set(doc(db, 'system/authorization'), registry(['administrator'], 1));
      items.forEach(item => batch.set(doc(db, 'filaments', item.id), item));
      batch.set(doc(db, 'users/administrator/materials/retained'), { name: 'Private fixture' });
      batch.set(doc(db, 'users/administrator/calculations/retained'), { title: 'Saved quote fixture' });
      await batch.commit();
    });
    const bundle = await build({ entryPoints: ['src/services/api.ts'], bundle: true, write: false, format: 'esm', platform: 'node', external: ['firebase/*'],
      plugins: [{ name: 'local-catalog-client', setup(builder) {
        builder.onResolve({ filter: /^\.\/(firebaseClient|authService)\.ts$/ }, args => args.importer.endsWith('api.ts') ? { path: args.path, namespace: 'fixture' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.includes('firebaseClient')
          ? 'export const firestoreDb = globalThis.catalogBulkFixture.db; export const firebaseAuth = globalThis.catalogBulkFixture.auth;'
          : 'export const authService = { isDemoSession: () => false };' }));
      } }] });
    await writeFile(bundlePath, bundle.outputFiles[0].text);
    const { api } = await import(pathToFileURL(bundlePath).href);
    await assert.rejects(api.filaments.applyBulkAction([], 'delete'), /від 1 до 450/);
    await assert.rejects(api.filaments.applyBulkAction(items.map(item => item.id), 'delete'), /від 1 до 450/);
    await assert.rejects(api.filaments.applyBulkAction(['../invalid'], 'delete'), /ідентифікатор/);
    await assert.rejects(api.filaments.applyBulkAction(ids, 'unknown'), /Невідома/);
    for (const action of ['delete', 'out_of_stock']) {
      await assert.rejects(api.filaments.applyBulkAction([...ids, 'missing'], action), /змінено або видалено/);
    }
    assert.deepEqual(await readSelected(), items.slice(0, 100));
    const pending = api.filaments.applyBulkAction(ids, 'delete');
    fixture.auth.currentUser.uid = 'another-session';
    await assert.rejects(pending, /Акаунт змінився/);
    fixture.auth.currentUser.uid = 'administrator';

    await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'system/authorization'), registry(['another-admin'], 2)));
    for (const action of ['delete', 'out_of_stock']) await assert.rejects(api.filaments.applyBulkAction(ids, action), { code: 'permission-denied' });
    assert.deepEqual(await readSelected(), items.slice(0, 100), 'Revoked rights reject every write.');
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'system/authorization'), registry(['administrator'], 3));
      await setDoc(doc(context.firestore(), 'filaments', ids[99]), { ...items[99], approxPricePerKgUah: -1 });
    });
    await assert.rejects(api.filaments.applyBulkAction(ids, 'out_of_stock'), { code: 'permission-denied' });
    assert.deepEqual((await readSelected()).slice(0, 99), items.slice(0, 99), 'A rejected row leaves every other row unchanged.');
    await setDoc(doc(adminDb, 'filaments', ids[99]), items[99]);

    await api.filaments.applyBulkAction([...ids, ids[0]], 'out_of_stock');
    const unavailable = await readSelected();
    for (const [index, item] of unavailable.entries()) {
      assert.deepEqual(item, { ...items[index], inStock: false, stockStatusLabel: 'Немає в наявності',
        stores: items[index].stores.map(store => ({ ...store, inStock: false })),
        popularColors: items[index].popularColors.map(color => ({ ...color, ...(color.stores ? { stores: color.stores.map(store => ({ ...store, inStock: false })) } : {}) })),
      });
    }
    await api.filaments.applyBulkAction(ids, 'in_stock');
    assert.deepEqual(await readSelected(), items.slice(0, 100));
    await api.filaments.update(ids[0], { inStock: false, stockStatusLabel: 'Очікується поставка' });
    assert.deepEqual((await getDoc(doc(adminDb, 'filaments', ids[0]))).data(), { ...unavailable[0], stockStatusLabel: 'Очікується поставка' }, 'Single-row updates retain the same nested stock handling and every unrelated field.');
    await api.filaments.applyBulkAction(ids, 'delete');
    assert.deepEqual(await readSelected(), ids.map(id => ({ id, deleted: true })));
    assert.deepEqual((await getDoc(doc(adminDb, 'filaments', items[100].id))).data(), items[100], 'Unselected records retain every field.');
    assert.equal((await getDoc(doc(adminDb, 'users/administrator/materials/retained'))).data()?.name, 'Private fixture');
    assert.equal((await getDoc(doc(adminDb, 'users/administrator/calculations/retained'))).data()?.title, 'Saved quote fixture');
    assert.equal((await api.filaments.getAll()).some((item: PublicFilamentItem) => ids.includes(item.id)), false);
    await assert.rejects(api.filaments.applyBulkAction([ids[0], items[100].id], 'delete'), /змінено або видалено/);
    assert.deepEqual((await getDoc(doc(adminDb, 'filaments', items[100].id))).data(), items[100]);
    await api.filaments.applyBulkAction([base.id], 'out_of_stock');
    assert.equal((await getDoc(doc(adminDb, 'filaments', base.id))).data()?.inStock, false, 'Built-in items can be updated without a stored override.');
    await api.filaments.applyBulkAction([base.id], 'delete');
    assert.equal((await api.filaments.getAll()).some((item: PublicFilamentItem) => item.id === base.id), false, 'A tombstone prevents a built-in product from returning after reload.');
    const maximum = items.slice(0, MAX_CATALOG_BULK_ITEMS).map(item => item.id);
    await environment.withSecurityRulesDisabled(async context => {
      const batch = writeBatch(context.firestore());
      items.slice(0, 100).forEach(item => batch.set(doc(context.firestore(), 'filaments', item.id), item));
      await batch.commit();
    });
    await api.filaments.applyBulkAction(maximum, 'out_of_stock');
    assert.equal((await getDoc(doc(adminDb, 'filaments', maximum.at(-1)!))).data()?.inStock, false, 'The 450-item boundary is accepted.');
    assert.deepEqual((await getDoc(doc(adminDb, 'filaments', items[450].id))).data(), items[450]);
  } finally {
    delete globals.catalogBulkFixture;
    await environment.cleanup();
    await rm(bundlePath, { force: true });
    await rmdir(directory);
  }
});
