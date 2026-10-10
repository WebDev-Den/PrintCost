export class ApiError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}

export type FirestoreValue = {
  stringValue?: string; booleanValue?: boolean; integerValue?: string; doubleValue?: number;
  nullValue?: null; timestampValue?: string; arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};
export type Document = Record<string, unknown>;
export const FIREBASE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
export interface VerifiedIdentity { uid: string; authTime: number; validSince?: number }

function decodeValue(value: FirestoreValue): unknown {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeValue);
  if (value.mapValue) return decodeFields(value.mapValue.fields || {});
  throw new ApiError(503, 'Некоректна відповідь сервісу доступу.');
}
export function decodeFields(fields: Record<string, FirestoreValue>): Document {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

export async function boundedText(response: Response, limit: number): Promise<string> {
  if (Number(response.headers.get('Content-Length')) > limit) throw new ApiError(413, 'Завеликий запит.');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ApiError(413, 'Завеликий запит.'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const joined = chunks.length === 1 ? chunks[0] : new Uint8Array(size);
  if (chunks.length > 1) {
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(joined);
}

export function createFirebaseReader(fetcher: typeof fetch) {
  return async (project: string, path: string, token?: string, appCheckToken?: string): Promise<Document | null> => {
    if (!/^[a-z][a-z0-9-]{4,62}$/.test(project)) throw new ApiError(503, 'Аналітика ще не налаштована.');
    if (appCheckToken && (appCheckToken.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(appCheckToken))) throw new ApiError(400, 'Некоректне підтвердження застосунку.');
    const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${path.split('/').map(encodeURIComponent).join('/')}`;
    let response: Response;
    try { response = await fetcher(url, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}) },
      redirect: 'manual', signal: AbortSignal.timeout(8000) }); }
    catch { throw new ApiError(503, 'Сервіс доступу тимчасово недоступний.'); }
    if (response.status === 404) return null;
    if (response.status === 401) throw new ApiError(token ? 401 : 503, 'Оновіть сесію й повторіть запит.');
    if (response.status === 403) throw new ApiError(403, 'Доступ заборонено.');
    if (!response.ok) throw new ApiError(503, 'Сервіс доступу тимчасово недоступний.');
    const parsed = JSON.parse(await boundedText(response, 128 * 1024)) as { fields?: Record<string, FirestoreValue> };
    if (!parsed.fields || typeof parsed.fields !== 'object') throw new ApiError(503, 'Некоректна відповідь сервісу доступу.');
    return decodeFields(parsed.fields);
  };
}

function base64url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new ApiError(401, 'Некоректна сесія.');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function tokenIdentity(token: string, project: string, seconds: number) {
  if (token.length > 8192) throw new ApiError(401, 'Некоректна сесія.');
  const parts = token.split('.');
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[2])) throw new ApiError(401, 'Некоректна сесія.');
  const header = JSON.parse(new TextDecoder().decode(base64url(parts[0]))) as { alg?: string; kid?: string };
  const claims = JSON.parse(new TextDecoder().decode(base64url(parts[1]))) as Record<string, unknown>;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid.length || header.kid.length > 200 ||
      claims.aud !== project || claims.iss !== `https://securetoken.google.com/${project}` ||
      typeof claims.sub !== 'string' || !claims.sub.length || claims.sub.length > 128 || claims.sub.includes('/') ||
      typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp <= seconds ||
      typeof claims.iat !== 'number' || !Number.isSafeInteger(claims.iat) || claims.iat < 0 || claims.iat > seconds || claims.exp <= claims.iat ||
      typeof claims.auth_time !== 'number' || !Number.isSafeInteger(claims.auth_time) || claims.auth_time < 0 || claims.auth_time > seconds ||
      claims.auth_time > claims.iat) throw new ApiError(401, 'Некоректна або прострочена сесія.');
  if (claims.email_verified !== true) throw new ApiError(403, 'Підтвердьте електронну пошту.');
  return { parts, kid: header.kid, uid: claims.sub, authTime: claims.auth_time };
}

export function createTokenVerifier(fetcher: typeof fetch, now: () => Date) {
  // Only Google's public keys are cached; identities and access decisions are always fresh.
  let keys: { expires: number; fetched: number; jwks: Record<string, JsonWebKey>; values: Record<string, CryptoKey> } | undefined;
  let generation = 0;
  async function loadKeys(seconds: number) {
    const started = ++generation;
    let response: Response;
    try { response = await fetcher(FIREBASE_JWKS_URL, { redirect: 'manual', signal: AbortSignal.timeout(8000) }); }
    catch { throw new ApiError(503, 'Перевірка сесії тимчасово недоступна.'); }
    if (!response.ok) throw new ApiError(503, 'Перевірка сесії тимчасово недоступна.');
    const jwks = JSON.parse(await boundedText(response, 32 * 1024)) as { keys?: (JsonWebKey & { kid?: string })[] };
    if (!Array.isArray(jwks.keys) || jwks.keys.length > 20) throw new ApiError(503, 'Перевірка сесії тимчасово недоступна.');
    const publicKeys: Record<string, JsonWebKey> = Object.create(null);
    for (const key of jwks.keys) if (typeof key.kid === 'string' && key.kid.length <= 200 && key.kty === 'RSA' &&
        (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig')) {
      publicKeys[key.kid] = key;
    }
    const maxAge = Math.min(3600, Number(/max-age=(\d+)/.exec(response.headers.get('Cache-Control') || '')?.[1] || 300));
    // Cache resolved public data, never another request's in-flight fetch.
    const loaded = { jwks: publicKeys, values: Object.create(null) as Record<string, CryptoKey>, expires: seconds + maxAge, fetched: seconds };
    if (started === generation) keys = loaded;
    return loaded;
  }
  function verify(token: string, project: string, webApiKey?: string): Promise<string>;
  function verify(token: string, project: string, webApiKey: string | undefined, details: true): Promise<VerifiedIdentity>;
  async function verify(token: string, project: string, webApiKey?: string, details = false): Promise<string | VerifiedIdentity> {
    try {
      const seconds = Math.floor(now().getTime() / 1000);
      const { parts, kid, uid, authTime } = tokenIdentity(token, project, seconds);
      if (webApiKey !== undefined) {
        if (!/^AIza[A-Za-z0-9_-]{35}$/.test(webApiKey)) throw new ApiError(503, 'Перевірка сесії ще не налаштована.');
        let response: Response;
        try {
          // Google authenticates this exact token; never add privileged account selectors.
          response = await fetcher('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + webApiKey +
            '&fields=users(localId,emailVerified,disabled,validSince)', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }),
            redirect: 'manual', signal: AbortSignal.timeout(8000),
          });
        } catch { throw new ApiError(503, 'Перевірка сесії тимчасово недоступна.'); }
        if (response.status === 400 || response.status === 401) throw new ApiError(401, 'Некоректна або прострочена сесія.');
        if (response.status === 403) throw new ApiError(403, 'Доступ заборонено.');
        if (!response.ok) throw new ApiError(503, 'Перевірка сесії тимчасово недоступна.');
        let result: { users?: { localId?: unknown; emailVerified?: unknown; disabled?: unknown; validSince?: unknown }[] };
        try { result = JSON.parse(await boundedText(response, 8192)); }
        catch { throw new ApiError(503, 'Некоректна відповідь сервісу доступу.'); }
        if (!Array.isArray(result?.users) || result.users.length !== 1 || result.users[0]?.localId !== uid) throw new ApiError(401, 'Некоректна сесія.');
        const user = result.users[0];
        if (user.disabled || user.emailVerified !== true) throw new ApiError(403, 'Акаунт заблокований або пошта не підтверджена.');
        if (user.validSince !== undefined && (typeof user.validSince !== 'string' || !/^\d+$/.test(user.validSince))) throw new ApiError(503, 'Некоректний стан акаунта.');
        const validSince = Number(user.validSince ?? '0');
        if (!Number.isSafeInteger(validSince) || validSince < 0) throw new ApiError(503, 'Некоректний стан акаунта.');
        if (authTime < validSince) throw new ApiError(401, 'Сесію відкликано. Увійдіть знову.');
        return details ? { uid, authTime, validSince } : uid;
      }
      let current = keys;
      if (!current || current.expires <= seconds || (!current.jwks[kid] && current.fetched <= seconds - 60)) current = await loadKeys(seconds);
      let key = current.values[kid];
      if (!key && current.jwks[kid]) {
        key = await crypto.subtle.importKey('jwk', current.jwks[kid], { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
        current.values[kid] = key;
      }
      if (!key || !await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) {
        throw new ApiError(401, 'Некоректна сесія.');
      }
      return details ? { uid, authTime } : uid;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(401, 'Некоректна сесія.');
    }
  }
  return verify;
}
