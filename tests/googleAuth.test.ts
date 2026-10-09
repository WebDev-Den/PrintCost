import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createApiImportClient } from '../src/services/apiImportClient.ts';

test('Google auth verifies captcha before popup, preserves roles and reauthenticates the same user', async () => {
  const calls: string[] = [];
  const user = { uid: 'google-user', email: 'google@example.test', displayName: 'Google User', emailVerified: true,
    metadata: { creationTime: '2026-01-01T00:00:00Z' }, providerData: [{ providerId: 'google.com' }] };
  const state = { auth: { currentUser: null as typeof user | null }, user, calls, popupError: null as unknown };
  const globals = globalThis as typeof globalThis & { googleAuthFixture?: typeof state };
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldFetch = globalThis.fetch;
  globals.googleAuthFixture = state;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, removeItem: () => calls.push('demo-cleared') } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { hostname: 'web-dev.pp.ua' } } });
  try {
    // Only SDK boundaries are fixtures; the production auth service and captcha preflight are unchanged.
    const bundle = await build({ stdin: { contents: "export * from './src/services/authService.ts'; export { AccountDataService } from './src/services/accountDataService.ts';", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser',
      plugins: [{ name: 'auth-boundaries', setup(builder) {
        builder.onResolve({ filter: /^(firebase\/auth|firebase\/firestore|\.\/firebaseClient\.ts|\.\/organizationRepository\.ts)$/ }, args => {
          if (args.importer.endsWith('authService.ts') || args.importer.endsWith('accountDataService.ts')) return { path: args.path, namespace: 'fixture' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ resolveDir: process.cwd(), contents: {
          'firebase/auth': `export * from 'firebase/auth';
            export async function signInWithPopup(auth, provider) {
              const s = globalThis.googleAuthFixture;
              if (provider.providerId !== 'google.com') throw new Error('Wrong provider');
              s.calls.push('popup'); if (s.popupError) throw s.popupError;
              auth.currentUser = s.user; return { user: s.user };
            }
            export async function reauthenticateWithPopup(user, provider) {
              const s = globalThis.googleAuthFixture;
              if (user !== s.user || provider.providerId !== 'google.com') throw new Error('Wrong user/provider');
              s.calls.push('reauth-popup'); if (s.popupError) throw s.popupError;
              return { user };
            }
            export async function reauthenticateWithCredential(user, credential) {
              const s = globalThis.googleAuthFixture;
              if (user !== s.user || credential.providerId !== 'password') throw new Error('Wrong user/provider');
              s.calls.push('reauth-credential'); return { user };
            }
            export async function updatePassword(user) {
              const s = globalThis.googleAuthFixture;
              if (user !== s.user) throw new Error('Wrong user');
              s.calls.push('update-password');
            }`,
          'firebase/firestore': `export * from 'firebase/firestore';
            export const doc = (_db, collection) => collection;
            export const getDocFromServer = async () => { globalThis.googleAuthFixture.calls.push('deletion-check'); return { exists: () => false }; };
            export const getDoc = async () => ({ data: () => null });`,
          './firebaseClient.ts': 'export const firebaseAuth = globalThis.googleAuthFixture.auth; export const firestoreDb = {};',
          './organizationRepository.ts': `export const organizationRepository = {
            ensureIdentity: async () => { globalThis.googleAuthFixture.calls.push('identity'); },
            getAccess: async () => ({ role: 'user', blocked: false, companyId: null })
          };`,
        }[args.path]! }));
      } }] });
    const { FirebaseAuthService, reauthenticateAccount, AccountDataService } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    const service = new FirebaseAuthService();
    let requests = 0;
    globalThis.fetch = async (_url, options) => {
      ++requests; calls.push('captcha');
      assert.deepEqual(JSON.parse(String(options?.body)), { action: 'login', token: 'fixture-token' });
      return Response.json({ success: true });
    };
    await assert.rejects(service.loginWithGoogle(), /перевірку безпеки/);
    assert.equal(requests, 0);
    assert.equal(calls.length, 0);
    globalThis.fetch = async () => { calls.push('captcha-denied'); return new Response(null, { status: 403 }); };
    await assert.rejects(service.loginWithGoogle('fixture-token'), /недійсна/);
    assert.deepEqual(calls, ['captcha-denied']);
    calls.length = 0;
    globalThis.fetch = async (_url, options) => {
      calls.push('captcha');
      assert.deepEqual(JSON.parse(String(options?.body)), { action: 'register', token: 'fixture-token' });
      return Response.json({ success: true });
    };
    const profile = await service.loginWithGoogle('fixture-token', 'register');
    assert.deepEqual(calls, ['captcha', 'demo-cleared', 'popup', 'deletion-check', 'identity']);
    assert.equal(profile.id, user.uid);
    assert.equal(profile.fullName, user.displayName);
    assert.equal(profile.role, 'user');
    assert.equal(profile.isAdmin, false);
    assert.deepEqual(profile.authProviders, ['google.com']);
    await reauthenticateAccount(user, '');
    assert.equal(calls.at(-1), 'reauth-popup');
    user.providerData.push({ providerId: 'password' });
    calls.length = 0;
    await reauthenticateAccount(user, '', 'google.com');
    assert.deepEqual(calls, ['reauth-popup'], 'A linked account can explicitly confirm Google without a password.');
    calls.length = 0;
    await reauthenticateAccount(user, 'fixture-password');
    await reauthenticateAccount(user, 'fixture-password', 'password');
    assert.deepEqual(calls, ['reauth-credential', 'reauth-credential'], 'Legacy/default and explicit password confirmation retain password-first behavior.');
    calls.length = 0;
    await service.changePassword('fixture-password', 'fixture-new-password');
    assert.deepEqual(calls, ['reauth-credential', 'update-password'], 'Changing a linked account password still requires its current password.');
    calls.length = 0;
    await assert.rejects(reauthenticateAccount(user, 'unused', 'unsupported'));
    user.providerData.shift();
    await assert.rejects(reauthenticateAccount(user, 'unused', 'google.com'));
    user.providerData.unshift({ providerId: 'google.com' });
    await assert.rejects(new AccountDataService(state.auth, {}).deleteOwnAccount(user.uid, '', 'ВИДАЛИТИ'), /поточний пароль/);
    assert.equal(calls.length, 0, 'Unsupported providers and linked-account deletion without a password cannot reach SDK or cleanup.');
    const api = createApiImportClient(async () => 'fixture-session', () => service.assertSession(user.uid), async (_url, init) => {
      assert.equal(_url, '/api/v1/api-key');
      calls.push('api-key-' + init?.method);
      return Response.json(init?.method === 'POST' ? { key: 'fixture-key', metadata: { prefix: 'fixture-key',
        createdAt: '2026-10-09T00:00:00.000Z', expiresAt: '2027-01-07T00:00:00.000Z', role: 'manager', companyId: 'fixture-company', requiresRotation: false } } : { revoked: true });
    });
    state.popupError = null;
    calls.length = 0;
    const rotated = await reauthenticateAccount(user, '', 'google.com').then(() => api.rotate());
    assert.equal(rotated.key, 'fixture-key'); assert.equal(rotated.metadata.companyId, 'fixture-company');
    assert.deepEqual(calls, ['reauth-popup', 'api-key-POST'], 'Linked Google confirmation allows key rotation without a password credential.');
    calls.length = 0;
    const revoked = await reauthenticateAccount(user, '', 'google.com').then(() => api.revoke());
    assert.equal(revoked.revoked, true);
    assert.deepEqual(calls, ['reauth-popup', 'api-key-DELETE'], 'Linked Google confirmation allows key revocation without a password credential.');
    for (const code of ['auth/user-mismatch', 'auth/popup-closed-by-user', 'auth/popup-blocked']) {
      state.popupError = { code };
      for (const mutate of [() => api.rotate(), () => api.revoke()]) {
        calls.length = 0;
        await assert.rejects(reauthenticateAccount(user, '', 'google.com').then(mutate), error => (error as { code: string }).code === code);
        assert.deepEqual(calls, ['reauth-popup'], 'Failed linked Google confirmation cannot request a key mutation.');
        assert.equal(state.auth.currentUser, user);
      }
    }
    user.providerData.pop();
    calls.length = 0;
    await assert.rejects(reauthenticateAccount(user, 'unused', 'password'));
    assert.equal(calls.length, 0, 'An unlinked password provider cannot fall back to a Google popup.');
    state.popupError = { code: 'auth/user-mismatch' };
    await assert.rejects(reauthenticateAccount(user, ''), error => (error as { code: string }).code === 'auth/user-mismatch');
    calls.length = 0;
    await assert.rejects(new AccountDataService(state.auth, {}).deleteOwnAccount(user.uid, '', 'ВИДАЛИТИ'), error => (error as { code: string }).code === 'auth/user-mismatch');
    assert.deepEqual(calls, ['reauth-popup'], 'A different Google identity cannot reach access revocation or cleanup.');
    state.popupError = { code: 'auth/popup-closed-by-user' };
    calls.length = 0;
    await assert.rejects(service.loginWithGoogle('fixture-token', 'register'), error => (error as { code: string }).code === 'auth/popup-closed-by-user');
    assert.deepEqual(calls, ['captcha', 'demo-cleared', 'popup']);
    calls.length = 0;
    globalThis.fetch = async () => { state.auth.currentUser = null; return Response.json({ success: true }); };
    await assert.rejects(service.loginWithGoogle('fixture-token'), /Акаунт змінився/);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = oldFetch;
    delete globals.googleAuthFixture;
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
