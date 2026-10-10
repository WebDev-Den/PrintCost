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
  const documentReads: string[] = [];
  let authChecks = 0;
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
      authChecks++;
      const uid = JSON.parse(init?.body as string).localId[0];
      return Response.json({ users: users.has(uid) ? [users.get(uid)] : [] });
    }
    assert.ok(url.startsWith('https://firestore.googleapis.com/v1/projects/' + project + '/'));
    const response = await fetch(url.replace('https://firestore.googleapis.com/v1/projects/' + project + '/databases/(default)/documents', root), { ...init, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' } });
    if (url.endsWith(':batchGet') && response.ok) {
      const documents = JSON.parse(init?.body as string).documents as string[];
      documentReads.push(...documents);
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
  assert.equal((await read('companyOffers/' + id)).status, 'hidden', 'new imported offers are drafts');
  assert.deepEqual(await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-a', payload, 0), results);
  assert.equal((await read('companyOffers/' + id)).version, 1, 'redelivery cannot apply a committed batch twice');
  const update = normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], priceUah: 700 }] });
  assert.equal((await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-b', update, 0))[0].success, true);
  assert.equal((await read('companyOffers/' + id)).version, 2);
  assert.equal((await read('companyOffers/' + id)).priceUah, 700);
  const hidden = normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], status: 'hidden', description: 'Preserve my note',
    diameterMm: 2.85, packagingType: 'refill', colorTone: 'white' }] });
  await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-hidden', hidden, 0);
  await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-preserved', update, 0);
  const preserved = await read('companyOffers/' + id);
  assert.equal(preserved.status, 'hidden'); assert.equal(preserved.description, 'Preserve my note'); assert.equal(preserved.diameterMm, 2.85);
  await seed('companyOffers/' + id, { ...preserved, status: 'published' });
  const priceAndStock = normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], priceUah: 730, inStock: false }] });
  await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-published-update', priceAndStock, 0);
  const published = await read('companyOffers/' + id);
  assert.equal(published.status, 'published', 'price and stock updates preserve approved content');
  assert.equal(published.priceUah, 730); assert.equal(published.inStock, false);
  assert.equal(published.description, 'Preserve my note'); assert.equal(published.diameterMm, 2.85);
  assert.equal(published.packagingType, 'refill'); assert.equal(published.colorTone, 'white');
  assert.equal(published.version, Number(preserved.version) + 1);
  await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-published-noop', priceAndStock, 0);
  assert.deepEqual(await read('companyOffers/' + id), published, 'an unchanged import commits its receipt without changing version or timestamps');
  const legacyPublished = normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], externalId: 'legacy-published', status: 'published' }] });
  legacyPublished.offers[0].offer.status = 'published';
  const legacyResult = (await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-legacy-published', legacyPublished, 0))[0];
  assert.equal(legacyResult.success, true);
  assert.equal((await read('companyOffers/' + legacyResult.offerId)).status, 'hidden', 'a queued payload from an older release cannot publish');
  await t.test('only price and stock can change without another publication review', async () => {
    const source = { ...IMPORT_EXAMPLE.offers[0], companyId, description: 'Preserve my note', diameterMm: 2.85,
      packagingType: 'refill', colorTone: 'white' };
    const changes = { name: 'Changed title', brand: 'Changed brand', type: 'PETG', family: 'Інженерні', colorName: 'Сірий',
      colorHex: '#aabbcc', colorTone: 'red', packagingType: 'spool', spoolWeightGrams: 750, diameterMm: 1.75,
      description: 'Changed note', productUrl: 'https://shop.example.com/new-url' };
    for (const [field, value] of Object.entries(changes)) {
      await seed('companyOffers/' + id, published);
      const changed = normalizeImportPayload({ offers: [{ ...source, [field]: value }] });
      const result = (await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-content-' + field, changed, 0))[0];
      assert.equal(result.success, true, field);
      assert.equal((await read('companyOffers/' + id)).status, 'hidden', field + ' needs publication review');
    }
    await seed('companyOffers/' + id, published);
    const explicitHidden = normalizeImportPayload({ offers: [{ ...source, priceUah: 730, inStock: false, status: 'hidden' }] });
    await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-explicit-hide', explicitHidden, 0);
    assert.equal((await read('companyOffers/' + id)).status, 'hidden', 'explicit hiding is not treated as omitted status');
    const explicitPublish = normalizeImportPayload({ offers: [{ ...source, priceUah: 740, status: 'published' }] });
    await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-explicit-publish', explicitPublish, 0);
    assert.equal((await read('companyOffers/' + id)).status, 'hidden', 'import cannot promote a hidden offer');
    await seed('companyOffers/' + id, published);
    await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-keep-explicit-published', explicitPublish, 0);
    assert.equal((await read('companyOffers/' + id)).status, 'published', 'legacy publication flags can retain existing approval');
    await seed('companyOffers/' + id, published);
    const company = await read('companies/' + companyId);
    await seed('companies/' + companyId, { ...company, allowedDomains: ['new-shop.example.com'] });
    const denied = await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-noop-invalid-domain', priceAndStock, 0);
    assert.equal(denied[0].success, false, 'an unchanged offer still validates its current allowed domains');
    assert.equal((await read('companyOffers/' + id)).status, 'published');
    await seed('companies/' + companyId, company);
    await seed('temperatureProfiles/PLA', { plasticType: 'PLA', family: 'Композитні', nozzleRange: '190–225 °C' });
    await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-resolved-family', priceAndStock, 0);
    assert.equal((await read('companyOffers/' + id)).status, 'hidden', 'a changed resolved family needs review even when omitted in JSON');
    const removed = await fetch(root + '/temperatureProfiles/PLA', { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
    assert.ok(removed.ok);
    await seed('companyOffers/' + id, published);
  });
  await t.test('disabled companies deny published offer no-ops and price-only updates', async () => {
    const company = await read('companies/' + companyId);
    await seed('companies/' + companyId, { ...company, status: 'disabled' });
    try {
      for (const [label, priceUah] of [['noop', 730], ['price-only', 740]] as const) {
        const input = normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], companyId, priceUah, inStock: false }] });
        const result = (await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-disabled-' + label, input, 0))[0];
        assert.equal(result.success, false, label);
        assert.match(result.message || '', /активної компанії/, label);
        assert.deepEqual(await read('companyOffers/' + id), published, label + ' cannot change the offer, version or timestamps');
      }
    } finally {
      await seed('companies/' + companyId, company);
    }
  });
  const fallback = normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], companyId: 'unknown-company', externalId: 'fallback' }] });
  assert.equal((await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-fallback', fallback, 0))[0].companyId, companyId);
  await seed('memberships/manager', { active: true, companyId, version: 1, changeId: 'membership-a' });
  const manager = await adapter.scope(project, secret, 'manager');
  await t.test('transaction read reuse includes missing profiles and never survives the next delivery', async () => {
    const repeated = normalizeImportPayload({ offers: Array.from({ length: 8 }, (_, index) => ({
      ...IMPORT_EXAMPLE.offers[0], companyId, externalId: 'cached-read-' + index,
    })) });
    const count = (path: string) => documentReads.filter(name => name.endsWith('/' + path)).length;
    const companyBefore = count('companies/' + companyId), profileBefore = count('temperatureProfiles/PLA'), authBefore = authChecks;
    const first = await adapter.process(project, secret, 'manager', manager.fingerprint, 'job-cached-reads', repeated, 0);
    assert.equal(first.length, 5); assert.ok(first.every(result => result.success));
    assert.equal(count('companies/' + companyId) - companyBefore, 2, 'Fresh scope and one resolver read, instead of one company read per offer.');
    assert.equal(count('temperatureProfiles/PLA') - profileBefore, 1, 'A missing profile is reused only inside this transaction.');
    await seed('temperatureProfiles/PLA', { plasticType: 'PLA', family: 'Композитні', nozzleRange: '190–225 °C' });
    const second = await adapter.process(project, secret, 'manager', manager.fingerprint, 'job-cached-reads', repeated, 5);
    assert.equal(second.length, 8); assert.ok(second.every(result => result.success));
    for (const result of second.slice(5)) assert.equal((await read('companyOffers/' + result.offerId)).family, 'Композитні');
    assert.equal(count('temperatureProfiles/PLA') - profileBefore, 2, 'The next delivery reads the newly created profile.');
    assert.equal(authChecks - authBefore, 2, 'Account state is checked freshly for every delivery.');
    const removed = await fetch(root + '/temperatureProfiles/PLA', { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
    assert.ok(removed.ok);
    const company = await read('companies/' + companyId);
    const changed = await fetch(root + '/companies/' + companyId + '?updateMask.fieldPaths=allowedDomains', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ fields: encodeFields({ allowedDomains: ['new-shop.example.com'] }) }),
    });
    assert.ok(changed.ok);
    const denied = await adapter.process(project, secret, 'manager', manager.fingerprint, 'job-domain-changed', repeated, 0);
    assert.ok(denied.every(result => !result.success), 'A later transaction cannot use the old authorized domains.');
    const restored = await fetch(root + '/companies/' + companyId + '?updateMask.fieldPaths=allowedDomains', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ fields: encodeFields({ allowedDomains: company.allowedDomains }) }),
    });
    assert.ok(restored.ok);
  });
  await t.test('pending company writes override cached reads and per-item rollback does not retain a failed auto company', async () => {
    const change = normalizeImportPayload({ companies: [{ companyId, website: 'https://shop.example.com/',
      allowedDomains: ['shop.example.com', 'new-shop.example.com'] }], offers: [
      { ...IMPORT_EXAMPLE.offers[0], externalId: 'failed-auto', type: 'PA12', productUrl: 'https://rollback.example.com/first' },
      { ...IMPORT_EXAMPLE.offers[0], externalId: 'pending-domain', companyId, productUrl: 'https://new-shop.example.com/pla' },
      { ...IMPORT_EXAMPLE.offers[0], externalId: 'valid-auto', productUrl: 'https://rollback.example.com/second' },
    ] });
    const outcome = await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-pending-reuse', change, 0);
    assert.deepEqual(outcome.map(result => result.success), [true, false, true, true]);
    assert.equal((await read('companyOffers/' + outcome[2].offerId)).productUrl, 'https://new-shop.example.com/pla');
    assert.equal((await read('companies/' + outcome[3].companyId)).version, 1, 'Only the successful item commits the auto company.');
  });
  const foreign = normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], productUrl: 'https://foreign.example.com/p' }] });
  assert.equal((await adapter.process(project, secret, 'manager', manager.fingerprint, 'job-c', foreign, 0))[0].success, false);
  const blocked = normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], status: 'blocked' }] });
  assert.equal((await adapter.process(project, secret, 'manager', manager.fingerprint, 'job-d', blocked, 0))[0].success, false);
  assert.equal((await adapter.process(project, secret, 'manager', manager.fingerprint, 'job-e', update, 0))[0].success, true);
  await seed('companyOffers/' + id, { ...await read('companyOffers/' + id), status: 'blocked' });
  assert.equal((await adapter.process(project, secret, 'manager', manager.fingerprint, 'job-blocked-manager', update, 0))[0].success, false);
  assert.equal((await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-blocked-admin', update, 0))[0].success, true);
  assert.equal((await read('companyOffers/' + id)).status, 'blocked', 'administrator moderation survives an import without status');
  const publishBlocked = normalizeImportPayload({ offers: [{ ...IMPORT_EXAMPLE.offers[0], status: 'published' }] });
  assert.equal((await adapter.process(project, secret, 'admin', admin.fingerprint, 'job-blocked-publish', publishBlocked, 0))[0].success, true);
  assert.equal((await read('companyOffers/' + id)).status, 'blocked');
  await seed('companyOffers/' + id, { ...await read('companyOffers/' + id), status: 'hidden' });
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
