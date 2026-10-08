import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveAccess, nextAdminUids, validateCompany } from '../src/domain/organizations.ts';

test('roles require verification and active access; membership does not grant admin', () => {
  assert.equal(deriveAccess('a', true, ['a'], false).role, 'admin');
  assert.equal(deriveAccess('a', false, ['a'], false).role, 'user');
  assert.deepEqual(deriveAccess('a', true, ['a'], true), { role: 'user', companyId: null, blocked: true });
  assert.equal(deriveAccess('a', true, [], false, { active: true, companyId: 'company' }).role, 'manager');
  assert.equal(deriveAccess('a', true, [], false, { active: true, companyId: 'company' }, false).role, 'user');
  assert.equal(deriveAccess('a', true, [], false, { active: false, companyId: 'company' }).role, 'user');
});

test('admin transition preserves other admins and refuses removal/block of last admin', () => {
  assert.throws(() => nextAdminUids(['a'], 'a', 'user'), /Останнього адміністратора/);
  assert.throws(() => nextAdminUids(['a'], 'a', 'admin', true), /Останнього адміністратора/);
  assert.deepEqual(nextAdminUids(['a', 'b'], 'a', 'user'), ['b']);
  assert.deepEqual(nextAdminUids(['a'], 'b', 'admin'), ['a', 'b']);
  assert.deepEqual(nextAdminUids(['a'], 'a', 'admin'), ['a']);
  assert.throws(() => nextAdminUids(Array.from({ length: 32 }, (_, i) => `admin-${i}`), 'new', 'admin'), /32/);
});

test('company validation rejects unsafe URLs and validates every domain', () => {
  const company = { name: ' Store ', website: 'https://example.com', allowedDomains: ['Example.com', 'example.com'], status: 'active' as const };
  assert.deepEqual(validateCompany(company), { name: 'Store', website: 'https://example.com/', allowedDomains: ['example.com'], status: 'active' });
  for (const website of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com']) {
    assert.throws(() => validateCompany({ ...company, website }), /HTTPS/);
  }
  assert.throws(() => validateCompany({ ...company, allowedDomains: ['example.com', 'https://evil.test/path'] }), /доменів/);
  assert.throws(() => validateCompany({ ...company, allowedDomains: [] }), /доменів/);
  assert.throws(() => validateCompany({ ...company, name: ' ' }), /Назва/);
});
