import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { PUBLIC_FILAMENTS_CATALOG, STANDARD_TEMPERATURE_PROFILES, type TemperatureProfile } from '../src/domain/filamentsDirectory.ts';

test('merged types persist without products and rename products with their profile atomically', async () => {
  const projectId = `demo-kilog-catalog-${crypto.randomUUID().slice(0, 8)}`;
  assert.ok(projectId.startsWith('demo-'));
  const environment = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } });
  const adminDb = environment.authenticatedContext('administrator', { email_verified: true }).firestore();
  const fixture = { db: adminDb, auth: { currentUser: { uid: 'administrator' } } };
  const globals = globalThis as typeof globalThis & { catalogTypeFixture?: typeof fixture };
  globals.catalogTypeFixture = fixture;
  const directory = await mkdtemp(join(process.cwd(), 'output/catalog-test-'));
  const bundlePath = join(directory, 'api.mjs');
  try {
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'system/authorization'), { adminUids: ['administrator'], bootstrapUid: 'administrator', initializedAt: Timestamp.now(), version: 1, lastChangeId: 'seed' });
    });
    const bundle = await build({ entryPoints: ['src/services/api.ts'], bundle: true, write: false, format: 'esm', platform: 'node', external: ['firebase/*'],
      plugins: [{ name: 'local-catalog-client', setup(builder) {
        builder.onResolve({ filter: /^\.\/(firebaseClient|authService)\.ts$/ }, args => args.importer.endsWith('api.ts') ? { path: args.path, namespace: 'fixture' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.includes('firebaseClient')
          ? 'export const firestoreDb = globalThis.catalogTypeFixture.db; export const firebaseAuth = globalThis.catalogTypeFixture.auth;'
          : 'export const authService = { isDemoSession: () => false };' }));
      } }] });
    await writeFile(bundlePath, bundle.outputFiles[0].text);
    const { api } = await import(pathToFileURL(bundlePath).href);
    const profile: TemperatureProfile = { ...STANDARD_TEMPERATURE_PROFILES.PLA, plasticType: 'Sample polymer', notes: '', family: 'Композитні', densityGPerCm3: 1.37, enclosureRequired: true };
    await api.catalog.savePlasticType(null, 'CUSTOM', profile);
    assert.deepEqual((await getDoc(doc(adminDb, 'temperatureProfiles/CUSTOM'))).data(), profile);
    assert.deepEqual((await api.temperatures.getAll()).CUSTOM, profile, 'Reload keeps metadata when the type has no products.');
    await assert.rejects(api.catalog.savePlasticType(null, 'petg', profile), /вже існує/);
    await assert.rejects(api.catalog.savePlasticType(null, 'INVALID', { ...profile, densityGPerCm3: NaN }), /густину/);
    await assert.rejects(api.catalog.savePlasticType(null, 'INVALID', { ...profile, nozzleRange: '' }), /сопла/);
    assert.equal((await getDoc(doc(adminDb, 'temperatureProfiles/INVALID'))).exists(), false);

    const filament = { ...PUBLIC_FILAMENTS_CATALOG.find(item => item.type === 'PLA')!, printTempNozzle: '185–205 °C' };
    await setDoc(doc(adminDb, 'filaments', filament.id), filament);
    const before = (await api.filaments.getAll()).filter((item: typeof filament) => item.type === 'PLA');
    await assert.rejects(api.catalog.savePlasticType('PLA', 'CUSTOM', profile), /вже існує/);
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'system/authorization'), { adminUids: ['another-admin'], bootstrapUid: 'another-admin', initializedAt: Timestamp.now(), version: 2, lastChangeId: 'revoke' });
    });
    // Client reads remain public; a rejected transaction must not rename products or remove their profile.
    await assert.rejects(api.catalog.savePlasticType('PLA', 'DENIED', profile), { code: 'permission-denied' });
    assert.equal((await getDoc(doc(adminDb, 'temperatureProfiles/DENIED'))).exists(), false);
    assert.equal((await getDoc(doc(adminDb, 'temperatureProfiles/PLA'))).exists(), false);
    assert.deepEqual((await getDoc(doc(adminDb, 'filaments', filament.id))).data(), filament);
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'system/authorization'), { adminUids: ['administrator'], bootstrapUid: 'administrator', initializedAt: Timestamp.now(), version: 3, lastChangeId: 'restore' });
    });
    await api.catalog.savePlasticType('PLA', 'PLA-RENAMED', profile);
    assert.deepEqual((await getDoc(doc(adminDb, 'temperatureProfiles/PLA'))).data(), { deleted: true });
    assert.deepEqual((await getDoc(doc(adminDb, 'temperatureProfiles/PLA-RENAMED'))).data(), profile);
    for (const item of before) {
      assert.deepEqual((await getDoc(doc(adminDb, 'filaments', item.id))).data(), JSON.parse(JSON.stringify({ ...item, type: 'PLA-RENAMED', family: profile.family, densityGPerCm3: profile.densityGPerCm3 })));
    }
    const profiles = await api.temperatures.getAll();
    assert.equal(profiles.PLA, undefined);
    assert.equal(profiles['PLA-RENAMED'].notes, '', 'An empty description intentionally clears the old notes.');
    assert.equal((await getDoc(doc(adminDb, 'filaments', filament.id))).data()?.printTempNozzle, filament.printTempNozzle);
  } finally {
    delete globals.catalogTypeFixture;
    await environment.cleanup();
    await rm(bundlePath, { force: true });
    await rmdir(directory);
  }
});
