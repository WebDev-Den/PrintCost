import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyPlan, createOperationsClient, exportBackup, fieldHash, planHash, prepareAdminRecovery, prepareMigration, prepareRestore, readBackup, rollback, validateTarget, type RawDocument } from '../scripts/firebaseOperations.ts';

const firestoreOrigin = `http://${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'}`;
const authOrigin = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`;
const text = (value: string) => ({ stringValue: value });
const integer = (value: string) => ({ integerValue: value });
function fixture() {
  const projectId = `demo-kilog-operations-${randomUUID().slice(0, 8)}`;
  const client = createOperationsClient({ projectId, firestoreOrigin, authOrigin });
  async function auth(users: object[]) {
    const response = await fetch(`${authOrigin}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:batchCreate`, { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ users }) });
    assert.equal(response.status, 200, 'Auth emulator must be running; production fallback is forbidden');
    const result = await response.json() as { error?: unknown[] }; assert.ok(!result.error?.length, 'Auth fixture import failed');
  }
  async function put(path: string, fields: Record<string, unknown>) { await client.commit([{ path, before: await client.get(path), fields }]); }
  return { projectId, client, auth, put };
}
const legacy = (localId: string, extra = {}) => ({ localId, email: `${localId}@example.test`, emailVerified: true, customAttributes: JSON.stringify({ admin: true }), ...extra });

test('operations target is exact production or isolated explicit loopback emulator; no implicit environment fallback', () => {
  assert.equal(validateTarget({ projectId: 'kilo-g' }).projectId, 'kilo-g');
  for (const input of [{ projectId: 'other' }, { projectId: 'demo-kilog' }, { projectId: 'kilo-g', firestoreOrigin, authOrigin },
    { projectId: 'demo-kilog-operations-test', firestoreOrigin: 'https://remote.example', authOrigin }, { projectId: 'demo-kilog-operations-test', firestoreOrigin }]) assert.throws(() => validateTarget(input));
});

test('snapshot hashes use code-unit key order independent of locale and preserve distinct Unicode keys', () => {
  const fields = { 'ї': text('uk'), 'z': text('last-latin'), 'é': text('accent'), 'e\u0301': text('decomposed'), 'A': integer('0012') };
  const expected = '{"A":{"integerValue":"0012"},"é":{"stringValue":"decomposed"},"z":{"stringValue":"last-latin"},"é":{"stringValue":"accent"},"ї":{"stringValue":"uk"}}';
  assert.equal(fieldHash({ name: '', fields }), createHash('sha256').update(expected).digest('hex'));
  assert.equal(fieldHash({ name: '', fields: Object.fromEntries(Object.entries(fields).reverse()) }), fieldHash({ name: '', fields }));
  assert.equal(fieldHash({ name: 'existing-empty' }), fieldHash({ name: 'existing-empty', fields: {} }));
  assert.notEqual(fieldHash({ name: 'existing-empty' }), fieldHash(null));
});

test('real paginated recursive export and repeated migration/rollback preserve IDs, orphan likes, raw types and public authorship', async () => {
  const f = fixture();
  await f.auth([legacy('legacy-admin'), legacy('unverified', { emailVerified: false }), legacy('disabled', { disabled: true }),
    legacy('named-admin', { customAttributes: '{}', displayName: 'admin' }), legacy('manager', { customAttributes: '{"role":"manager","companyId":"company-a"}' })]);
  const paths = ['users/legacy-admin', 'users/legacy-admin/calculations/old-history', 'users/legacy-admin/templates/same-id', 'companyOffers/authored-offer', 'filaments/catalog-id', 'accountDeletion/deleted-user'];
  const raw = { wideInteger: integer('9007199254740993'), timestamp: { timestampValue: '2024-02-29T12:34:56.123456Z' },
    bytes: { bytesValue: 'AAEC' }, reference: { referenceValue: f.client.resource('filaments/catalog-id') },
    nested: { mapValue: { fields: { list: { arrayValue: { values: [text('0012'), { nullValue: null }, { booleanValue: true }] } } } } } };
  const changes = paths.map(path => ({ path, before: null, fields: { ...raw, id: text(path.split('/').at(-1)!), createdBy: text('legacy-admin') } }));
  for (let index = 0; index < 121; index++) changes.push({ path: `users/legacy-admin/likes/like-${index}`, before: null, fields: { ...raw, id: text(`like-${index}`), createdBy: text('legacy-admin') } });
  changes.push({ path: 'users/missing-parent/likes/orphan-like', before: null, fields: { ...raw, id: text('orphan-like'), createdBy: text('missing-parent') } });
  await f.client.commit(changes);
  const backup = await exportBackup(f.client), snapshot = await readBackup(backup.directory, f.client);
  assert.equal(snapshot.documents.size, 128); assert.ok(snapshot.manifest.missingParents >= 1);
  assert.ok(snapshot.documents.has('users/missing-parent/likes/orphan-like')); assert.ok(!snapshot.documents.has('users/missing-parent'));
  assert.deepEqual(snapshot.documents.get(paths[1])!.fields!.wideInteger, integer('9007199254740993'));
  const plan = await prepareMigration(f.client, backup.directory), journal = resolve(backup.directory, 'migration-journal.json');
  assert.equal(plan.changes.length, 4); assert.equal((plan.changes[0].fields!.adminUids as { arrayValue: { values: object[] } }).arrayValue.values.length, 1);
  assert.deepEqual(await applyPlan(f.client, plan, planHash(plan), journal), { changed: 4, state: 'committed' });
  assert.equal((await applyPlan(f.client, plan, planHash(plan), journal)).changed, 0);
  assert.equal((await prepareMigration(f.client, backup.directory)).changes.length, 0);
  for (const [path, original] of snapshot.documents) assert.equal(fieldHash(await f.client.get(path)), fieldHash(original), path);
  assert.deepEqual(await rollback(f.client, journal, planHash(plan)), { changed: 4, conflicts: 0 });
  assert.deepEqual(await rollback(f.client, journal, planHash(plan)), { changed: 0, conflicts: 0 });
  assert.equal(await f.client.get('system/authorization'), null);
  for (const [path, original] of snapshot.documents) assert.equal(fieldHash(await f.client.get(path)), fieldHash(original), path);
  const removedPath = paths[1], before = await f.client.get(removedPath);
  await f.client.commit([{ path: removedPath, before, fields: null }]);
  const restore = await prepareRestore(f.client, backup.directory, [removedPath]);
  assert.equal(restore.changes.length, 1);
  await applyPlan(f.client, restore, planHash(restore), resolve(backup.directory, 'restore-journal.json'));
  const restored = await f.client.get(removedPath);
  assert.equal(restored!.name, before!.name); assert.deepEqual(restored!.fields, before!.fields);
});

test('empty and nonverified legacy claims keep owner bootstrap absent; names and company claims never infer permission', async () => {
  const f = fixture(); await f.auth([legacy('not-verified', { emailVerified: false }), legacy('name-admin', { displayName: 'Admin', customAttributes: '{"admin":"true","companyId":"company-a"}' })]);
  const backup = await exportBackup(f.client), plan = await prepareMigration(f.client, backup.directory);
  assert.equal(plan.changes.length, 0); assert.equal(await f.client.get('system/authorization'), null);
  assert.deepEqual(await applyPlan(f.client, plan, planHash(plan), resolve(backup.directory, 'no-op.json')), { changed: 0, state: 'no-op' });
});

test('review hash, role collision, atomic preconditions and rollback conflicts preserve concurrent data', async () => {
  const f = fixture(); await f.auth([legacy('admin')]);
  const backup = await exportBackup(f.client), plan = await prepareMigration(f.client, backup.directory), journal = resolve(backup.directory, 'journal.json');
  await assert.rejects(applyPlan(f.client, plan, 'wrong', journal)); assert.equal(await f.client.get('system/authorization'), null);
  await f.put('accountAccess/admin', { blocked: { booleanValue: true } });
  await assert.rejects(applyPlan(f.client, plan, planHash(plan), journal)); assert.equal(await f.client.get('system/authorization'), null);
  await assert.rejects(prepareMigration(f.client, backup.directory));
  const current = await f.client.get('accountAccess/admin'); await f.client.commit([{ path: 'accountAccess/admin', before: current, fields: null }]);
  await applyPlan(f.client, plan, planHash(plan), journal);
  const registry = await f.client.get('system/authorization');
  await f.put('system/authorization', { ...registry!.fields, version: integer('2') });
  assert.deepEqual(await rollback(f.client, journal, planHash(plan)), { changed: 0, conflicts: 1 });
  assert.deepEqual((await f.client.get('system/authorization'))!.fields!.version, integer('2'));
  assert.ok(await f.client.get('memberships/admin'), 'a conflicted rollback must not partially delete role data');
});

test('recovery selects an explicit currently verified enabled Auth UID and preserves a stale bootstrap registry through CAS rollback', async () => {
  const f = fixture(); await f.auth([legacy('new-owner', { customAttributes: '{}' }), legacy('disabled-owner', { disabled: true }), legacy('unverified-owner', { emailVerified: false })]);
  const fields = { adminUids: { arrayValue: { values: [text('deleted-last-admin')] } }, bootstrapUid: text('deleted-last-admin'), initializedAt: { timestampValue: '2020-01-01T00:00:00Z' }, version: integer('7'), lastChangeId: text('historical') };
  await f.put('system/authorization', fields);
  const backup = await exportBackup(f.client);
  for (const candidate of ['missing-uid', 'disabled-owner', 'unverified-owner']) await assert.rejects(prepareAdminRecovery(f.client, backup.directory, candidate));
  const plan = await prepareAdminRecovery(f.client, backup.directory, 'new-owner'), journal = resolve(backup.directory, 'recovery-journal.json');
  assert.equal(plan.changes.length, 4);
  await applyPlan(f.client, plan, planHash(plan), journal);
  const updated = (await f.client.get('system/authorization'))!;
  assert.deepEqual(updated.fields!.bootstrapUid, fields.bootstrapUid); assert.deepEqual(updated.fields!.initializedAt, fields.initializedAt);
  assert.deepEqual(updated.fields!.adminUids, { arrayValue: { values: [text('deleted-last-admin'), text('new-owner')] } });
  assert.deepEqual(updated.fields!.version, integer('8'));
  await rollback(f.client, journal, planHash(plan)); assert.equal(fieldHash(await f.client.get('system/authorization')), fieldHash({ name: '', fields }));
  await f.put('accountDeletion/new-owner', { uid: text('new-owner') });
  await assert.rejects(prepareAdminRecovery(f.client, backup.directory, 'new-owner'));
});

test('selected restoration skips fresh changes and only replaces an explicitly expected snapshot with CAS', async () => {
  const f = fixture(); await f.put('users/u/likes/kept-id', { filamentId: text('original'), precision: integer('9007199254740993') });
  const original = await exportBackup(f.client);
  await f.put('users/u/likes/kept-id', { filamentId: text('new-choice') });
  assert.equal((await prepareRestore(f.client, original.directory, ['users/u/likes/kept-id'])).changes.length, 0);
  const expected = await exportBackup(f.client), restore = await prepareRestore(f.client, original.directory, ['users/u/likes/kept-id'], expected.directory);
  assert.equal(restore.changes.length, 1);
  await f.put('users/u/likes/kept-id', { filamentId: text('even-newer') });
  await assert.rejects(applyPlan(f.client, restore, planHash(restore), resolve(original.directory, 'stale-restore.json')));
  assert.deepEqual((await f.client.get('users/u/likes/kept-id'))!.fields!.filamentId, text('even-newer'));
  assert.equal((await prepareRestore(f.client, original.directory, ['users/u/likes/kept-id'], expected.directory)).changes.length, 0);
});

test('backup integrity and an unsealed post-commit journal fail closed without absorbing a later write', async () => {
  const f = fixture(); await f.auth([legacy('admin')]);
  const backup = await exportBackup(f.client), plan = await prepareMigration(f.client, backup.directory), journal = resolve(backup.directory, 'unsealed.json');
  writeFileSync(journal, JSON.stringify({ schema: 'kilog-journal-v1', projectId: f.projectId, planHash: planHash(plan), changes: plan.changes, after: [], state: 'prepared' }));
  await f.client.commit(plan.changes);
  await assert.rejects(applyPlan(f.client, plan, planHash(plan), journal));
  await assert.rejects(rollback(f.client, journal, planHash(plan)));
  const manifest = resolve(backup.directory, 'manifest.json'), data = JSON.parse(readFileSync(manifest, 'utf8')); data.authUsers += 1; writeFileSync(manifest, JSON.stringify(data));
  await assert.rejects(readBackup(backup.directory, f.client));
  const registry = await f.client.get('system/authorization'); assert.ok(registry);
});

test('post-commit journal receipts refuse a concurrent newer write instead of making it rollback-owned', async () => {
  const f = fixture(); await f.auth([legacy('admin')]);
  const backup = await exportBackup(f.client), plan = await prepareMigration(f.client, backup.directory), journal = resolve(backup.directory, 'raced-journal.json');
  const raced = { ...f.client, async commit(changes: Parameters<typeof f.client.commit>[0]) {
    const receipts = await f.client.commit(changes);
    const registry = await f.client.get('system/authorization');
    await f.put('system/authorization', { ...registry!.fields, version: integer('2') });
    return receipts;
  } };
  await assert.rejects(applyPlan(raced, plan, planHash(plan), journal), /newer data appeared before journal sealing/);
  assert.equal(JSON.parse(readFileSync(journal, 'utf8')).state, 'prepared');
  await assert.rejects(rollback(f.client, journal, planHash(plan)));
  assert.deepEqual((await f.client.get('system/authorization'))!.fields!.version, integer('2'));
});

test('selected restore rollback preserves an existing empty document whose raw REST fields are omitted', async () => {
  const f = fixture(), path = 'users/u/likes/empty-existing';
  await f.put(path, { filamentId: text('original') });
  const original = await exportBackup(f.client);
  await f.put(path, {});
  const before = await f.client.get(path);
  assert.ok(before, 'the empty document exists before restoration');
  assert.equal(before.fields, undefined, 'real emulator REST omits fields for the empty document');
  const expected = await exportBackup(f.client), plan = await prepareRestore(f.client, original.directory, [path], expected.directory);
  assert.equal(plan.changes.length, 1);
  const journal = resolve(original.directory, 'empty-restore-journal.json');
  await applyPlan(f.client, plan, planHash(plan), journal);
  assert.deepEqual((await f.client.get(path))!.fields, { filamentId: text('original') });
  assert.deepEqual(await rollback(f.client, journal, planHash(plan)), { changed: 1, conflicts: 0 });
  const rolledBack = await f.client.get(path);
  assert.ok(rolledBack, 'rollback must preserve the previously existing empty document');
  assert.equal(rolledBack.fields, undefined);
  assert.equal(fieldHash(rolledBack), fieldHash(before));
  assert.equal(rolledBack.name, before.name);
});
