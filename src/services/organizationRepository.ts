import {
  collection, doc, getDocFromServer, getDocsFromServer, limit, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp, startAfter, type QueryDocumentSnapshot, type QuerySnapshot, type DocumentData,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { firebaseAuth, firestoreDb } from './firebaseClient.ts';
import { BOOTSTRAP_EMAIL, deriveAccess, nextAdminUids, validateCompany,
  type AccessAudit, type AccessState, type Company, type DirectoryUser, type Role } from '../domain/organizations.ts';

function database() {
  if (!firestoreDb) throw new Error('Firebase не налаштовано.');
  return firestoreDb;
}
function currentUser() {
  const user = firebaseAuth?.currentUser;
  if (!user || localStorage.getItem('printcost_is_demo_mode') === 'true') throw new Error('Увійдіть у справжній акаунт.');
  return user;
}
function sameUser(uid: string) {
  if (currentUser().uid !== uid) throw new Error('Акаунт змінився під час операції. Повторіть дію.');
}
function validId(id: string) {
  if (!id || id.length > 180 || id.includes('/') || ['.', '..'].includes(id)) throw new Error('Некоректний ідентифікатор.');
  return id;
}
const registryRef = () => doc(database(), 'system/authorization');

export const organizationRepository = {
  async getAccess(uid: string): Promise<AccessState> {
    validId(uid);
    const user = currentUser();
    const [registry, access, membership] = await Promise.all([
      getDocFromServer(registryRef()), getDocFromServer(doc(database(), 'accountAccess', uid)),
      getDocFromServer(doc(database(), 'memberships', uid)),
    ]);
    const member = membership.data() as { active: boolean; companyId: string | null } | undefined;
    const company = member?.active && member.companyId ? await this.getCompany(member.companyId) : null;
    sameUser(user.uid);
    return deriveAccess(uid, uid === user.uid ? user.emailVerified : true, registry.data()?.adminUids || [],
      access.data()?.blocked === true, member, company?.status === 'active');
  },

  async ensureIdentity(user: User): Promise<void> {
    sameUser(user.uid);
    const access = await this.getAccess(user.uid);
    if (access.blocked) return;
    const ref = doc(database(), 'userDirectory', user.uid);
    const directory = await getDocFromServer(ref);
    const data = { uid: user.uid, email: user.email || '', displayName: user.displayName || '', verified: user.emailVerified };
    if (!directory.exists() || Object.entries(data).some(([key, value]) => directory.data()?.[key] !== value)) {
      await runTransaction(database(), async transaction => {
        await transaction.get(ref);
        sameUser(user.uid);
        transaction.set(ref, { ...data, updatedAt: serverTimestamp() });
      });
    }
    if (!user.emailVerified || user.email !== BOOTSTRAP_EMAIL) return;
    const changeId = crypto.randomUUID();
    await runTransaction(database(), async transaction => {
      const registry = await transaction.get(registryRef());
      sameUser(user.uid);
      if (registry.exists()) return;
      const timestamp = serverTimestamp();
      transaction.set(registryRef(), { adminUids: [user.uid], bootstrapUid: user.uid, initializedAt: timestamp, version: 1, lastChangeId: changeId });
      transaction.set(doc(database(), 'accountAccess', user.uid), { blocked: false, updatedAt: timestamp, updatedBy: user.uid, changeId });
      transaction.set(doc(database(), 'memberships', user.uid), { companyId: null, active: false, version: 1, updatedAt: timestamp, updatedBy: user.uid, changeId });
      transaction.set(doc(database(), 'accessAudit', changeId), { actorUid: user.uid, targetUid: user.uid, action: 'bootstrap', role: 'admin', companyId: null, blocked: false, createdAt: timestamp, registryVersion: 1 });
    });
    sameUser(user.uid);
  },

  observeAccess(uid: string, onChange: (access: AccessState) => void, onError: (error: unknown) => void) {
    let adminUids: string[] = [];
    let blocked = false;
    let member: { active: boolean; companyId: string | null } | undefined;
    const loaded = new Set<string>();
    let companyActive = false;
    let companyPending = false;
    let companyRevision = 0;
    let companyStop: (() => void) | undefined;
    const publish = () => {
      if (loaded.size === 3 && !companyPending) onChange(deriveAccess(uid, firebaseAuth?.currentUser?.uid === uid && firebaseAuth.currentUser.emailVerified,
        adminUids, blocked, member, companyActive));
    };
    const stops = [
      onSnapshot(registryRef(), snapshot => { adminUids = snapshot.data()?.adminUids || []; loaded.add('registry'); publish(); }, onError),
      onSnapshot(doc(database(), 'accountAccess', uid), snapshot => { blocked = snapshot.data()?.blocked === true; loaded.add('access'); publish(); }, onError),
      onSnapshot(doc(database(), 'memberships', uid), snapshot => {
      companyStop?.();
      const revision = ++companyRevision;
      member = snapshot.data() as typeof member;
      loaded.add('membership'); companyActive = false;
      companyPending = Boolean(member?.active && member.companyId);
      if (member?.active && member.companyId) companyStop = onSnapshot(doc(database(), 'companies', member.companyId), company => {
        if (revision !== companyRevision) return;
        companyActive = company.data()?.status === 'active'; companyPending = false; publish();
      }, onError);
      publish();
    }, onError),
    ];
    return () => { stops.forEach(stop => stop()); companyStop?.(); };
  },

  async listUsers(cursor?: QueryDocumentSnapshot): Promise<{ items: DirectoryUser[]; cursor: QueryDocumentSnapshot | null }> {
    const result = await getDocsFromServer(query(collection(database(), 'userDirectory'), orderBy('email'), limit(100), ...(cursor ? [startAfter(cursor)] : [])));
    return { items: result.docs.map(snapshot => snapshot.data() as DirectoryUser), cursor: result.size === 100 ? result.docs.at(-1)! : null };
  },
  async getCompany(id: string): Promise<Company | null> {
    const snapshot = await getDocFromServer(doc(database(), 'companies', validId(id)));
    return snapshot.exists() ? snapshot.data() as Company : null;
  },
  async listCompanies(): Promise<Company[]> {
    const items: Company[] = [];
    let cursor: QueryDocumentSnapshot | null = null;
    for (;;) {
      const result: QuerySnapshot<DocumentData> = await getDocsFromServer(query(collection(database(), 'companies'), orderBy('name'), limit(200), ...(cursor ? [startAfter(cursor)] : [])));
      items.push(...result.docs.map(snapshot => snapshot.data() as Company));
      if (result.size < 200) return items;
      cursor = result.docs.at(-1)!;
    }
  },
  async saveCompany(input: { id?: string; name: string; website: string; allowedDomains: string[]; status: 'active' | 'disabled'; version?: number }): Promise<Company> {
    const actor = currentUser();
    const fields = validateCompany(input);
    const id = input.id ? validId(input.id) : crypto.randomUUID();
    const ref = doc(database(), 'companies', id);
    const changeId = crypto.randomUUID();
    await runTransaction(database(), async transaction => {
      const registry = await transaction.get(registryRef());
      const old = await transaction.get(ref);
      sameUser(actor.uid);
      if (!registry.data()?.adminUids.includes(actor.uid) || !actor.emailVerified) throw new Error('Потрібні права адміністратора.');
      if (old.exists() && old.data().version !== input.version) throw new Error('Компанію вже змінили. Оновіть сторінку й повторіть дію.');
      const timestamp = serverTimestamp();
      transaction.set(ref, { ...fields, id, createdAt: old.data()?.createdAt || timestamp, createdBy: old.data()?.createdBy || actor.uid,
        version: (old.data()?.version || 0) + 1, updatedAt: timestamp, updatedBy: actor.uid, changeId });
      transaction.set(doc(database(), 'accessAudit', changeId), { actorUid: actor.uid, targetUid: '', action: 'company', role: 'user', companyId: id, blocked: false, createdAt: timestamp, registryVersion: registry.data()!.version });
    });
    sameUser(actor.uid);
    return (await this.getCompany(id))!;
  },

  async changeAccess(uid: string, role: Role, companyId: string | null, blocked: boolean, action: 'role' | 'block'): Promise<void> {
    validId(uid);
    if (!['user', 'manager', 'admin'].includes(role)) throw new Error('Некоректна роль.');
    const actor = currentUser();
    const changeId = crypto.randomUUID();
    if (role === 'manager' && !companyId) throw new Error('Виберіть компанію менеджера.');
    if (companyId) validId(companyId);
    await runTransaction(database(), async transaction => {
      const registry = await transaction.get(registryRef());
      const directory = await transaction.get(doc(database(), 'userDirectory', uid));
      const member = await transaction.get(doc(database(), 'memberships', uid));
      const access = await transaction.get(doc(database(), 'accountAccess', uid));
      const company = role === 'manager' ? await transaction.get(doc(database(), 'companies', companyId!)) : null;
      sameUser(actor.uid);
      if (!actor.emailVerified || !registry.data()?.adminUids.includes(actor.uid)) throw new Error('Потрібні права адміністратора.');
      if (!directory.exists()) throw new Error('Акаунт не знайдено. Користувач має спочатку зареєструватися.');
      if (action === 'role' && access.data()?.blocked) throw new Error('Спочатку розблокуйте акаунт окремою дією.');
      if (action === 'block' && (access.data()?.blocked === true) === blocked) return;
      if (role !== 'user' && (!directory.data().verified || access.data()?.blocked)) throw new Error('Спочатку підтвердіть пошту й розблокуйте акаунт.');
      if (company && (!company.exists() || company.data().status !== 'active')) throw new Error('Компанія відсутня або вимкнена.');
      const adminUids = nextAdminUids(registry.data()!.adminUids, uid, role, blocked);
      const version = registry.data()!.version + 1;
      const timestamp = serverTimestamp();
      transaction.update(registryRef(), { adminUids, version, lastChangeId: changeId });
      transaction.set(doc(database(), 'accountAccess', uid), { blocked, updatedAt: timestamp, updatedBy: actor.uid, changeId });
      transaction.set(doc(database(), 'memberships', uid), { companyId: role === 'manager' ? companyId : null,
        active: role === 'manager', version: (member.data()?.version || 0) + 1, updatedAt: timestamp, updatedBy: actor.uid, changeId });
      transaction.set(doc(database(), 'accessAudit', changeId), { actorUid: actor.uid, targetUid: uid, action, role,
        companyId: role === 'manager' ? companyId : null, blocked, createdAt: timestamp, registryVersion: version });
    });
    sameUser(actor.uid);
  },
  async setRole(uid: string, role: Role, companyId?: string): Promise<void> {
    return this.changeAccess(uid, role, companyId || null, false, 'role');
  },
  async setBlocked(uid: string, blocked: boolean): Promise<void> {
    return this.changeAccess(uid, 'user', null, blocked, 'block');
  },
  async listAudit(): Promise<AccessAudit[]> {
    const result = await getDocsFromServer(query(collection(database(), 'accessAudit'), orderBy('createdAt', 'desc'), limit(100)));
    return result.docs.map(snapshot => snapshot.data() as AccessAudit);
  },
};
