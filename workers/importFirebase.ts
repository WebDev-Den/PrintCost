import { ApiError, boundedText, decodeFields, type Document, type FirestoreValue } from './firebase.ts';
import { IMPORT_LIMITS, importDomain, profileForImport, type ImportPayload, type ImportItemResult } from '../src/domain/apiImports.ts';
import { assertCompanyOfferWrite, validateCompanyOfferInput, type CompanyOffer } from '../src/domain/companyOfferValidation.ts';
import { validateCompany, type Company } from '../src/domain/organizations.ts';
import type { TemperatureProfile } from '../src/domain/filamentsDirectory.ts';

export interface ImportScope { uid: string; role: 'admin' | 'manager'; companyId: string | null; fingerprint: string; validSince: number; registryVersion: number }
function base64(value: Uint8Array): string { return btoa(String.fromCharCode(...value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), n => n.toString(16).padStart(2, '0')).join('');
}
export async function importedOfferId(companyId: string, externalId: string): Promise<string> {
  return 'api_' + await digest(JSON.stringify([companyId, externalId]));
}
export function encodeValue(value: unknown): FirestoreValue {
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (value && typeof value === 'object') return { mapValue: { fields: encodeFields(value as Document) } };
  throw new ApiError(422, 'Некоректне значення JSON.');
}
export function encodeFields(value: Document): Record<string, FirestoreValue> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)]));
}

export function createImportFirebase(fetcher: typeof fetch = fetch, now: () => Date = () => new Date()) {
  let cached: { project: string; secret: string; token: string; expires: number } | undefined;
  let signing: { project: string; secret: string; key: CryptoKey } | undefined;
  async function responseJson(url: string, init: RequestInit): Promise<any> {
    let response: Response;
    try { response = await fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(8000) }); }
    catch { throw new ApiError(503, 'Firebase тимчасово недоступний.'); }
    if (response.status === 404) return null;
    if (!response.ok) throw new ApiError(response.status === 409 ? 409 : 503, response.status === 409 ? 'Конфлікт одночасних змін. Повторіть імпорт.' : 'Firebase тимчасово недоступний або не налаштований.');
    const text = await boundedText(response, 256 * 1024);
    return text ? JSON.parse(text) : {};
  }
  async function token(project: string, secret: string): Promise<string> {
    if (cached?.project === project && cached.secret === secret && cached.expires > now().getTime() + 60_000) return cached.token;
    let account: { project_id: string; client_email: string; private_key: string };
    try {
      account = JSON.parse(secret);
      if (!/^[a-z][a-z0-9-]{4,62}$/.test(project) || account.project_id !== project ||
        !account.client_email.endsWith('@' + project + '.iam.gserviceaccount.com')) throw new Error();
      let key = signing?.project === project && signing.secret === secret ? signing.key : undefined;
      if (!key) {
        const binary = atob(account.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        key = await crypto.subtle.importKey('pkcs8', bytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
        // Retain one resolved key for token refresh; each request owns its OAuth fetch.
        signing = { project, secret, key };
      }
      const seconds = Math.floor(now().getTime() / 1000);
      const header = base64(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
      const claims = base64(new TextEncoder().encode(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: seconds, exp: seconds + 3600 })));
      const input = header + '.' + claims;
      const assertion = input + '.' + base64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input))));
      const result = await responseJson('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() });
      if (typeof result?.access_token !== 'string' || !Number.isFinite(result.expires_in)) throw new Error();
      cached = { project, secret, token: result.access_token, expires: now().getTime() + Math.min(result.expires_in, 3600) * 1000 };
      return cached.token;
    } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(503, 'Сервісний акаунт імпорту не налаштований.'); }
  }
  async function client(project: string, secret: string) {
    const accessToken = await token(project, secret);
    const root = 'https://firestore.googleapis.com/v1/projects/' + project + '/databases/(default)/documents';
    const headers = { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' };
    const call = (suffix: string, body?: unknown) => responseJson(root + suffix, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const name = (path: string) => root.slice('https://firestore.googleapis.com/v1/'.length) + '/' + path;
    async function readMany(paths: string[], transaction?: string, fieldPaths?: string[]): Promise<(Document | null)[]> {
      const documents = paths.map(name);
      const rows = await call(':batchGet', { documents, ...(transaction ? { transaction } : {}), ...(fieldPaths ? { mask: { fieldPaths } } : {}) });
      const found = new Map<string, Document | null>();
      if (!Array.isArray(rows)) throw new ApiError(503, 'Некоректна відповідь сервісу доступу.');
      for (const row of rows) {
        const documentName = row?.found?.name ?? row?.missing;
        if (typeof documentName !== 'string' || !documents.includes(documentName) || found.has(documentName) ||
          (row.found && row.missing)) throw new ApiError(503, 'Некоректна відповідь сервісу доступу.');
        found.set(documentName, row.found ? decodeFields(row.found.fields || {}) : null);
      }
      if (found.size !== documents.length) throw new ApiError(503, 'Некоректна відповідь сервісу доступу.');
      // Firestore returns found and missing documents in an unspecified order.
      return documents.map(documentName => found.get(documentName)!);
    }
    async function read(path: string, transaction?: string): Promise<Document | null> {
      if (transaction) {
        return (await readMany([path], transaction))[0];
      }
      const result = await call('/' + path.split('/').map(encodeURIComponent).join('/'));
      return result ? decodeFields(result.fields || {}) : null;
    }
    async function authUser(uid: string) {
      const result = await responseJson('https://identitytoolkit.googleapis.com/v1/projects/' + project + '/accounts:lookup?fields=users(localId,emailVerified,disabled,validSince)', { method: 'POST', headers, body: JSON.stringify({ localId: [uid] }) });
      const user = result?.users?.find((item: any) => item.localId === uid);
      if (!user || user.disabled || user.emailVerified !== true) throw new ApiError(403, 'Акаунт видалений, заблокований або пошта не підтверджена.');
      const validSince = Number(user.validSince || 0);
      if (!Number.isSafeInteger(validSince) || validSince < 0) throw new ApiError(503, 'Некоректний стан акаунта.');
      return validSince;
    }
    async function scope(uid: string, validSince: number, transaction?: string): Promise<ImportScope> {
      const [registry, access, member, deletion] = await readMany([
        'system/authorization', 'accountAccess/' + uid, 'memberships/' + uid, 'accountDeletion/' + uid,
      ], transaction, ['adminUids', 'version', 'blocked', 'changeId', 'active', 'companyId']);
      if (!registry || access?.blocked === true || deletion) throw new ApiError(403, 'API доступне лише активним адміністраторам і менеджерам.');
      const admin = Array.isArray(registry.adminUids) && registry.adminUids.includes(uid);
      const companyId = !admin && member?.active === true && typeof member.companyId === 'string' ? member.companyId : null;
      if (!admin && (!companyId || (await readMany(['companies/' + companyId], transaction, ['status']))[0]?.status !== 'active')) throw new ApiError(403, 'Немає доступу до активної компанії.');
      const role = admin ? 'admin' : 'manager';
      return { uid, role, companyId, validSince, registryVersion: Number(registry.version),
        fingerprint: await digest(JSON.stringify([role, companyId, access?.changeId ?? null, member?.changeId ?? null, member?.version ?? null, validSince])) };
    }
    return { call, name, read, authUser, scope, headers, root };
  }
  return {
    async scope(project: string, secret: string, uid: string) {
      const c = await client(project, secret);
      return c.scope(uid, await c.authUser(uid));
    },
    async deleteReceipt(project: string, secret: string, jobId: string) {
      const c = await client(project, secret);
      await responseJson(c.root + '/importReceipts/' + jobId, { method: 'DELETE', headers: c.headers });
    },
    async receipt(project: string, secret: string, jobId: string): Promise<ImportItemResult[] | null> {
      const c = await client(project, secret);
      const receipt = await c.read('importReceipts/' + jobId);
      return receipt ? receipt.results as ImportItemResult[] : null;
    },
    async process(project: string, secret: string, uid: string, fingerprint: string, jobId: string, payload: ImportPayload, cursor: number): Promise<ImportItemResult[]> {
      const c = await client(project, secret);
      const validSince = await c.authUser(uid);
      const { transaction } = await c.call(':beginTransaction', { options: { readWrite: {} } });
      try {
        const scope = await c.scope(uid, validSince, transaction);
        if (scope.fingerprint !== fingerprint) throw new ApiError(403, 'Права змінилися. Створіть новий ключ.');
        const receipt = await c.read('importReceipts/' + jobId, transaction);
        if (receipt && Number(receipt.cursor) > cursor) return receipt.results as ImportItemResult[];
        if (receipt && Number(receipt.cursor) !== cursor) throw new ApiError(409, 'Некоректний порядок черги.');
        const pending = new Map<string, Document>();
        const reads = new Map<string, Document | null>();
        const read = async (path: string) => {
          if (pending.has(path)) return pending.get(path)!;
          if (!reads.has(path)) reads.set(path, await c.read(path, transaction));
          return reads.get(path)!;
        };
        const stamp = now();
        const changeId = crypto.randomUUID();
        async function companyByDomain(domain: string): Promise<Document | null> {
          const created = [...pending.entries()].filter(([path]) => path.startsWith('companies/')).map(([, company]) => company).filter(company => (company.allowedDomains as string[]).includes(domain));
          const rows = await c.call(':runQuery', { transaction, structuredQuery: { from: [{ collectionId: 'companies' }], where: { fieldFilter: { field: { fieldPath: 'allowedDomains' }, op: 'ARRAY_CONTAINS', value: { stringValue: domain } } }, limit: 2 } });
          const matches = new Map<string, Document>();
          for (const row of rows) if (row.document) { const company = decodeFields(row.document.fields); matches.set(company.id as string, company); }
          for (const company of created) matches.set(company.id as string, company);
          if (matches.size > 1) throw new ApiError(422, 'Домен належить кільком компаніям. Вкажіть companyId.');
          return [...matches.values()][0] || null;
        }
        async function resolveCompany(companyId: string | undefined, url: string): Promise<Document> {
          const domain = importDomain(url);
          if (scope.role === 'manager' && companyId && companyId !== scope.companyId) throw new ApiError(403, 'Дозволена лише власна компанія.');
          let company = companyId || scope.role === 'manager' ? await read('companies/' + (companyId || scope.companyId)) : await companyByDomain(domain);
          if (!company && scope.role === 'admin' && companyId) {
            company = await companyByDomain(domain);
          }
          if (!company && scope.role === 'admin') {
            const id = 'api_' + await digest(domain);
            company = await read('companies/' + id);
            if (!company) {
              company = { id, name: domain, website: 'https://' + domain + '/', allowedDomains: [domain], status: 'active', version: 1, createdBy: uid, createdAt: stamp, updatedAt: stamp, updatedBy: uid, changeId };
              pending.set('companies/' + id, company);
            }
          }
          if (!company) throw new ApiError(403, 'Компанію не знайдено.');
          return company;
        }
        const results: ImportItemResult[] = [...(receipt?.results as ImportItemResult[] || [])];
        const total = payload.companies.length + payload.offers.length;
        for (let index = cursor; index < Math.min(total, cursor + IMPORT_LIMITS.batchItems); index++) {
          const isCompany = index < payload.companies.length;
          const result: ImportItemResult = { index, kind: isCompany ? 'company' : 'offer', success: false };
          const before = new Map(pending);
          try {
            if (isCompany) {
              if (scope.role !== 'admin') throw new ApiError(403, 'Компанії імпортує лише адміністратор.');
              const item = payload.companies[index];
              const company = await resolveCompany(item.companyId, item.website);
              const input = validateCompany({ name: item.name ?? company.name as string, website: item.website,
                allowedDomains: item.allowedDomains ?? company.allowedDomains as string[], status: item.status ?? company.status as Company['status'] });
              if (!input.allowedDomains.includes(importDomain(input.website))) throw new ApiError(422, 'Домен website має бути серед allowedDomains.');
              pending.set('companies/' + company.id, { ...company, ...input, createdAt: new Date(company.createdAt as string | Date),
                version: Number(company.version) + 1, updatedAt: stamp, updatedBy: uid, changeId });
              result.companyId = company.id as string;
            } else {
              const item = payload.offers[index - payload.companies.length];
              result.externalId = item.externalId;
              const company = await resolveCompany(item.companyId, item.offer.productUrl);
              result.companyId = company.id as string;
              const id = await importedOfferId(company.id as string, item.externalId);
              if (results.some(previous => previous.success && previous.offerId === id)) throw new ApiError(422, 'Повторний externalId у межах цієї компанії.');
              const current = await read('companyOffers/' + id);
              const profileDoc = await read('temperatureProfiles/' + item.offer.type);
              const profile = profileDoc?.deleted === true ? undefined : profileForImport(item.offer.type, profileDoc as unknown as TemperatureProfile);
              const family = item.familyExplicit ? item.offer.family :
                profile?.family ?? (profileDoc?.deleted !== true ? profileForImport(item.offer.type)?.family : undefined);
              if (!family) throw new ApiError(422, 'Для цього типу немає профілю. Вкажіть family або додайте профіль у каталозі.');
              const preserved = current ? Object.fromEntries(['description', 'packagingType', 'diameterMm', 'colorTone']
                .filter(key => !item.optionalFields.includes(key)).map(key => [key, current[key]])) : {};
              const input = validateCompanyOfferInput({ ...item.offer, ...preserved, family }, company.allowedDomains as string[]);
              // Every import needs manual publication; API updates cannot lift administrator moderation.
              input.status = current?.status === 'blocked' || input.status === 'blocked' ? 'blocked' : 'hidden';
              assertCompanyOfferWrite({ role: scope.role, companyId: scope.companyId, blocked: false }, company as unknown as Company,
                current as unknown as CompanyOffer | null, current ? Number(current.version) : undefined, input.status);
              pending.set('companyOffers/' + id, { ...input, id, companyId: company.id, version: current ? Number(current.version) + 1 : 1,
                createdAt: current ? new Date(current.createdAt as string) : stamp, createdBy: current?.createdBy ?? uid, updatedAt: stamp, updatedBy: uid });
              result.offerId = id;
            }
            result.success = true;
          } catch (error) {
            if (error instanceof ApiError && (error.status >= 500 || error.status === 409)) throw error;
            pending.clear();
            for (const [path, value] of before) pending.set(path, value);
            result.message = error instanceof Error ? error.message.slice(0, 240) : 'Некоректний запис.';
          }
          results.push(result);
        }
        for (const [path, company] of pending) if (path.startsWith('companies/')) {
          pending.set('accessAudit/' + crypto.randomUUID(), { actorUid: uid, targetUid: '', action: 'company', role: 'user', companyId: company.id, blocked: false, createdAt: stamp, registryVersion: scope.registryVersion });
        }
        pending.set('importReceipts/' + jobId, { cursor: Math.min(total, cursor + IMPORT_LIMITS.batchItems), results, createdAt: stamp });
        await c.call(':commit', { transaction, writes: [...pending.entries()].map(([path, document]) => ({ update: { name: c.name(path), fields: encodeFields(document) } })) });
        return results;
      } finally { try { await c.call(':rollback', { transaction }); } catch { /* Commit already closed the transaction. */ } }
    },
  };
}
