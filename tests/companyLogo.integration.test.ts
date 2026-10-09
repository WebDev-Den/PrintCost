import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, getIdToken, reload } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDocFromServer, getFirestore, Timestamp, writeBatch } from 'firebase/firestore';
import { ACCOUNT_DELETE_CONFIRMATION } from '../src/domain/accountData.ts';
import { AccountDataService } from '../src/services/accountDataService.ts';
import { CompanyLogoRepository } from '../src/services/companyLogoRepository.ts';

// Separate Auth server and random Firestore namespace; never clears browser emulator fixtures.
const { createApp } = createRequire(import.meta.url)('firebase-tools/lib/emulator/auth/server.js');

function pngImage(): string {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(128); header.writeUInt32BE(128, 4); header[8] = 8; header[9] = 6;
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(128 * 513))), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

test('real company logo repository enforces scopes, immutable metadata, CAS and account revocation', { timeout: 120_000 }, async t => {
  const projectId = `demo-kilog-logo-${randomUUID().slice(0, 8)}`;
  const environment = await initializeTestEnvironment({ projectId,
    firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } });
  const authServer = (await createApp(projectId)).listen(0, '127.0.0.1');
  await once(authServer, 'listening');
  const origin = `http://127.0.0.1:${authServer.address().port}`;
  const apps: FirebaseApp[] = [];
  const password = randomUUID();
  const image = pngImage();
  const timestamp = new Timestamp(123456, 123456000);
  function client() {
    const app = initializeApp({ apiKey: 'logo-emulator-key', projectId, authDomain: `${projectId}.firebaseapp.com` }, randomUUID());
    apps.push(app);
    const auth = getAuth(app);
    connectAuthEmulator(auth, origin, { disableWarnings: true });
    const db = getFirestore(app);
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    return { auth, db, repository: new CompanyLogoRepository(auth, db) };
  }
  async function newUser(current: ReturnType<typeof client>, name: string, verified = true) {
    const { user } = await createUserWithEmailAndPassword(current.auth, `${name}-${randomUUID()}@example.invalid`, password);
    if (verified) {
      const response = await fetch(`${origin}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`, {
        method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
        body: JSON.stringify({ localId: user.uid, emailVerified: true }),
      });
      assert.equal(response.status, 200);
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
  async function inspect(path: string) {
    let data: Record<string, unknown> | undefined;
    await environment.withSecurityRulesDisabled(async context => { data = (await getDocFromServer(doc(context.firestore(), path))).data(); });
    return data;
  }
  const account = (uid: string, blocked = false) => ({ blocked, updatedAt: timestamp, updatedBy: uid, changeId: 'seed-access' });
  const member = (uid: string, companyId: string | null, active = !!companyId) =>
    ({ companyId, active, version: 1, updatedAt: timestamp, updatedBy: uid, changeId: 'seed-membership' });

  try {
    const administrator = client(), manager = client(), foreign = client(), ordinary = client(), unverified = client(), anonymous = client();
    const adminUser = await newUser(administrator, 'admin'), managerUser = await newUser(manager, 'manager');
    const foreignUser = await newUser(foreign, 'foreign'), ordinaryUser = await newUser(ordinary, 'ordinary');
    const unverifiedUser = await newUser(unverified, 'unverified', false);
    const registry = { adminUids: [adminUser.uid], bootstrapUid: adminUser.uid, initializedAt: timestamp, version: 1, lastChangeId: 'seed-registry' };
    const company = (id: string, status = 'active') => ({ id, name: id, website: 'https://shop.example.com/', allowedDomains: ['shop.example.com'], status,
      version: 1, createdBy: adminUser.uid, createdAt: timestamp, updatedBy: adminUser.uid, updatedAt: timestamp, changeId: 'seed-company' });
    await seed({ 'system/authorization': registry, 'companies/company-a': company('company-a'), 'companies/company-b': company('company-b'),
      [`accountAccess/${adminUser.uid}`]: account(adminUser.uid), [`memberships/${adminUser.uid}`]: member(adminUser.uid, null),
      [`accountAccess/${managerUser.uid}`]: account(managerUser.uid), [`memberships/${managerUser.uid}`]: member(managerUser.uid, 'company-a'),
      [`accountAccess/${foreignUser.uid}`]: account(foreignUser.uid), [`memberships/${foreignUser.uid}`]: member(foreignUser.uid, 'company-b'),
      [`accountAccess/${ordinaryUser.uid}`]: account(ordinaryUser.uid), [`memberships/${ordinaryUser.uid}`]: member(ordinaryUser.uid, null),
      [`accountAccess/${unverifiedUser.uid}`]: account(unverifiedUser.uid), [`memberships/${unverifiedUser.uid}`]: member(unverifiedUser.uid, 'company-a') });

    let createdAt: Timestamp;
    await t.test('manager creates logo and anonymous reload reads it without changing a legacy company', async () => {
      assert.equal(await anonymous.repository.get('company-a'), null);
      const created = await manager.repository.save('company-a', image, 0);
      assert.equal(created.version, 1);
      assert.equal(created.createdBy, managerUser.uid);
      assert.equal(created.updatedBy, managerUser.uid);
      assert.equal(created.imageDataUrl, image);
      assert.ok(created.createdAt instanceof Timestamp);
      createdAt = created.createdAt;
      assert.deepEqual(await anonymous.repository.get('company-a'), created);
      assert.deepEqual(await inspect('companies/company-a'), company('company-a'));
    });

    await t.test('administrator replaces and clears; stale versions fail and creation metadata survives reload', async () => {
      const replaced = await administrator.repository.save('company-a', image, 1);
      assert.equal(replaced.version, 2);
      assert.equal(replaced.createdBy, managerUser.uid);
      assert.deepEqual(replaced.createdAt, createdAt);
      assert.equal(replaced.updatedBy, adminUser.uid);
      await assert.rejects(manager.repository.save('company-a', null, 1), /Логотип змінився/);
      assert.deepEqual(await anonymous.repository.get('company-a'), replaced);
      const cleared = await administrator.repository.save('company-a', null, 2);
      assert.equal(cleared.version, 3);
      assert.equal(cleared.imageDataUrl, null);
      assert.equal(cleared.createdBy, managerUser.uid);
      assert.deepEqual(cleared.createdAt, createdAt);
      assert.deepEqual(await new CompanyLogoRepository(manager.auth, manager.db).get('company-a'), cleared);
    });

    await t.test('two simultaneous SDK saves with one expected version accept exactly one update', async () => {
      const results = await Promise.allSettled([
        manager.repository.save('company-a', image, 3), administrator.repository.save('company-a', null, 3),
      ]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const denied = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
      assert.match(String(denied.reason), /Логотип змінився/);
      const persisted = (await anonymous.repository.get('company-a'))!;
      assert.equal(persisted.version, 4);
      assert.equal(persisted.createdBy, managerUser.uid);
      assert.deepEqual(persisted.createdAt, createdAt);
      assert.ok([adminUser.uid, managerUser.uid].includes(persisted.updatedBy));
    });

    await t.test('foreign manager, ordinary, unverified, anonymous and demo sessions cannot save', async () => {
      const before = await inspect('companyLogos/company-a');
      await assert.rejects(foreign.repository.save('company-a', image, 4), /Немає права/);
      await assert.rejects(manager.repository.save('company-b', image, 0), /Немає права/);
      await assert.rejects(ordinary.repository.save('company-a', image, 4), /Немає права/);
      await assert.rejects(unverified.repository.save('company-a', image, 4), /підтвердженою поштою/);
      await assert.rejects(anonymous.repository.save('company-a', image, 4), /підтвердженою поштою/);
      await assert.rejects(new CompanyLogoRepository(manager.auth, manager.db, () => true).save('company-a', image, 4), /справжній акаунт/);
      assert.deepEqual(await inspect('companyLogos/company-a'), before);
    });

    await t.test('fresh authority reads deny a blocked manager, revoked membership and blocked administrator', async () => {
      const before = await inspect('companyLogos/company-a');
      await seed({ [`accountAccess/${managerUser.uid}`]: account(managerUser.uid, true) });
      await assert.rejects(manager.repository.save('company-a', image, 4), /Немає права/);
      await seed({ [`accountAccess/${managerUser.uid}`]: account(managerUser.uid), [`memberships/${managerUser.uid}`]: member(managerUser.uid, null) });
      await assert.rejects(manager.repository.save('company-a', image, 4), /Немає права/);
      await seed({ [`memberships/${managerUser.uid}`]: member(managerUser.uid, 'company-a'), [`accountAccess/${adminUser.uid}`]: account(adminUser.uid, true) });
      await assert.rejects(administrator.repository.save('company-a', image, 4), /Немає права/);
      await seed({ [`accountAccess/${adminUser.uid}`]: account(adminUser.uid) });
      assert.deepEqual(await inspect('companyLogos/company-a'), before);
    });

    await t.test('disabled company stops manager and public reads but administrator can clear and create', async () => {
      await seed({ 'companies/company-a': company('company-a', 'disabled') });
      await assert.rejects(manager.repository.save('company-a', image, 4));
      await assert.rejects(anonymous.repository.get('company-a'), error => (error as { code: string }).code === 'permission-denied');
      assert.equal((await administrator.repository.save('company-a', null, 4)).version, 5);
      await seed({ 'companies/company-a': company('company-a'), 'companies/company-b': company('company-b', 'disabled') });
      assert.equal((await administrator.repository.save('company-b', image, 0)).version, 1);
      await seed({ 'companies/company-b': company('company-b') });
    });

    await t.test('missing companies and malformed images cannot create or overwrite persisted logos', async () => {
      const before = await inspect('companyLogos/company-a');
      await assert.rejects(administrator.repository.save('missing-company', image, 0), /Компанію не знайдено/);
      await assert.rejects(manager.repository.save('company-a', 'https://shop.example.com/logo.svg', 5), /PNG 128/);
      await assert.rejects(manager.repository.save('company-a', image, -1), /версія/);
      assert.equal(await inspect('companyLogos/missing-company'), undefined);
      assert.deepEqual(await inspect('companyLogos/company-a'), before);
    });

    for (const role of ['manager', 'admin'] as const) await t.test(`pending ${role} deletion denies repository writes and preserves its company's logo`, async () => {
      const departing = client(), departingUser = await newUser(departing, `departing-${role}`);
      const companyId = `company-departing-${role}`;
      await seed({ [`companies/${companyId}`]: company(companyId),
        'system/authorization': { ...registry, adminUids: role === 'admin' ? [adminUser.uid, departingUser.uid] : [adminUser.uid], version: role === 'admin' ? 3 : 2 },
        [`accountAccess/${departingUser.uid}`]: account(departingUser.uid),
        [`memberships/${departingUser.uid}`]: member(departingUser.uid, role === 'manager' ? companyId : null) });
      const original = await departing.repository.save(companyId, image, 0);
      await assert.rejects(new AccountDataService(departing.auth, departing.db).deleteOwnAccount(departingUser.uid, password, ACCOUNT_DELETE_CONFIRMATION, progress => {
        if (progress.stage === 'cleanup') throw new Error('pause after persisted deletion marker');
      }), /pause after persisted deletion marker/);
      assert.ok(await inspect(`accountDeletion/${departingUser.uid}`));
      assert.equal(departing.auth.currentUser?.uid, departingUser.uid);
      await assert.rejects(departing.repository.save(companyId, null, 1), /Немає права/);
      assert.deepEqual(await anonymous.repository.get(companyId), original);
      assert.equal((await inspect(`accountAccess/${departingUser.uid}`))?.blocked, true);
      assert.equal((await inspect(`memberships/${departingUser.uid}`))?.active, false);
      assert.deepEqual((await inspect('system/authorization'))?.adminUids, [adminUser.uid]);
    });
  } finally {
    await Promise.all(apps.map(app => deleteApp(app)));
    await environment.cleanup();
    await new Promise<void>((resolve, reject) => authServer.close((error?: Error) => error ? reject(error) : resolve()));
  }
});
