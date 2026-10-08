import {
  collection, doc, getDocFromServer, getDocsFromServer, limit, orderBy, query, runTransaction,
  serverTimestamp, startAfter, Timestamp, where, type DocumentData, type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase/firestore';
import { firebaseAuth, firestoreDb } from './firebaseClient.ts';
import { authService } from './authService.ts';
import { deriveAccess, type Company } from '../domain/organizations.ts';
import {
  assertCompanyOfferWrite, isOfferProductUrlAllowed, normalizeCompanyOfferInput, OFFER_INPUT_FIELDS,
  validateCompanyOfferInput, type CompanyOffer, type CompanyOfferInput, type CompanyOfferStatus, type SaveCompanyOfferInput,
} from '../domain/companyOffers.ts';

export interface CompanyOfferPage<T = CompanyOffer> { items: T[]; nextCursor: QueryDocumentSnapshot | null }

function database() {
  if (!firestoreDb) throw new Error('Firebase не налаштовано.');
  return firestoreDb;
}
function assertPublicMode(wasDemo: boolean) {
  if (authService.isDemoSession() !== wasDemo) throw new Error('Режим каталогу змінився. Повторіть дію.');
}
function actor() {
  const user = firebaseAuth?.currentUser;
  if (authService.isDemoSession() || !user || !user.emailVerified) throw new Error('Увійдіть у справжній акаунт із підтвердженою поштою.');
  return user;
}
function validId(id: string) {
  if (typeof id !== 'string' || !id || id.length > 128 || id.includes('/') || ['.', '..'].includes(id)) throw new Error('Некоректний ідентифікатор.');
  return id;
}
function inputFields(data: CompanyOfferInput): CompanyOfferInput {
  return Object.fromEntries(OFFER_INPUT_FIELDS.map(field => [field, data[field]])) as unknown as CompanyOfferInput;
}
function decodeOffer(id: string, data: DocumentData): CompanyOffer {
  if (data.id !== id || !Number.isSafeInteger(data.version) || data.version < 1 ||
      !(data.createdAt instanceof Timestamp) || !(data.updatedAt instanceof Timestamp)) throw new Error('Некоректний запис пропозиції у базі.');
  return { ...normalizeCompanyOfferInput(inputFields(data as CompanyOfferInput)), id: validId(id), companyId: validId(data.companyId),
    createdBy: validId(data.createdBy), updatedBy: validId(data.updatedBy), version: data.version,
    createdAt: data.createdAt.toDate().toISOString(), updatedAt: data.updatedAt.toDate().toISOString() };
}
async function writeScope(transaction: Transaction, companyId: string, user: ReturnType<typeof actor>) {
  const [company, registry, access, membership] = await Promise.all([
    transaction.get(doc(database(), 'companies', companyId)), transaction.get(doc(database(), 'system/authorization')),
    transaction.get(doc(database(), 'accountAccess', user.uid)), transaction.get(doc(database(), 'memberships', user.uid)),
  ]);
  authService.assertSession(user.uid);
  if (!company.exists()) throw new Error('Компанію не знайдено.');
  const record = company.data() as Company;
  return { company: record, access: deriveAccess(user.uid, user.emailVerified, registry.data()?.adminUids || [],
    access.data()?.blocked === true, membership.data() as { active: boolean; companyId: string | null } | undefined, record.status === 'active') };
}
async function savedOffer(id: string, identity: string): Promise<CompanyOffer> {
  const snapshot = await getDocFromServer(doc(database(), 'companyOffers', id));
  authService.assertSession(identity);
  if (!snapshot.exists()) throw new Error('Збережену пропозицію не знайдено. Оновіть список.');
  return decodeOffer(id, snapshot.data());
}

export const companyOfferRepository = {
  async save(input: SaveCompanyOfferInput): Promise<CompanyOffer> {
    const user = actor();
    const companyId = validId(input.companyId);
    const id = input.id ? validId(input.id) : crypto.randomUUID();
    const ref = doc(database(), 'companyOffers', id);
    await runTransaction(database(), async transaction => {
      const old = input.id ? await transaction.get(ref) : null;
      const current = old?.exists() ? decodeOffer(id, old.data()) : null;
      if (input.id && !current) throw new Error('Пропозицію не знайдено.');
      const scope = await writeScope(transaction, companyId, user);
      const fields = validateCompanyOfferInput(inputFields(input), scope.company.allowedDomains);
      assertCompanyOfferWrite(scope.access, scope.company, current, input.version, fields.status);
      authService.assertSession(user.uid);
      const timestamp = serverTimestamp();
      transaction.set(ref, { ...fields, id, companyId, createdBy: current?.createdBy || user.uid,
        createdAt: old?.data()?.createdAt || timestamp, updatedBy: user.uid, updatedAt: timestamp, version: (current?.version || 0) + 1 });
    });
    authService.assertSession(user.uid);
    return savedOffer(id, user.uid);
  },

  async setStatus(id: string, status: CompanyOfferStatus, expectedVersion: number): Promise<CompanyOffer> {
    validId(id);
    const user = actor();
    const ref = doc(database(), 'companyOffers', id);
    await runTransaction(database(), async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error('Пропозицію не знайдено.');
      const current = decodeOffer(id, snapshot.data());
      const scope = await writeScope(transaction, current.companyId, user);
      assertCompanyOfferWrite(scope.access, scope.company, current, expectedVersion, status);
      const fields = normalizeCompanyOfferInput({ ...inputFields(current), status });
      // An admin can block an existing offer even after its seller domain was removed.
      if (!(scope.access.role === 'admin' && status === 'blocked') && !isOfferProductUrlAllowed(fields.productUrl, scope.company.allowedDomains)) {
        throw new Error('Оновіть посилання: його домен більше не дозволений компанією.');
      }
      authService.assertSession(user.uid);
      transaction.update(ref, { status: fields.status, version: current.version + 1, updatedAt: serverTimestamp(), updatedBy: user.uid });
    });
    authService.assertSession(user.uid);
    return savedOffer(id, user.uid);
  },

  async getForCompany(companyId: string, cursor?: QueryDocumentSnapshot): Promise<CompanyOfferPage> {
    validId(companyId);
    const user = actor();
    const snapshots = await getDocsFromServer(query(collection(database(), 'companyOffers'), where('companyId', '==', companyId),
      orderBy('createdAt', 'desc'), limit(50), ...(cursor ? [startAfter(cursor)] : [])));
    authService.assertSession(user.uid);
    return { items: snapshots.docs.map(snapshot => decodeOffer(snapshot.id, snapshot.data())), nextCursor: snapshots.size === 50 ? snapshots.docs.at(-1)! : null };
  },

  async getPublishedForCompany(companyId: string, cursor?: QueryDocumentSnapshot): Promise<CompanyOfferPage> {
    validId(companyId);
    const wasDemo = authService.isDemoSession();
    if (wasDemo || !firestoreDb) return { items: [], nextCursor: null };
    const companySnapshot = await getDocFromServer(doc(database(), 'companies', companyId));
    assertPublicMode(wasDemo);
    if (!companySnapshot.exists() || companySnapshot.data().status !== 'active') return { items: [], nextCursor: null };
    const company = companySnapshot.data() as Company;
    const snapshots = await getDocsFromServer(query(collection(database(), 'companyOffers'), where('companyId', '==', companyId),
      where('status', '==', 'published'), orderBy('createdAt', 'desc'), limit(50), ...(cursor ? [startAfter(cursor)] : [])));
    assertPublicMode(wasDemo);
    // Use the unfiltered page's cursor so removed seller domains cannot truncate pagination.
    return { items: snapshots.docs.map(snapshot => decodeOffer(snapshot.id, snapshot.data()))
      .filter(offer => isOfferProductUrlAllowed(offer.productUrl, company.allowedDomains)),
    nextCursor: snapshots.size === 50 ? snapshots.docs.at(-1)! : null };
  },

  async loadActiveCompanies(cursor?: QueryDocumentSnapshot): Promise<CompanyOfferPage<Company>> {
    const wasDemo = authService.isDemoSession();
    if (wasDemo || !firestoreDb) return { items: [], nextCursor: null };
    const snapshots = await getDocsFromServer(query(collection(database(), 'companies'), where('status', '==', 'active'),
      orderBy('name'), limit(50), ...(cursor ? [startAfter(cursor)] : [])));
    assertPublicMode(wasDemo);
    return { items: snapshots.docs.map(snapshot => snapshot.data() as Company), nextCursor: snapshots.size === 50 ? snapshots.docs.at(-1)! : null };
  },
};
