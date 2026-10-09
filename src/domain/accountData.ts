export const ACCOUNT_PRIVATE_COLLECTIONS = ['materials', 'printers', 'calculations', 'templates', 'settings', 'likes'] as const;
export const ACCOUNT_PAGE_SIZE = 100;
export const ACCOUNT_DELETE_CONFIRMATION = 'ВИДАЛИТИ';

export interface AuthorizationRegistry {
  adminUids: string[];
  bootstrapUid: string;
  initializedAt: unknown;
  version: number;
  lastChangeId: string;
}

/** Preserve the registry's bootstrap identity and advance its CAS version, even for ordinary users. */
export function planAccountDeparture(uid: string, registry: AuthorizationRegistry | null, changeId: string): AuthorizationRegistry | null {
  if (!uid || uid.includes('/') || !changeId) throw new Error('Некоректний ідентифікатор акаунта.');
  if (!registry) return null;
  if (!Number.isSafeInteger(registry.version) || registry.version < 1 || !Array.isArray(registry.adminUids) || !registry.adminUids.length) {
    throw new Error('Реєстр доступу потребує перевірки адміністратора. Видалення не розпочато.');
  }
  const adminUids = registry.adminUids.filter(id => id !== uid);
  if (!adminUids.length) throw new Error('Спершу призначте іншого адміністратора. Останній адміністратор не може видалити акаунт.');
  return { ...registry, adminUids, version: registry.version + 1, lastChangeId: changeId };
}

export interface AccountExportDocument { id: string; data: Record<string, unknown> }
export interface AccountExport {
  format: 'kilog-account-export';
  schemaVersion: 1;
  uid: string;
  email: string;
  exportedAt: string;
  deletionPending: boolean;
  profile: Record<string, unknown> | null;
  privateData: Record<typeof ACCOUNT_PRIVATE_COLLECTIONS[number], AccountExportDocument[]>;
  access: {
    directory: Record<string, unknown> | null;
    accountAccess: Record<string, unknown> | null;
    membership: Record<string, unknown> | null;
    deletion: Record<string, unknown> | null;
    authorization: { isAdmin: boolean; registryVersion: number };
  };
}

export type AccountDeletionProgress = { stage: 'reauthenticate' | 'revoke' | 'cleanup' | 'identity' | 'auth'; deletedDocuments: number };
