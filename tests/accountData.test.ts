import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase/firestore';
import { ACCOUNT_PRIVATE_COLLECTIONS, planAccountDeparture, type AccountExport } from '../src/domain/accountData.ts';
import { accountExportJson, AccountDataService } from '../src/services/accountDataService.ts';

test('self departure preserves bootstrap, advances registry CAS and never creates an empty registry', () => {
  const registry = { adminUids: ['alice', 'bob'], bootstrapUid: 'alice', initializedAt: 'immutable', version: 7, lastChangeId: 'old' };
  assert.deepEqual(planAccountDeparture('alice', registry, 'new'), { ...registry, adminUids: ['bob'], version: 8, lastChangeId: 'new' });
  assert.deepEqual(registry.adminUids, ['alice', 'bob']);
  assert.equal(planAccountDeparture('ordinary', null, 'new'), null);
  assert.deepEqual(planAccountDeparture('ordinary', registry, 'ordinary-change'), { ...registry, version: 8, lastChangeId: 'ordinary-change' });
  assert.throws(() => planAccountDeparture('alice', { ...registry, adminUids: ['alice'] }, 'new'), /Останній адміністратор/);
  assert.throws(() => planAccountDeparture('alice', { ...registry, adminUids: [] }, 'new'), /Реєстр доступу/);
});

test('raw export timestamps retain nanoseconds and private collections are explicitly scoped', () => {
  const data = { profile: { createdAt: new Timestamp(123, 456789), nested: [new Timestamp(44, 17)] } } as unknown as AccountExport;
  assert.deepEqual(JSON.parse(accountExportJson(data)), { profile: { createdAt: { type: 'timestamp', seconds: 123, nanoseconds: 456789 }, nested: [{ type: 'timestamp', seconds: 44, nanoseconds: 17 }] } });
  assert.deepEqual([...ACCOUNT_PRIVATE_COLLECTIONS], ['materials', 'printers', 'calculations', 'templates', 'settings', 'likes']);
  assert.equal(ACCOUNT_PRIVATE_COLLECTIONS.some(name => name === 'companyOffers' as never), false);
});

test('demo or another UID is refused before any Auth or Firestore operation', async () => {
  const fakeAuth = { currentUser: { uid: 'alice', email: 'alice@example.com', providerData: [{ providerId: 'password' }] } };
  const service = new AccountDataService(fakeAuth as never, {} as never);
  await assert.rejects(service.exportOwnData('bob'), /власний справжній/);
  await assert.rejects(service.deleteOwnAccount('bob', 'ignored', 'ВИДАЛИТИ'), /власний справжній/);
  await assert.rejects(service.deleteOwnAccount('alice', 'ignored', 'no'), /підтвердження/);
  await assert.rejects(service.deleteOwnAccount('alice', '', 'ВИДАЛИТИ'), /поточний пароль/);
  const demo = new AccountDataService(fakeAuth as never, {} as never, () => true);
  await assert.rejects(demo.exportOwnData('alice'), /власний справжній/);
});
