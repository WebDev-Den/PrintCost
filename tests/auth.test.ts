import assert from 'node:assert/strict';
import test from 'node:test';
import { authService, authErrorMessage, reauthenticateAccount } from '../src/services/authService.ts';
import { firebaseConfigured } from '../src/services/firebaseClient.ts';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return Array.from(this.data.keys())[index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

test('missing Firebase configuration refuses real auth and isolates explicit demo identity', async () => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalGetUser = authService.getCurrentUser;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  try {
    assert.equal(firebaseConfigured, false);
    assert.equal(await authService.getCurrentUser(), null);
    assert.equal(authService.isDemoSession(), false);
    await assert.rejects(authService.login('owner@example.com', 'password123'), /Firebase ще не налаштовано/);
    await assert.rejects(authService.loginWithGoogle(), /Firebase ще не налаштовано/);
    await assert.rejects(authService.register('owner@example.com', 'password123'), /Firebase ще не налаштовано/);
    await assert.rejects(authService.forgotPassword('owner@example.com'), /Firebase ще не налаштовано/);
    await assert.rejects(authService.resetPassword('password123'), /немає коду відновлення/);
    assert.equal(await authService.getCurrentUser(), null);

    const demo = await authService.enableDemoSession();
    assert.equal(demo.isDemoUser, true);
    assert.equal(authService.isDemoSession(), true);
    localStorage.setItem('printcost_demo_profile', JSON.stringify({ id: 'victim', email: 'victim@example.com', isAdmin: true, role: 'admin', companyId: 'victim-company', isBlocked: true, isDemoUser: false, fullName: 'Демо' }));
    const tampered = await authService.getCurrentUser();
    assert.equal(tampered?.id, demo.id);
    assert.equal(tampered?.email, demo.email);
    assert.equal(tampered?.isAdmin, false);
    assert.equal(tampered?.role, 'user');
    assert.equal(tampered?.companyId, null);
    assert.equal(tampered?.isBlocked, false);
    assert.equal(tampered?.isDemoUser, true);

    const updated = await authService.updateProfile({ fullName: ' Оператор ', workshopName: ' Майстерня ' });
    assert.equal(updated.fullName, 'Оператор');
    assert.equal((await authService.getCurrentUser())?.workshopName, 'Майстерня');
    await assert.rejects(authService.updateProfile({ fullName: 'x'.repeat(201) }), /до 200 символів/);
    await assert.rejects(authService.changePassword('oldpassword', 'newpassword'), /Firebase ще не налаштовано/);

    let releaseRead!: () => void;
    const deferredRead = new Promise<void>(resolve => { releaseRead = resolve; });
    authService.getCurrentUser = async () => { await deferredRead; return updated; };
    const pendingSave = authService.updateProfile({ fullName: 'Не записувати після виходу' });
    localStorage.removeItem('printcost_is_demo_mode');
    releaseRead();
    await assert.rejects(pendingSave, /Акаунт змінився під час операції/);
    authService.getCurrentUser = originalGetUser;
    assert.equal(JSON.parse(localStorage.getItem('printcost_demo_profile')!).fullName, 'Оператор');

    localStorage.setItem('printcost_is_demo_mode', 'true');
    authService.getCurrentUser = async () => ({ ...updated, id: 'another-account', isDemoUser: false });
    await assert.rejects(authService.updateProfile({ fullName: 'Не записувати інший профіль' }), /Акаунт змінився під час операції/);
    authService.getCurrentUser = originalGetUser;
    assert.equal(JSON.parse(localStorage.getItem('printcost_demo_profile')!).fullName, 'Оператор');

    await authService.logout();
    assert.equal(authService.isDemoSession(), false);
    assert.equal(await authService.getCurrentUser(), null);
    await new Promise<void>((resolve, reject) => {
      const stop = authService.subscribe(user => { assert.equal(user, null); stop(); resolve(); }, reject);
    });
  } finally {
    authService.getCurrentUser = originalGetUser;
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('credential and expired link errors have actionable Ukrainian messages', () => {
  assert.match(authErrorMessage({ code: 'auth/invalid-credential' }), /Невірна електронна пошта або пароль/);
  assert.match(authErrorMessage({ code: 'auth/expired-action-code' }), /Запросіть новий лист/);
  assert.doesNotMatch(authErrorMessage({ code: 'auth/unknown', message: 'secret internal details' }), /secret/);
});

test('Google popup errors are actionable and never expose provider credentials', () => {
  assert.match(authErrorMessage({ code: 'auth/popup-blocked' }), /Дозвольте спливні вікна/);
  assert.match(authErrorMessage({ code: 'auth/popup-closed-by-user' }), /Вікно Google закрито/);
  assert.match(authErrorMessage({ code: 'auth/unauthorized-domain' }), /домен ще не дозволено/);
  assert.match(authErrorMessage({ code: 'auth/operation-not-allowed' }), /спосіб входу ще не ввімкнено/);
  assert.match(authErrorMessage({ code: 'auth/account-exists-with-different-credential', credential: 'secret' }), /попереднім способом/);
  assert.match(authErrorMessage({ code: 'auth/user-mismatch' }), /той самий Google-акаунт/);
});

test('reauthentication refuses missing passwords and unsupported providers before contacting Firebase', async () => {
  const passwordUser = { email: 'owner@example.test', providerData: [{ providerId: 'password' }] };
  await assert.rejects(reauthenticateAccount(passwordUser as never, ''), /поточний пароль/);
  const linkedUser = { ...passwordUser, providerData: [...passwordUser.providerData, { providerId: 'google.com' }] };
  await assert.rejects(reauthenticateAccount(linkedUser as never, ''), /поточний пароль/);
  await assert.rejects(reauthenticateAccount(linkedUser as never, '', 'password'), /поточний пароль/);
  await assert.rejects(reauthenticateAccount(passwordUser as never, '', 'google.com'));
  await assert.rejects(reauthenticateAccount({ ...passwordUser, providerData: [{ providerId: 'google.com' }] } as never, 'unused', 'password'));
  await assert.rejects(reauthenticateAccount(linkedUser as never, 'unused', 'unsupported' as never));
  await assert.rejects(reauthenticateAccount({ ...passwordUser, providerData: [] } as never, ''), /не підтримується/);
});
