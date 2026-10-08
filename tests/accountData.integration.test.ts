import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, getIdToken, reload, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, connectFirestoreEmulator, disableNetwork, doc, enableNetwork, getDocFromServer, getDocs, getFirestore, Timestamp, writeBatch, type Firestore } from 'firebase/firestore';
import { ACCOUNT_DELETE_CONFIRMATION, ACCOUNT_PRIVATE_COLLECTIONS } from '../src/domain/accountData.ts';
import { AccountDataService, accountExportJson } from '../src/services/accountDataService.ts';

// Separate Auth server + unique Firestore project: never clears or mutates the browser's emulator data.
// Firebase CLI already supplies the Auth emulator implementation; no additional dependency or server credential.
const { createApp } = createRequire(import.meta.url)('firebase-tools/lib/emulator/auth/server.js');

test('real Web SDK export, failure retry, account isolation, last admin and concurrent registry CAS', { timeout: 120_000 }, async t => {
  const projectId = `demo-kilog-account-${randomUUID().slice(0, 8)}`;
  const environment = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } });
  const authServer = (await createApp(projectId)).listen(0, '127.0.0.1');
  await once(authServer, 'listening');
  const origin = `http://127.0.0.1:${authServer.address().port}`;
  const apps: FirebaseApp[] = [];
  const password = randomUUID();
  function client() {
    const app = initializeApp({ apiKey: 'account-emulator-key', projectId, authDomain: `${projectId}.firebaseapp.com` }, randomUUID());
    apps.push(app);
    const auth = getAuth(app);
    connectAuthEmulator(auth, origin, { disableWarnings: true });
    const db = getFirestore(app);
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    return { auth, db, service: new AccountDataService(auth, db) };
  }
  async function newUser(current: ReturnType<typeof client>, name: string, verified = true) {
    const email = `${name}-${randomUUID()}@example.invalid`;
    const { user } = await createUserWithEmailAndPassword(current.auth, email, password);
    if (verified) {
      const response = await fetch(`${origin}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`, {
        method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
        body: JSON.stringify({ localId: user.uid, emailVerified: true }),
      });
      assert.equal(response.status, 200, 'Local verification fixture succeeds.');
      await reload(user);
      await getIdToken(user, true);
    }
    return user;
  }
  async function seed(records: Record<string, Record<string, unknown>>) {
    await environment.withSecurityRulesDisabled(async context => {
      const batch = writeBatch(context.firestore());
      for (const [path, data] of Object.entries(records)) batch.set(doc(context.firestore(), path), data);
      await batch.commit();
    });
  }
  async function inspect(path: string): Promise<Record<string, unknown> | undefined> {
    let data: Record<string, unknown> | undefined;
    await environment.withSecurityRulesDisabled(async context => { data = (await getDocFromServer(doc(context.firestore(), path))).data(); });
    return data;
  }
  const timestamp = new Timestamp(123456, 123456000);
  try {
    const alice = client();
    const aliceUser = await newUser(alice, 'alice');
    const bob = client();
    const bobUser = await newUser(bob, 'bob');
    const uid = aliceUser.uid;
    const registry = { adminUids: [uid], bootstrapUid: uid, initializedAt: timestamp, version: 7, lastChangeId: 'seed-registry' };
    const companyOffer = { id: 'retained-offer', companyId: 'company-a', createdBy: uid, priceUah: 555, status: 'published' };
    const oldAudit = { actorUid: uid, targetUid: bobUser.uid, action: 'role', immutable: 'retain' };
    const records: Record<string, Record<string, unknown>> = {
      'system/authorization': registry,
      [`users/${uid}`]: { email: aliceUser.email!, fullName: 'Alice', workshopName: 'Workshop', createdAt: '2026-01-01T00:00:00.000Z' },
      [`userDirectory/${uid}`]: { uid, email: aliceUser.email!, displayName: 'Alice', verified: true, updatedAt: timestamp },
      [`accountAccess/${uid}`]: { blocked: false, updatedAt: timestamp, updatedBy: uid, changeId: 'seed-access' },
      [`memberships/${uid}`]: { companyId: 'company-a', active: true, version: 4, updatedAt: timestamp, updatedBy: uid, changeId: 'seed-membership' },
      [`users/${bobUser.uid}`]: { email: bobUser.email!, fullName: 'Bob', workshopName: '', createdAt: '2026-01-01T00:00:00.000Z' },
      [`users/${bobUser.uid}/calculations/foreign`]: { private: 'Bob only' },
      'companyOffers/retained-offer': companyOffer,
      'accessAudit/retained-audit': oldAudit,
    };
    for (const name of ACCOUNT_PRIVATE_COLLECTIONS) {
      const count = name === 'calculations' ? 251 : name === 'materials' ? 101 : 2;
      for (let index = 0; index < count; index++) records[`users/${uid}/${name}/${String(index).padStart(3, '0')}`] = { name, index, raw: { amount: '777.1234', date: timestamp } };
    }
    await seed(records);
    const exported = await alice.service.exportOwnData(uid);
    assert.equal(exported.privateData.calculations.length, 251);
    assert.equal(exported.privateData.materials.length, 101);
    assert.equal(exported.privateData.settings.length, 2, 'Raw non-pricing settings documents are included.');
    assert.equal(new Set(exported.privateData.calculations.map(item => item.id)).size, 251);
    assert.deepEqual(exported.privateData.calculations[250].data.raw, { amount: '777.1234', date: timestamp });
    assert.equal(JSON.stringify(exported).includes('Bob only'), false);
    assert.equal('adminUids' in exported.access.authorization, false);
    assert.equal(JSON.parse(accountExportJson(exported)).privateData.calculations[0].data.raw.date.nanoseconds, 123456000);
    await assert.rejects(alice.service.exportOwnData(bobUser.uid), /власний справжній/);

    await t.test('wrong password and last administrator change no persisted data', async () => {
      await assert.rejects(alice.service.deleteOwnAccount(uid, 'wrong-password', ACCOUNT_DELETE_CONFIRMATION), error => ['auth/invalid-credential', 'auth/wrong-password'].includes((error as { code: string }).code));
      assert.equal(await inspect(`accountDeletion/${uid}`), undefined);
      assert.deepEqual(await inspect('system/authorization'), registry);
      await assert.rejects(alice.service.deleteOwnAccount(uid, password, ACCOUNT_DELETE_CONFIRMATION), /Останній адміністратор/);
      assert.equal(await inspect(`accountDeletion/${uid}`), undefined);
      assert.equal((await inspect(`memberships/${uid}`))?.active, true);
      assert.ok(await inspect(`users/${uid}/calculations/250`));
    });

    await seed({ 'system/authorization': { ...registry, adminUids: [uid, bobUser.uid] } });
    let marker: Record<string, unknown>;
    await t.test('partial cleanup preserves Auth, blocks access and can resume after a fresh login', async () => {
      await assert.rejects(alice.service.deleteOwnAccount(uid, password, ACCOUNT_DELETE_CONFIRMATION, progress => {
        if (progress.stage === 'cleanup' && progress.deletedDocuments === 100) throw new Error('simulated interruption');
      }), /simulated interruption/);
      marker = (await inspect(`accountDeletion/${uid}`))!;
      assert.equal(marker.uid, uid);
      assert.equal((await inspect(`accountAccess/${uid}`))?.blocked, true);
      assert.equal((await inspect(`memberships/${uid}`))?.companyId, null);
      assert.equal((await inspect(`memberships/${uid}`))?.version, 5);
      assert.deepEqual((await inspect('system/authorization'))?.adminUids, [bobUser.uid]);
      assert.equal((await inspect('system/authorization'))?.version, 8);
      assert.equal(alice.auth.currentUser?.uid, uid);
      const remaining = await alice.service.exportOwnData(uid);
      assert.equal(remaining.deletionPending, true);
      assert.equal(remaining.privateData.materials.length, 1);
      assert.equal(remaining.privateData.calculations.length, 251);
      await signOut(alice.auth);
      await signInWithEmailAndPassword(alice.auth, aliceUser.email!, password);
      const resumedService = new AccountDataService(alice.auth, alice.db);
      await resumedService.deleteOwnAccount(uid, password, ACCOUNT_DELETE_CONFIRMATION);
      assert.equal(alice.auth.currentUser, null);
      await assert.rejects(signInWithEmailAndPassword(alice.auth, aliceUser.email!, password));
      assert.deepEqual(await inspect(`accountDeletion/${uid}`), marker, 'The original marker remains immutable across retries.');
      assert.equal((await inspect('system/authorization'))?.version, 8, 'Retry does not increment registry again.');
      assert.equal(await inspect(`users/${uid}`), undefined);
      assert.equal(await inspect(`userDirectory/${uid}`), undefined);
      await environment.withSecurityRulesDisabled(async context => {
        for (const name of ACCOUNT_PRIVATE_COLLECTIONS) assert.equal((await getDocs(collection(context.firestore(), 'users', uid, name))).empty, true);
      });
      assert.deepEqual(await inspect('companyOffers/retained-offer'), companyOffer);
      assert.deepEqual(await inspect('accessAudit/retained-audit'), oldAudit);
      assert.deepEqual(await inspect(`users/${bobUser.uid}/calculations/foreign`), { private: 'Bob only' });
    });

    await t.test('simultaneous departures use CAS retries without losing another administrator', async () => {
      const c = client(), d = client();
      const cu = await newUser(c, 'concurrent-c'), du = await newUser(d, 'concurrent-d');
      await seed({ 'system/authorization': { ...registry, adminUids: [bobUser.uid, cu.uid, du.uid], version: 12 } });
      await Promise.all([
        c.service.deleteOwnAccount(cu.uid, password, ACCOUNT_DELETE_CONFIRMATION),
        d.service.deleteOwnAccount(du.uid, password, ACCOUNT_DELETE_CONFIRMATION),
      ]);
      const final = await inspect('system/authorization');
      assert.deepEqual(final?.adminUids, [bobUser.uid]);
      assert.equal(final?.version, 14);
      assert.equal(final?.bootstrapUid, uid);
      assert.deepEqual(final?.initializedAt, timestamp);
      assert.deepEqual(await inspect('companyOffers/retained-offer'), companyOffer);
    });

    await t.test('unverified ordinary account with no registry leaves no empty bootstrap record', async () => {
      const noRegistryProject = `${projectId}-empty`;
      const isolated = await initializeTestEnvironment({ projectId: noRegistryProject, firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } });
      const ordinary = client(), ou = await newUser(ordinary, 'ordinary', false);
      // SDK Auth user stays in its Auth namespace; Rules test SDK supplies the corresponding signed owner identity.
      const db = isolated.authenticatedContext(ou.uid, { email: ou.email!, email_verified: false, auth_time: Math.floor(Date.now() / 1000) }).firestore();
      await new AccountDataService(ordinary.auth, db as unknown as Firestore).deleteOwnAccount(ou.uid, password, ACCOUNT_DELETE_CONFIRMATION);
      await isolated.withSecurityRulesDisabled(async context => {
        assert.equal((await getDocFromServer(doc(context.firestore(), 'system/authorization'))).exists(), false);
        const tombstone = (await getDocFromServer(doc(context.firestore(), 'accountDeletion', ou.uid))).data()!;
        assert.equal((await getDocFromServer(doc(context.firestore(), 'accessAudit', tombstone.changeId))).data()?.registryVersion, 0);
      });
      await isolated.cleanup();
    });

    await t.test('switching accounts during cleanup stops before either Auth identity is deleted', async () => {
      const switching = client(), su = await newUser(switching, 'switching');
      await seed({ [`users/${su.uid}/materials/keep-until-resume`]: { private: 'switching owner' } });
      let switched: Promise<unknown> | undefined;
      await assert.rejects(switching.service.deleteOwnAccount(su.uid, password, ACCOUNT_DELETE_CONFIRMATION, progress => {
        if (progress.stage === 'cleanup' && !switched) {
          // Queue offline state before the next server read, then complete the Auth switch.
          // Keep the interrupted read and credential-change ordering deterministic.
          switched = disableNetwork(switching.db).then(() => signInWithEmailAndPassword(switching.auth, bobUser.email!, password));
        }
      }));
      await switched;
      await enableNetwork(switching.db);
      assert.equal(switching.auth.currentUser?.uid, bobUser.uid);
      assert.deepEqual(await inspect(`users/${bobUser.uid}/calculations/foreign`), { private: 'Bob only' });
      await signInWithEmailAndPassword(switching.auth, su.email!, password);
      assert.equal(switching.auth.currentUser?.uid, su.uid, 'Interrupted cleanup leaves its original Auth user available for resuming.');
      assert.ok(await inspect(`accountDeletion/${su.uid}`));
      await switching.service.deleteOwnAccount(su.uid, password, ACCOUNT_DELETE_CONFIRMATION);
      assert.equal(switching.auth.currentUser, null);
    });
  } finally {
    await Promise.all(apps.map(app => deleteApp(app)));
    await environment.cleanup();
    await new Promise<void>((resolve, reject) => authServer.close((error?: Error) => error ? reject(error) : resolve()));
  }
});
