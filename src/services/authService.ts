import {
  applyActionCode,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getIdTokenResult,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  verifyPasswordResetCode,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, runTransaction } from 'firebase/firestore';
import type { UserProfile } from '../domain/types.ts';
import { INITIAL_USER_PROFILE } from '../domain/defaultData.ts';
import { firebaseAuth, firestoreDb } from './firebaseClient.ts';

const DEMO_KEY = 'printcost_is_demo_mode';
const DEMO_PROFILE_KEY = 'printcost_demo_profile';
type ProfileUpdates = Pick<UserProfile, 'fullName' | 'workshopName'>;

export function authErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'Невірна електронна пошта або пароль.',
    'auth/user-not-found': 'Невірна електронна пошта або пароль.',
    'auth/wrong-password': 'Невірна електронна пошта або пароль.',
    'auth/invalid-email': 'Введіть коректну електронну пошту.',
    'auth/email-already-in-use': 'Ця електронна пошта вже зареєстрована. Увійдіть або відновіть пароль.',
    'auth/weak-password': 'Пароль має містити щонайменше 6 символів.',
    'auth/password-does-not-meet-requirements': 'Пароль не відповідає вимогам. Використайте довший пароль з літерами, цифрами та символами.',
    'auth/too-many-requests': 'Забагато спроб. Зачекайте й повторіть пізніше.',
    'auth/network-request-failed': 'Немає з’єднання із сервісом. Перевірте інтернет і повторіть спробу.',
    'auth/expired-action-code': 'Термін дії посилання вичерпано. Запросіть новий лист.',
    'auth/invalid-action-code': 'Посилання недійсне або вже використане. Запросіть новий лист.',
    'auth/requires-recent-login': 'Для цієї дії потрібно повторно увійти в акаунт.',
    'auth/user-disabled': 'Цей акаунт вимкнено. Зверніться до адміністратора.',
    'auth/operation-not-allowed': 'Вхід за електронною поштою ще не ввімкнено у Firebase.',
    'auth/unauthorized-continue-uri': 'Адресу сайту ще не додано до дозволених доменів Firebase.',
    'auth/invalid-api-key': 'Налаштування Firebase неправильні. Перевірте конфігурацію сайту.',
    'permission-denied': 'Немає дозволу на збереження профілю. Перевірте правила доступу Firestore.',
    'unavailable': 'База даних тимчасово недоступна. Повторіть спробу пізніше.',
  };
  return messages[code] || (code ? 'Не вдалося виконати дію. Повторіть спробу пізніше.' :
    error instanceof Error ? error.message : 'Не вдалося виконати дію. Повторіть спробу.');
}

function requireAuth() {
  if (!firebaseAuth || !firestoreDb) throw new Error('Firebase ще не налаштовано. Спробуйте деморежим або зверніться до адміністратора.');
  return firebaseAuth;
}

async function readProfile(user: User): Promise<UserProfile> {
  const [snapshot, token] = await Promise.all([
    getDoc(doc(firestoreDb!, 'users', user.uid)),
    getIdTokenResult(user),
  ]);
  const data = snapshot.data();
  return {
    id: user.uid,
    email: user.email || '',
    fullName: typeof data?.fullName === 'string' ? data.fullName : user.displayName || '',
    workshopName: typeof data?.workshopName === 'string' ? data.workshopName : '',
    createdAt: typeof data?.createdAt === 'string' ? data.createdAt : user.metadata.creationTime || '',
    isDemoUser: false,
    emailVerified: user.emailVerified,
    isAdmin: token.claims.admin === true,
  };
}

export interface AuthService {
  getCurrentUser(): Promise<UserProfile | null>;
  login(email: string, password: string): Promise<UserProfile>;
  register(email: string, password: string): Promise<UserProfile>;
  forgotPassword(email: string): Promise<void>;
  resetPassword(password: string, code?: string): Promise<void>;
  logout(): Promise<void>;
  isDemoSession(): boolean;
  enableDemoSession(): Promise<UserProfile>;
}

export class FirebaseAuthService implements AuthService {
  private listeners = new Set<() => void>();

  isDemoSession(): boolean {
    try { return localStorage.getItem(DEMO_KEY) === 'true'; } catch { return false; }
  }

  getSessionIdentity(): string { return this.isDemoSession() ? 'demo' : firebaseAuth?.currentUser?.uid || ''; }

  assertSession(identity: string): void {
    if (this.getSessionIdentity() !== identity) throw new Error('Акаунт змінився під час операції. Повторіть дію.');
  }

  async getCurrentUser(): Promise<UserProfile | null> {
    if (firebaseAuth) await firebaseAuth.authStateReady();
    if (this.isDemoSession()) {
      const saved = localStorage.getItem(DEMO_PROFILE_KEY);
      let updates: Partial<ProfileUpdates> = {};
      try { updates = saved ? JSON.parse(saved) : {}; } catch { /* Ignore malformed demo preferences. */ }
      return { ...INITIAL_USER_PROFILE, fullName: typeof updates?.fullName === 'string' ? updates.fullName : INITIAL_USER_PROFILE.fullName,
        workshopName: typeof updates?.workshopName === 'string' ? updates.workshopName : INITIAL_USER_PROFILE.workshopName,
        isAdmin: false, emailVerified: false };
    }
    return firebaseAuth?.currentUser ? readProfile(firebaseAuth.currentUser) : null;
  }

  subscribe(onUser: (user: UserProfile | null) => void, onError: (error: unknown) => void): () => void {
    let revision = 0;
    let active = true;
    const refresh = async () => {
      const currentRevision = ++revision;
      try {
        const user = await this.getCurrentUser();
        if (active && currentRevision === revision) onUser(user);
      } catch (error) {
        if (active && currentRevision === revision) onError(error);
      }
    };
    this.listeners.add(refresh);
    const stopAuth = firebaseAuth ? onAuthStateChanged(firebaseAuth, refresh, onError) : undefined;
    const onStorage = (event: StorageEvent) => {
      if (event.key === DEMO_KEY || event.key === DEMO_PROFILE_KEY || event.key === null) void refresh();
    };
    window.addEventListener('storage', onStorage);
    if (!firebaseAuth) void refresh();
    return () => {
      active = false;
      stopAuth?.();
      this.listeners.delete(refresh);
      window.removeEventListener('storage', onStorage);
    };
  }

  private notify() { for (const listener of this.listeners) listener(); }

  async login(email: string, password: string): Promise<UserProfile> {
    const auth = requireAuth();
    localStorage.removeItem(DEMO_KEY);
    this.notify();
    const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    this.assertSession(credential.user.uid);
    const profile = await readProfile(credential.user);
    this.assertSession(credential.user.uid);
    return profile;
  }

  async register(email: string, password: string): Promise<UserProfile> {
    const auth = requireAuth();
    localStorage.removeItem(DEMO_KEY);
    this.notify();
    const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
    this.assertSession(user.uid);
    try {
      await runTransaction(firestoreDb!, async transaction => {
        this.assertSession(user.uid);
        const ref = doc(firestoreDb!, 'users', user.uid);
        await transaction.get(ref);
        this.assertSession(user.uid);
        transaction.set(ref, { fullName: '', workshopName: '', email: user.email || '', createdAt: new Date().toISOString() });
      });
    } catch (error) {
      throw new Error(`Акаунт створено, але профіль не збережено. ${authErrorMessage(error)} Увійдіть і збережіть дані у налаштуваннях акаунта.`);
    }
    try {
      this.assertSession(user.uid);
      await this.sendVerificationEmail();
    } catch (error) {
      throw new Error(`Акаунт створено, але лист підтвердження не надіслано. ${authErrorMessage(error)} Увійдіть і повторіть надсилання в налаштуваннях акаунта.`);
    }
    const profile = await readProfile(user);
    this.assertSession(user.uid);
    return profile;
  }

  async forgotPassword(email: string): Promise<void> {
    await sendPasswordResetEmail(requireAuth(), email.trim(), { url: `${window.location.origin}/auth/login` });
  }

  async verifyPasswordResetCode(code: string): Promise<string> {
    if (!code) throw new Error('У посиланні немає коду відновлення. Запросіть новий лист.');
    return verifyPasswordResetCode(requireAuth(), code);
  }

  async resetPassword(password: string, code = ''): Promise<void> {
    if (!code) throw new Error('У посиланні немає коду відновлення. Запросіть новий лист.');
    await confirmPasswordReset(requireAuth(), code, password);
  }

  async sendVerificationEmail(): Promise<void> {
    const user = requireAuth().currentUser;
    if (!user || this.isDemoSession()) throw new Error('Спочатку увійдіть у свій акаунт.');
    await sendEmailVerification(user, { url: `${window.location.origin}/auth/check-email` });
    this.assertSession(user.uid);
  }

  async verifyEmail(code: string): Promise<void> {
    if (!code) throw new Error('У посиланні немає коду підтвердження.');
    await applyActionCode(requireAuth(), code);
    this.notify();
  }

  async refreshCurrentUser(): Promise<UserProfile | null> {
    if (firebaseAuth) await firebaseAuth.authStateReady();
    const identity = this.getSessionIdentity();
    const current = firebaseAuth?.currentUser;
    if (current && identity !== 'demo') await reload(current);
    this.assertSession(identity);
    const user = await this.getCurrentUser();
    this.assertSession(identity);
    this.notify();
    return user;
  }

  async updateProfile(updates: Partial<ProfileUpdates>): Promise<UserProfile> {
    const identity = this.getSessionIdentity();
    const current = await this.getCurrentUser();
    this.assertSession(identity);
    if (!current) throw new Error('Спочатку увійдіть у свій акаунт.');
    if ((current.isDemoUser ? 'demo' : current.id) !== identity) throw new Error('Акаунт змінився під час операції. Повторіть дію.');
    const changes: Partial<ProfileUpdates> = {};
    for (const key of ['fullName', 'workshopName'] as const) {
      if (updates[key] !== undefined) {
        if (typeof updates[key] !== 'string' || updates[key]!.trim().length > 200) throw new Error('Ім’я та назва майстерні мають містити до 200 символів.');
        changes[key] = updates[key]!.trim();
      }
    }
    if (this.isDemoSession()) {
      localStorage.setItem(DEMO_PROFILE_KEY, JSON.stringify({ fullName: current.fullName, workshopName: current.workshopName, ...changes }));
    } else {
      await runTransaction(firestoreDb!, async transaction => {
        this.assertSession(identity);
        const ref = doc(firestoreDb!, 'users', current.id);
        const snapshot = await transaction.get(ref);
        this.assertSession(identity);
        if (snapshot.exists()) transaction.update(ref, changes);
        else transaction.set(ref, { fullName: current.fullName, workshopName: current.workshopName,
          email: current.email, createdAt: current.createdAt, ...changes });
      });
    }
    this.assertSession(identity);
    const updated = { ...current, ...changes };
    this.notify();
    return updated;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const user = requireAuth().currentUser;
    if (!user?.email || this.isDemoSession()) throw new Error('Зміна пароля доступна лише у вашому справжньому акаунті.');
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
    this.assertSession(user.uid);
    await updatePassword(user, newPassword);
    this.assertSession(user.uid);
  }

  async logout(): Promise<void> {
    if (firebaseAuth) await signOut(firebaseAuth);
    localStorage.removeItem(DEMO_KEY);
    this.notify();
  }

  async enableDemoSession(): Promise<UserProfile> {
    if (firebaseAuth) await signOut(firebaseAuth);
    localStorage.setItem(DEMO_KEY, 'true');
    this.notify();
    return (await this.getCurrentUser())!;
  }
}

export const authService = new FirebaseAuthService();
