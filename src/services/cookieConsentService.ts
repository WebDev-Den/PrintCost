export const COOKIE_CONSENT_KEY = 'kilog_cookie_consent_v1';
export const COOKIE_CONSENT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const CHANGE_EVENT = 'kilog:cookie-consent';
let memoryConsent: string | undefined;

export function parseCookieConsent(raw: string | null, now = Date.now()): boolean | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || typeof value.analytics !== 'boolean' ||
        !Number.isSafeInteger(value.savedAt) || value.savedAt < 0 || value.savedAt > now ||
        now - value.savedAt >= COOKIE_CONSENT_MAX_AGE_MS) return null;
    return value.analytics;
  } catch { return null; }
}

export function getCookieConsent(): boolean | null {
  if (memoryConsent !== undefined) return parseCookieConsent(memoryConsent);
  try { return parseCookieConsent(localStorage.getItem(COOKIE_CONSENT_KEY)); }
  catch { return null; }
}

export function setCookieConsent(analytics: boolean): void {
  memoryConsent = JSON.stringify({ version: 1, analytics, savedAt: Date.now() });
  try { localStorage.setItem(COOKIE_CONSENT_KEY, memoryConsent); memoryConsent = undefined; } catch { /* Choice remains effective on this page when storage is blocked. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeCookieConsent(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === COOKIE_CONSENT_KEY || event.key === null) { memoryConsent = undefined; listener(); }
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function openCookieSettings(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('kilog:cookie-settings'));
}
