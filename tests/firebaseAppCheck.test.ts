import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

test('App Check starts before Firebase services, has no production emulator bypass, and token failures never downgrade requests', async () => {
  const state = { calls: [] as string[], window: { location: { hostname: 'web-dev.pp.ua' } }, error: null as unknown, hang: false };
  const globals = globalThis as typeof globalThis & { firebaseClientFixture?: typeof state };
  globals.firebaseClientFixture = state;
  const publicConfig = { VITE_FIREBASE_API_KEY: 'public-fixture', VITE_FIREBASE_AUTH_DOMAIN: 'example.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'kilo-g', VITE_FIREBASE_APP_ID: 'public-fixture-app' };
  async function load(env: Record<string, string>) {
    state.calls.length = 0;
    const bundle = await build({ entryPoints: ['src/services/firebaseClient.ts'], bundle: true, write: false, format: 'esm', platform: 'browser',
      define: { 'import.meta.env': JSON.stringify(env), window: 'globalThis.firebaseClientFixture.window' },
      plugins: [{ name: 'app-check-sdk-boundary', setup(builder) {
        builder.onResolve({ filter: /^firebase\// }, args => ({ path: args.path, namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: ({
          'firebase/app': `export const getApps=()=>[]; export const getApp=()=>({}); export function initializeApp(){globalThis.firebaseClientFixture.calls.push('app');return {};}`,
          'firebase/auth': `export function getAuth(){globalThis.firebaseClientFixture.calls.push('auth');return {};} export function connectAuthEmulator(){globalThis.firebaseClientFixture.calls.push('auth-emulator');}`,
          'firebase/firestore': `export function getFirestore(){globalThis.firebaseClientFixture.calls.push('firestore');return {};} export function connectFirestoreEmulator(){globalThis.firebaseClientFixture.calls.push('firestore-emulator');}`,
          'firebase/app-check': `export class ReCaptchaEnterpriseProvider {constructor(key){this.key=key;}} export function initializeAppCheck(_app,options){const s=globalThis.firebaseClientFixture;s.calls.push('app-check:'+options.provider.key);if(!options.isTokenAutoRefreshEnabled)throw new Error('Refresh disabled');return {};}
            export async function getToken(){const s=globalThis.firebaseClientFixture;s.calls.push('token');if(s.error)throw s.error;if(s.hang)return new Promise(()=>{});return {token:'fixture.appcheck.signature'};}`,
        } as Record<string, string>)[args.path] }));
      } }] });
    // A distinct module URL prevents the module cache from reusing another environment.
    return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  }
  try {
    const protectedClient = await load({ ...publicConfig, VITE_APP_CHECK_SITE_KEY: 'registered-public-key' });
    assert.deepEqual(state.calls, ['app', 'app-check:registered-public-key', 'auth', 'firestore']);
    assert.deepEqual(await protectedClient.getAppCheckHeaders(), { 'X-Firebase-AppCheck': 'fixture.appcheck.signature' });
    state.error = new Error('Attestation refused');
    await assert.rejects(protectedClient.getAppCheckHeaders(), /Attestation refused/);
    state.error = null; state.hang = true;
    const cancel = new AbortController();
    const waiting = protectedClient.getAppCheckHeaders(cancel.signal);
    cancel.abort(new Error('Request deadline'));
    await assert.rejects(waiting, /Request deadline/);
    await assert.rejects(protectedClient.getAppCheckHeaders(cancel.signal), /Request deadline/);
    state.hang = false;
    const withoutKey = await load(publicConfig);
    assert.deepEqual(state.calls, ['app', 'auth', 'firestore']);
    assert.deepEqual(await withoutKey.getAppCheckHeaders(), {});
    state.window.location.hostname = 'localhost';
    await load({ ...publicConfig, VITE_APP_CHECK_SITE_KEY: 'local-key', VITE_USE_FIREBASE_EMULATORS: 'true' });
    assert.deepEqual(state.calls, ['app', 'auth', 'firestore', 'auth-emulator', 'firestore-emulator']);
    state.window.location.hostname = 'web-dev.pp.ua';
    await load({ ...publicConfig, VITE_APP_CHECK_SITE_KEY: 'production-key', VITE_USE_FIREBASE_EMULATORS: 'true' });
    assert.deepEqual(state.calls, ['app', 'app-check:production-key', 'auth', 'firestore']);
    const unconfigured = await load({ VITE_APP_CHECK_SITE_KEY: 'unused-key' });
    assert.deepEqual(state.calls, []);
    assert.deepEqual(await unconfigured.getAppCheckHeaders(), {});
  } finally { delete globals.firebaseClientFixture; }
});
