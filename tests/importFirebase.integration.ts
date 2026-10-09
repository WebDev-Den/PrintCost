import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, verify } from 'node:crypto';
import test from 'node:test';
import { createImportFirebase, encodeFields, importedOfferId } from '../workers/importFirebase.ts';
import { decodeFields } from '../workers/firebase.ts';
import { IMPORT_EXAMPLE, normalizeImportPayload } from '../src/domain/apiImports.ts';

test('transactional import respects ownership, profiles, live roles and crash receipts', { timeout: 120_000 }, async t => {
  const project = 'demo-import-' + randomUUID().slice(0, 8);
  const root = 'http://127.0.0.1:8080/v1/projects/' + project + '/databases/(default)/documents';
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const secret = JSON.stringify({ project_id: project, client_email: 'import@' + project + '.iam.gserviceaccount.com', private_key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  const users = new Map(['admin', 'manager', 'user'].map(uid => [uid, { localId: uid, emailVerified: true, validSince: '0' }]));
  const scopeBatches: string[][] = [];
  let invalidScopeBatch = '';
  const adapter = createImportFirebase(async (input, init) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      const assertion = new URLSearchParams(init?.body as string).get('assertion')!;
      const [header, claims, signature] = assertion.split('.');
      assert.ok(verify('RSA-SHA256', Buffer.from(header + '.' + claims), keys.publicKey, Buffer.from(signature, 'base64url')));
      assert.equal(JSON.parse(Buffer.from(claims, 'base64url').toString()).aud, url);
      return Response.json({ access_token: 'fixture-access', expires_in: 3600 });
    }
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) {
      const uid = JSON.parse(init?.body as string).localId[0];
      return Response.json({ users: users.has(uid) ? [users.get(uid)] : [] });
    }
    assert.ok(url.startsWith('https://firestore.googleapis.com/v1/projects/' + project + '/'));
    const response = await fetch(url.replace('https://firestore.googleapis.com/v1/projects/' + project + '/databases/(default)/documents', root), { ...init, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' } });
    if (url.endsWith(':batchGet') && response.ok) {
      const documents = JSON.parse(init?.body as string).documents as string[];
      const rows = (await response.json()).reverse();
      if (documents.length === 4) {
        scopeBatches.push(documents);
        if (invalidScopeBatch === 'missing') rows.pop();
        if (invalidScopeBatch === 'duplicate') rows[0] = rows[1];
        if (invalidScopeBatch === 'foreign') rows[0] = { missing: 'projects/foreign/databases/(default)/documents/system/authorization' };
      }
      return Response.json(rows);
    }
    return response;
  });
  const seed = async (path: string, value: Record<string, unknown>) => {
    const response = await fetch(root + '/' + path, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ fields: encodeFields(value) }) });
    assert.ok(response.ok, await response.text());
  };
  const read = async (path: string) => {
    const response = await fetch(root + '/' + path, { headers: { Authorization: 'Bearer owner' } });
    assert.ok(response.ok, 'Fixture read HTTP ' + response.status);
    return decodeFields((await response.json()).fields);
  };
  t.after(async () => {
    await fetch('http://127.0.0.1:8080/emulator/v1/projects/' + project + '/databases/(default)/documents', { method: 'DELETE' });
  });
  await seed('system/authorization', { adminUids: ['admin'], version: 1 });
  const access = { blocked: false, changeId: 'initial' };
  for (const uid of users.keys()) await seed('accountAccess/' + uid, access);
  const admin = await adapter.scope(project, secret, 'admin');
  assert.equal(scopeBatches.length, 1, 'one live batch reads all four authorization documents');
  assert.equal(scopeBatches[0].length, 4);
  assert.equal(admin.role, 'admin', 'unordered found/missing rows are mapped by document name');
  const payload = normalizeImportPayload(IMPORT_EXAMPLE);
  const results = await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-a', payload, 0);
  assert.equal(results[0].success, true);
  const companyId = results[0].companyId!;
  const id = results[0].offerId!;
  assert.equal(id, await importedOfferId(companyId, IMPORT_EXAMPLE.offers[0].externalId));
  assert.notEqual(id, await importedOfferId('another-company', IMPORT_EXAMPLE.offers[0].externalId));
  assert.equal((await read('companies/' + companyId)).name, 'shop.example.com');
  assert.equal((await read('companyOffers/' + id)).version, 1);
  assert.deepEqual(await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-a', payload, 0), results);
  assert.equal((await read('companyOffers/' + id)).version, 1, 'redelivery cannot apply a committed batch twice');
  const update = normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], priceUah: 700 }] });
  assert.equal((await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-b', update, 0))[0].success, true);
  assert.equal((await read('companyOffers/' + id)).version, 2);
  assert.equal((await read('companyOffers/' + id)).priceUah, 700);
  const hidden = normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], status: 'hidden', description: 'Preserve my note', diameterMm: 2.85 }] });
  await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-hidden', hidden, 0);
  await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-preserved', update, 0);
  const preserved = await read('companyOffers/' + id);
  assert.equal(preserved.status, 'hidden'); assert.equal(preserved.description, 'Preserve my note'); assert.equal(preserved.diameterMm, 2.85);
  const fallback = normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], companyId: 'unknown-company', externalId: 'fallback' }] });
  assert.equal((await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-fallback', fallback, 0))[0].companyId, companyId);
  await seed('memberships/manager', { active: true, companyId, version: 1, changeId: 'membership-a' });
  const manager = await adapter.scope(project, secret, 'manager');
  const foreign = normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], productUrl: 'https://foreign.example.com/p' }] });
  assert.equal((await adapter.process(project, secret, 'manager', manager.fingerprint, 'job-c', foreign, 0))[0].success, false);
  const blocked = normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], status: 'blocked' }] });
  assert.equal((await adapter.process(project, secret, 'manager', manager.fingerprint, 'job-d', blocked, 0))[0].success, false);
  assert.equal((await adapter.process(project, secret, 'manager', manager.fingerprint, 'job-e', update, 0))[0].success, true);
  await seed('temperatureProfiles/PCTG', { plasticType: 'PCTG', family: 'Інженерні', nozzleRange: '250–280 °C' });
  const custom = normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], externalId: 'pctg', type: 'PCTG' }] });
  const customResult = (await adapter.process(project, secret, 'manager', manager.fingerprint, 'job-f', custom, 0))[0];
  assert.equal(customResult.success, true);
  assert.equal((await read('companyOffers/' + customResult.offerId)).family, 'Інженерні');
  await seed('temperatureProfiles/PLA', { deleted: true });
  assert.equal((await adapter.process(project, secret, 'manager', manager.fingerprint, 'job-g', update, 0))[0].success, false);
  await seed('accountAccess/manager', { blocked: true, changeId: 'blocked' });
  await assert.rejects(adapter.process(project, secret, 'manager', manager.fingerprint, 'job-h', update, 0), /API доступне/);
  await seed('accountAccess/manager', { blocked: false, changeId: 'unblocked' });
  await assert.rejects(adapter.process(project, secret, 'manager', manager.fingerprint, 'job-h', update, 0), /Права змінилися/);
  await assert.rejects(adapter.scope(project, secret, 'user'), /Немає доступу/);
  for (const failure of ['missing', 'duplicate', 'foreign']) {
    invalidScopeBatch = failure;
    await assert.rejects(adapter.scope(project, secret, 'admin'), /Некоректна відповідь сервісу доступу/);
  }
  invalidScopeBatch = '';
  assert.equal((await adapter.scope(project, secret, 'admin')).fingerprint, admin.fingerprint);
  users.delete('admin');
  await assert.rejects(adapter.scope(project, secret, 'admin'), /видалений/);
});
