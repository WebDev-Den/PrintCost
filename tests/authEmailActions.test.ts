import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

test('email actions validate the Firebase operation before applying and recovery never sends email or refreshes unrelated sessions', async () => {
  const state = { calls: [] as string[], operation: 'RECOVER_EMAIL', error: null as unknown };
  const globals = globalThis as typeof globalThis & { emailActionFixture?: typeof state };
  globals.emailActionFixture = state;
  try {
    const bundle = await build({ entryPoints: ['src/services/authService.ts'], bundle: true, write: false, format: 'esm', platform: 'browser',
      plugins: [{ name: 'email-action-boundaries', setup(builder) {
        builder.onResolve({ filter: /^(firebase\/auth|\.\/firebaseClient\.ts)$/ }, args => {
          if (args.importer.endsWith('authService.ts')) return { path: args.path, namespace: 'fixture' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ resolveDir: process.cwd(), contents: args.path === './firebaseClient.ts'
          ? 'export const firebaseAuth = {}; export const firestoreDb = {};'
          : `export * from 'firebase/auth';
            export async function checkActionCode(_auth, code) { const s=globalThis.emailActionFixture; s.calls.push('check:'+code); if(s.error)throw s.error; return {operation:s.operation,data:{email:'old@example.test'}}; }
            export async function applyActionCode(_auth, code) { globalThis.emailActionFixture.calls.push('apply:'+code); }
            export async function sendPasswordResetEmail() { throw new Error('Unexpected email transmission'); }` }));
      } }] });
    const { FirebaseAuthService } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    const service = new FirebaseAuthService();
    service.refreshCurrentUser = async () => { state.calls.push('refresh'); return null; };
    await service.completeEmailAction('recovery-code', 'recoverEmail');
    assert.deepEqual(state.calls, ['check:recovery-code', 'apply:recovery-code']);
    state.calls.length = 0;
    await assert.rejects(service.completeEmailAction('recovery-code', 'verifyEmail'), /не відповідає/);
    assert.deepEqual(state.calls, ['check:recovery-code']);
    state.calls.length = 0;
    state.operation = 'PASSWORD_RESET';
    await assert.rejects(service.completeEmailAction('reset-code', 'recoverEmail'), /не відповідає/);
    assert.deepEqual(state.calls, ['check:reset-code']);
    state.calls.length = 0;
    state.operation = 'VERIFY_EMAIL';
    await service.completeEmailAction('verification-code', 'verifyEmail');
    assert.deepEqual(state.calls, ['check:verification-code', 'apply:verification-code', 'refresh']);
    state.calls.length = 0;
    state.error = { code: 'auth/expired-action-code' };
    await assert.rejects(service.completeEmailAction('expired-code', 'recoverEmail'), (error: { code: string }) => error.code === 'auth/expired-action-code');
    assert.deepEqual(state.calls, ['check:expired-code']);
    state.calls.length = 0;
    await assert.rejects(service.completeEmailAction('', 'recoverEmail'), /немає коду/);
    await assert.rejects(service.completeEmailAction('code', 'unknown'), /Непідтримувана/);
    assert.deepEqual(state.calls, []);
  } finally { delete globals.emailActionFixture; }
});
