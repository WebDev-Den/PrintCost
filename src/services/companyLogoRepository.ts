import type { Auth, User } from 'firebase/auth';
import { doc, getDocFromServer, runTransaction, serverTimestamp, Timestamp, type DocumentData, type Firestore } from 'firebase/firestore';
import { validateCompanyLogoImage, type CompanyLogo } from '../domain/companyLogos.ts';
import { deriveAccess } from '../domain/organizations.ts';
import { firebaseAuth, firestoreDb } from './firebaseClient.ts';
import { authService } from './authService.ts';

function validId(id: string) {
  if (typeof id !== 'string' || !id || id.length > 128 || id.includes('/') || ['.', '..'].includes(id)) throw new Error('Некоректний ідентифікатор компанії.');
  return id;
}
function decodeLogo(companyId: string, data: DocumentData): CompanyLogo {
  if (data.companyId !== companyId || !Number.isSafeInteger(data.version) || data.version < 1 ||
      !(data.createdAt instanceof Timestamp) || !(data.updatedAt instanceof Timestamp)) throw new Error('Некоректний запис логотипа компанії.');
  return { companyId, imageDataUrl: validateCompanyLogoImage(data.imageDataUrl), version: data.version,
    createdBy: validId(data.createdBy), createdAt: data.createdAt, updatedBy: validId(data.updatedBy), updatedAt: data.updatedAt };
}

export class CompanyLogoRepository {
  constructor(private auth: Auth | null, private database: Firestore | null, private isDemo: () => boolean = () => false) {}

  private sameUser(user: User | null) {
    if (this.isDemo() || (this.auth?.currentUser ?? null) !== user) throw new Error('Акаунт змінився під час операції. Повторіть дію.');
  }

  async get(companyId: string): Promise<CompanyLogo | null> {
    validId(companyId);
    if (this.isDemo() || !this.database) return null;
    const user = this.auth?.currentUser ?? null;
    const snapshot = await getDocFromServer(doc(this.database, 'companyLogos', companyId));
    this.sameUser(user);
    return snapshot.exists() ? decodeLogo(companyId, snapshot.data()) : null;
  }

  async save(companyId: string, imageDataUrl: string | null, expectedVersion: number): Promise<CompanyLogo> {
    validId(companyId);
    validateCompanyLogoImage(imageDataUrl);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error('Некоректна версія логотипа.');
    const user = this.auth?.currentUser;
    if (this.isDemo() || !user?.emailVerified) throw new Error('Увійдіть у справжній акаунт із підтвердженою поштою.');
    if (!this.database) throw new Error('Firebase не налаштовано.');
    const ref = doc(this.database, 'companyLogos', companyId);
    try { await runTransaction(this.database, async transaction => {
      this.sameUser(user);
      const [company, registry, access, membership, deletion, old] = await Promise.all([
        transaction.get(doc(this.database!, 'companies', companyId)), transaction.get(doc(this.database!, 'system/authorization')),
        transaction.get(doc(this.database!, 'accountAccess', user.uid)), transaction.get(doc(this.database!, 'memberships', user.uid)),
        transaction.get(doc(this.database!, 'accountDeletion', user.uid)), transaction.get(ref),
      ]);
      this.sameUser(user);
      if (!company.exists()) throw new Error('Компанію не знайдено.');
      const scope = deriveAccess(user.uid, user.emailVerified, registry.data()?.adminUids || [], access.data()?.blocked === true,
        membership.data() as { active: boolean; companyId: string | null } | undefined, company.data().status === 'active');
      if (deletion.exists() || !(scope.role === 'admin' || (scope.role === 'manager' && scope.companyId === companyId))) throw new Error('Немає права змінювати логотип цієї компанії.');
      const current = old.exists() ? decodeLogo(companyId, old.data()) : null;
      if ((current?.version ?? 0) !== expectedVersion || expectedVersion === Number.MAX_SAFE_INTEGER) throw new Error('Логотип змінився. Оновіть збережений логотип перед редагуванням.');
      const timestamp = serverTimestamp();
      transaction.set(ref, { companyId, imageDataUrl, version: expectedVersion + 1, createdBy: current?.createdBy ?? user.uid,
        createdAt: current?.createdAt ?? timestamp, updatedBy: user.uid, updatedAt: timestamp });
    }); } catch (error) {
      this.sameUser(user);
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (['permission-denied', 'aborted'].includes(code)) {
        // Rules can reject a stale CAS before the SDK receives a transaction retry.
        let latest: CompanyLogo | null = null;
        try { latest = await this.get(companyId); } catch { /* Preserve the original write failure. */ }
        this.sameUser(user);
        if (latest && latest.version > expectedVersion) throw new Error('Логотип змінився. Оновіть збережений логотип перед редагуванням.');
      }
      throw error;
    }
    this.sameUser(user);
    const snapshot = await getDocFromServer(ref);
    this.sameUser(user);
    if (!snapshot.exists()) throw new Error('Збережений логотип не знайдено. Оновіть сторінку.');
    return decodeLogo(companyId, snapshot.data());
  }
}

export const companyLogoRepository = new CompanyLogoRepository(firebaseAuth, firestoreDb, () => authService.isDemoSession());
