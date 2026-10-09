import { deleteUser, getIdToken, type Auth, type User } from 'firebase/auth';
import {
  collection, doc, documentId, getDocFromServer, getDocsFromServer, limit, orderBy, query,
  runTransaction, serverTimestamp, startAfter, Timestamp, writeBatch, type Firestore,
} from 'firebase/firestore';
import {
  ACCOUNT_DELETE_CONFIRMATION, ACCOUNT_PAGE_SIZE, ACCOUNT_PRIVATE_COLLECTIONS, planAccountDeparture,
  type AccountDeletionProgress, type AccountExport, type AuthorizationRegistry,
} from '../domain/accountData.ts';
import { authService, reauthenticateAccount } from './authService.ts';
import { firebaseAuth, firestoreDb } from './firebaseClient.ts';

type ProgressListener = (progress: AccountDeletionProgress) => void;

/** Web SDK only: one authenticated owner's data, without privileged credentials. */
export class AccountDataService {
  constructor(private auth: Auth, private database: Firestore, private isDemo: () => boolean = () => false) {}

  private user(uid: string): User {
    const user = this.auth.currentUser;
    if (this.isDemo() || !user?.email || user.uid !== uid) throw new Error('Увійдіть у власний справжній акаунт.');
    return user;
  }

  private sameUser(user: User) {
    if (this.isDemo() || this.auth.currentUser !== user || this.auth.currentUser?.uid !== user.uid) {
      throw new Error('Акаунт змінився під час операції. Повторіть дію.');
    }
  }

  async exportOwnData(uid: string): Promise<AccountExport> {
    const user = this.user(uid);
    const refs = [doc(this.database, 'users', uid), doc(this.database, 'userDirectory', uid),
      doc(this.database, 'accountAccess', uid), doc(this.database, 'memberships', uid),
      doc(this.database, 'accountDeletion', uid), doc(this.database, 'system/authorization')];
    const snapshots = await Promise.all(refs.map(ref => getDocFromServer(ref)));
    this.sameUser(user);
    const [profile, directory, access, membership, deletion, registry] = snapshots;
    const privateData = {} as AccountExport['privateData'];
    for (const name of ACCOUNT_PRIVATE_COLLECTIONS) {
      const items: AccountExport['privateData'][typeof name] = [];
      let cursor: string | undefined;
      while (true) {
        this.sameUser(user);
        const constraints = [orderBy(documentId()), limit(ACCOUNT_PAGE_SIZE), ...(cursor ? [startAfter(cursor)] : [])];
        const page = await getDocsFromServer(query(collection(this.database, 'users', uid, name), ...constraints));
        this.sameUser(user);
        items.push(...page.docs.map(snapshot => ({ id: snapshot.id, data: snapshot.data() })));
        if (page.size < ACCOUNT_PAGE_SIZE) break;
        cursor = page.docs.at(-1)!.id;
      }
      privateData[name] = items;
    }
    this.sameUser(user);
    return {
      format: 'kilog-account-export', schemaVersion: 1, uid, email: user.email!, exportedAt: new Date().toISOString(),
      deletionPending: deletion.exists(), profile: profile.data() || null, privateData,
      access: { directory: directory.data() || null, accountAccess: access.data() || null, membership: membership.data() || null,
        deletion: deletion.data() || null, authorization: {
          isAdmin: (registry.data()?.adminUids || []).includes(uid), registryVersion: registry.data()?.version || 0,
        } },
    };
  }

  private async revokeAccess(user: User) {
    const uid = user.uid;
    const markerRef = doc(this.database, 'accountDeletion', uid);
    const registryRef = doc(this.database, 'system/authorization');
    const memberRef = doc(this.database, 'memberships', uid);
    const accessRef = doc(this.database, 'accountAccess', uid);
    for (let attempt = 0; attempt < 3; attempt++) {
      const changeId = crypto.randomUUID();
      let readVersion: number | null = null;
      try {
        await runTransaction(this.database, async transaction => {
          this.sameUser(user);
          const [marker, registry, membership, access] = await Promise.all([
            transaction.get(markerRef), transaction.get(registryRef), transaction.get(memberRef), transaction.get(accessRef),
          ]);
          this.sameUser(user);
          readVersion = registry.data()?.version || 0;
          if (marker.exists()) {
            if (marker.data().uid !== uid || access.data()?.blocked !== true || membership.data()?.active !== false
                || membership.data()?.companyId !== null || (registry.data()?.adminUids || []).includes(uid)) {
              throw new Error('Стан видалення потребує перевірки адміністратора. Очищення не продовжено.');
            }
            return;
          }
          const nextRegistry = planAccountDeparture(uid, registry.exists() ? registry.data() as AuthorizationRegistry : null, changeId);
          const timestamp = serverTimestamp();
          if (nextRegistry) transaction.update(registryRef, { adminUids: nextRegistry.adminUids, version: nextRegistry.version, lastChangeId: changeId });
          transaction.set(markerRef, { uid, startedAt: timestamp, changeId });
          transaction.set(accessRef, { blocked: true, updatedAt: timestamp, updatedBy: uid, changeId });
          transaction.set(memberRef, { companyId: null, active: false, version: (membership.data()?.version || 0) + 1, updatedAt: timestamp, updatedBy: uid, changeId });
          transaction.set(doc(this.database, 'accessAudit', changeId), {
            actorUid: uid, targetUid: uid, action: 'delete', role: 'user', companyId: null, blocked: true,
            createdAt: timestamp, registryVersion: nextRegistry?.version || 0,
          });
        });
        this.sameUser(user);
        return;
      } catch (error) {
        this.sameUser(user);
        const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
        if (attempt === 2 || readVersion === null || !['permission-denied', 'aborted'].includes(String(code))) throw error;
        const [latestRegistry, latestMarker] = await Promise.all([getDocFromServer(registryRef), getDocFromServer(markerRef)]);
        this.sameUser(user);
        // Rules may reject a stale CAS before the SDK receives an ABORTED response.
        // Retry only a proven concurrent registry/marker change, never a stable permission failure.
        if (!latestMarker.exists() && (latestRegistry.data()?.version || 0) <= readVersion) throw error;
      }
    }
  }

  async deleteOwnAccount(uid: string, password: string, confirmation: string, onProgress?: ProgressListener): Promise<void> {
    const user = this.user(uid);
    if (confirmation !== ACCOUNT_DELETE_CONFIRMATION) throw new Error(`Для підтвердження введіть «${ACCOUNT_DELETE_CONFIRMATION}».`);
    let deletedDocuments = 0;
    const progress = (stage: AccountDeletionProgress['stage']) => {
      this.sameUser(user);
      onProgress?.({ stage, deletedDocuments });
      this.sameUser(user);
    };
    progress('reauthenticate');
    await reauthenticateAccount(user, password);
    this.sameUser(user);
    await getIdToken(user, true);
    this.sameUser(user);
    progress('revoke');
    await this.revokeAccess(user);
    progress('cleanup');
    for (const name of ACCOUNT_PRIVATE_COLLECTIONS) {
      while (true) {
        this.sameUser(user);
        // Always read the first page: successful deletes make retries naturally idempotent.
        const page = await getDocsFromServer(query(collection(this.database, 'users', uid, name), orderBy(documentId()), limit(ACCOUNT_PAGE_SIZE)));
        this.sameUser(user);
        if (page.empty) break;
        const batch = writeBatch(this.database);
        page.docs.forEach(snapshot => batch.delete(snapshot.ref));
        this.sameUser(user);
        await batch.commit();
        this.sameUser(user);
        deletedDocuments += page.size;
        progress('cleanup');
      }
    }
    progress('identity');
    const identityBatch = writeBatch(this.database);
    identityBatch.delete(doc(this.database, 'users', uid));
    identityBatch.delete(doc(this.database, 'userDirectory', uid));
    this.sameUser(user);
    await identityBatch.commit();
    this.sameUser(user);
    // Confirm server state before touching Auth; never finish using optimistic local data.
    const privatePages = await Promise.all(ACCOUNT_PRIVATE_COLLECTIONS.map(name =>
      getDocsFromServer(query(collection(this.database, 'users', uid, name), limit(1)))));
    this.sameUser(user);
    const [profile, directory, marker, access, membership, registry] = await Promise.all([
      getDocFromServer(doc(this.database, 'users', uid)), getDocFromServer(doc(this.database, 'userDirectory', uid)),
      getDocFromServer(doc(this.database, 'accountDeletion', uid)), getDocFromServer(doc(this.database, 'accountAccess', uid)),
      getDocFromServer(doc(this.database, 'memberships', uid)), getDocFromServer(doc(this.database, 'system/authorization')),
    ]);
    this.sameUser(user);
    if (privatePages.some(page => !page.empty) || profile.exists() || directory.exists() || !marker.exists()
        || marker.data()?.uid !== uid || access.data()?.blocked !== true || membership.data()?.active !== false
        || membership.data()?.companyId !== null || (registry.data()?.adminUids || []).includes(uid)) {
      throw new Error('Очищення ще не завершене. Підтвердьте пароль і продовжте видалення.');
    }
    progress('auth');
    this.sameUser(user);
    await deleteUser(user);
    if (this.auth.currentUser && this.auth.currentUser !== user) throw new Error('Акаунт змінився під час завершення операції.');
  }
}

function configuredService() {
  if (!firebaseAuth || !firestoreDb) throw new Error('Firebase ще не налаштовано.');
  return new AccountDataService(firebaseAuth, firestoreDb, () => authService.isDemoSession());
}

export const accountDataService = {
  exportOwnData: (uid: string) => configuredService().exportOwnData(uid),
  deleteOwnAccount: (uid: string, password: string, confirmation: string, onProgress?: ProgressListener) =>
    configuredService().deleteOwnAccount(uid, password, confirmation, onProgress),
};

export function accountExportJson(data: AccountExport): string {
  // Encode Firebase timestamps without losing nanoseconds; all other raw fields remain unchanged.
  return JSON.stringify(data, function (key, value) {
    const original = key ? this[key] : value;
    return original instanceof Timestamp ? { type: 'timestamp', seconds: original.seconds, nanoseconds: original.nanoseconds } : value;
  }, 2);
}

export function downloadAccountExport(data: AccountExport) {
  const url = URL.createObjectURL(new Blob([accountExportJson(data)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `kilog-account-${data.uid}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
