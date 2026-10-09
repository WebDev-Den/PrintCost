import { getApp, getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from 'firebase/app-check';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

const env = import.meta.env || {};
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Object.values(config).every(value => typeof value === 'string' && value.trim());
const app = firebaseConfigured ? (getApps().length ? getApp() : initializeApp(config)) : null;
const useEmulators = env.VITE_USE_FIREBASE_EMULATORS === 'true' && typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
// Attestation must be initialized before Auth and Firestore obtain their providers.
const appCheck = app && env.VITE_APP_CHECK_SITE_KEY?.trim() && !useEmulators
  ? initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(env.VITE_APP_CHECK_SITE_KEY.trim()), isTokenAutoRefreshEnabled: true }) : null;
export const firebaseAuth: Auth | null = app ? getAuth(app) : null;
export const firestoreDb: Firestore | null = app ? getFirestore(app) : null;

if (firebaseAuth) firebaseAuth.languageCode = 'uk';

if (app && useEmulators && !firebaseAuth!.emulatorConfig) {
  connectAuthEmulator(firebaseAuth!, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(firestoreDb!, '127.0.0.1', 8080);
}

export async function getAppCheckHeaders(signal?: AbortSignal): Promise<Record<string, string>> {
  signal?.throwIfAborted();
  if (!appCheck) return {};
  let cancel: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => reject(signal!.reason);
    signal?.addEventListener('abort', cancel, { once: true });
  });
  try {
    const result = await Promise.race([getToken(appCheck), aborted]);
    signal?.throwIfAborted();
    return { 'X-Firebase-AppCheck': result.token };
  } finally { if (cancel) signal?.removeEventListener('abort', cancel); }
}
