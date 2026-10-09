import { IMPORT_LIMITS, type ApiKeyMetadata, type ImportJobSummary } from '../domain/apiImports.ts';

export interface ApiKeyResponse { key: ApiKeyMetadata | null; role: 'admin' | 'manager'; companyId: string | null; nextImportAt: string | null; limits: typeof IMPORT_LIMITS }
export function createApiImportClient(token: () => Promise<string>, assertSession: () => void, fetcher: typeof fetch = fetch) {
  async function request<T>(path: string, method = 'GET', payload?: unknown, idempotency?: string): Promise<T> {
    assertSession();
    const bearer = await token();
    assertSession();
    const response = await fetcher('/api/v1/' + path, { method, credentials: 'same-origin', redirect: 'error',
      headers: { Authorization: 'Bearer ' + bearer, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }), ...(idempotency ? { 'Idempotency-Key': idempotency } : {}) },
      body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(30_000) });
    assertSession();
    if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('API імпорту ще не активовано.');
    const value = await response.json();
    assertSession();
    if (!response.ok) {
      const retry = Number(response.headers.get('Retry-After'));
      throw new Error((value.error?.message || 'Запит API не виконано.') + (response.status === 429 && retry > 0 ? ' Повторіть через ' + Math.ceil(retry / 60) + ' хв.' : ''));
    }
    return value as T;
  }
  return {
    metadata: () => request<ApiKeyResponse>('api-key'),
    rotate: () => request<{ key: string; metadata: ApiKeyMetadata }>('api-key', 'POST'),
    revoke: () => request<{ revoked: boolean }>('api-key', 'DELETE'),
    jobs: () => request<{ jobs: ImportJobSummary[] }>('imports'),
    job: (id: string) => request<ImportJobSummary & { error?: string }>('imports/' + encodeURIComponent(id)),
    submit: (payload: unknown, idempotency: string) => request<ImportJobSummary & { statusUrl: string }>('imports', 'POST', payload, idempotency),
  };
}
