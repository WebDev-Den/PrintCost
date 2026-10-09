import {
  applyActionCode,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getIdToken,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile as updateFirebaseProfile,
  verifyPasswordResetCode,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, getDocFromServer, onSnapshot, runTransaction } from 'firebase/firestore';
import type { UserProfile } from '../domain/types.ts';
import { INITIAL_USER_PROFILE } from '../domain/defaultData.ts';
import { firebaseAuth, firestoreDb } from './firebaseClient.ts';
import { organizationRepository } from './organizationRepository.ts';
import { verifyTurnstile } from './turnstileService.ts';

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
    'permission-denied': 'Немає дозволу на цю дію. Перевірте підтвердження пошти та актуальні права акаунта.',
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
  const deletion = await getDocFromServer(doc(firestoreDb!, 'accountDeletion', user.uid));
  authService.assertSession(user.uid);
  if (!deletion.exists()) await organizationRepository.ensureIdentity(user);
  authService.assertSession(user.uid);
  const access = await organizationRepository.getAccess(user.uid);
  authService.assertSession(user.uid);
  const snapshot = user.emailVerified && !access.blocked ? await getDoc(doc(firestoreDb!, 'users', user.uid)) : null;
  authService.assertSession(user.uid);
  const data = snapshot?.data();
  return {
    id: user.uid,
    email: user.email || '',
    fullName: typeof data?.fullName === 'string' ? data.fullName : user.displayName || '',
    workshopName: typeof data?.workshopName === 'string' ? data.workshopName : '',
    createdAt: typeof data?.createdAt === 'string' ? data.createdAt : new Date(user.metadata.creationTime || Date.now()).toISOString(),
    isDemoUser: false,
    emailVerified: user.emailVerified,
    isAdmin: !deletion.exists() && access.role === 'admin',
    role: deletion.exists() ? 'user' : access.role,
    companyId: deletion.exists() ? null : access.companyId,
    isBlocked: access.blocked || deletion.exists(),
    deletionPending: deletion.exists(),
  };
}

export interface AuthService {
  getCurrentUser(): Promise<UserProfile | null>;
  login(email: string, password: string, captchaToken?: string): Promise<UserProfile>;
  register(email: string, password: string, captchaToken?: string): Promise<UserProfile>;
  forgotPassword(email: string, captchaToken?: string): Promise<void>;
  resetPassword(password: string, code?: string, captchaToken?: string): Promise<void>;
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
        isAdmin: false, role: 'user', companyId: null, isBlocked: false, emailVerified: false };
    }
    return firebaseAuth?.currentUser ? readProfile(firebaseAuth.currentUser) : null;
  }

  subscribe(onUser: (user: UserProfile | null) => void, onError: (error: unknown) => void, onPending?: () => void): () => void {
    let revision = 0;
    let active = true;
    let latest: UserProfile | null = null;
    let accessIdentity = '';
    let stopAccess: (() => void) | undefined;
    let stopDeletion: (() => void) | undefined;
    const refresh = async () => {
      const currentRevision = ++revision;
      const identity = this.getSessionIdentity();
      if (identity !== (latest ? latest.isDemoUser ? 'demo' : latest.id : '') || (accessIdentity && accessIdentity !== identity)) {
        latest = null;
        stopAccess?.(); stopAccess = undefined; accessIdentity = '';
        stopDeletion?.(); stopDeletion = undefined;
        onPending?.();
      }
      try {
        const user = await this.getCurrentUser();
        if (!active || currentRevision !== revision || identity !== this.getSessionIdentity()) return;
        latest = user;
        onUser(user);
        if (user && !user.isDemoUser && accessIdentity !== user.id) {
          stopAccess?.();
          accessIdentity = user.id;
          stopAccess = organizationRepository.observeAccess(user.id, access => {
            if (!active || this.getSessionIdentity() !== user.id || latest?.id !== user.id) return;
            ++revision;
            latest = { ...latest, emailVerified: firebaseAuth?.currentUser?.emailVerified === true,
              role: latest.deletionPending ? 'user' : access.role, isAdmin: !latest.deletionPending && access.role === 'admin',
              companyId: latest.deletionPending ? null : access.companyId, isBlocked: access.blocked || latest.deletionPending };
            onUser(latest);
          }, error => {
            if (active && this.getSessionIdentity() === user.id) { ++revision; latest = null; onError(error); }
          });
          stopDeletion?.();
          stopDeletion = onSnapshot(doc(firestoreDb!, 'accountDeletion', user.id), snapshot => {
            if (!active || this.getSessionIdentity() !== user.id || latest?.id !== user.id || !snapshot.exists()) return;
            ++revision;
            latest = { ...latest, deletionPending: true, isBlocked: true, isAdmin: false, role: 'user', companyId: null };
            onUser(latest);
          }, error => {
            if (active && this.getSessionIdentity() === user.id) { ++revision; latest = null; onError(error); }
          });
        }
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
      stopAccess?.();
      stopDeletion?.();
      stopAuth?.();
      this.listeners.delete(refresh);
      window.removeEventListener('storage', onStorage);
    };
  }

  private notify() { for (const listener of this.listeners) listener(); }

  async login(email: string, password: string, captchaToken = ''): Promise<UserProfile> {
    const auth = requireAuth();
    const identity = this.getSessionIdentity();
    await verifyTurnstile('login', captchaToken);
    this.assertSession(identity);
    localStorage.removeItem(DEMO_KEY);
    this.notify();
    const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    this.assertSession(credential.user.uid);
    const profile = await readProfile(credential.user);
    this.assertSession(credential.user.uid);
    return profile;
  }

  async register(email: string, password: string, captchaToken = ''): Promise<UserProfile> {
    const auth = requireAuth();
    const identity = this.getSessionIdentity();
    await verifyTurnstile('register', captchaToken);
    this.assertSession(identity);
    localStorage.removeItem(DEMO_KEY);
    this.notify();
    const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
    this.assertSession(user.uid);
    try {
      await organizationRepository.ensureIdentity(user);
      this.assertSession(user.uid);
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

  async forgotPassword(email: string, captchaToken = ''): Promise<void> {
    const auth = requireAuth();
    await verifyTurnstile('forgot_password', captchaToken);
    try {
      await sendPasswordResetEmail(auth, email.trim(), { url: `${window.location.origin}/auth/login` });
    } catch (error) {
      // Keep the same response when an emulator or older project exposes missing accounts.
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'auth/user-not-found') throw error;
    }
  }

  async verifyPasswordResetCode(code: string): Promise<string> {
    if (!code) throw new Error('У посиланні немає коду відновлення. Запросіть новий лист.');
    return verifyPasswordResetCode(requireAuth(), code);
  }

  async resetPassword(password: string, code = '', captchaToken = ''): Promise<void> {
    if (!code) throw new Error('У посиланні немає коду відновлення. Запросіть новий лист.');
    const auth = requireAuth();
    await verifyTurnstile('reset_password', captchaToken);
    await confirmPasswordReset(auth, code, password);
  }

  async resendVerificationEmail(captchaToken = ''): Promise<void> {
    const user = requireAuth().currentUser;
    if (!user || this.isDemoSession()) throw new Error('Спочатку увійдіть у свій акаунт.');
    await verifyTurnstile('resend_verification', captchaToken);
    this.assertSession(user.uid);
    await this.sendVerificationEmail();
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
    await this.refreshCurrentUser();
  }

  async refreshCurrentUser(): Promise<UserProfile | null> {
    if (firebaseAuth) await firebaseAuth.authStateReady();
    const identity = this.getSessionIdentity();
    const current = firebaseAuth?.currentUser;
    if (current && identity !== 'demo') { await reload(current); this.assertSession(identity); await getIdToken(current, true); }
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
    if (!current.isDemoUser && (!current.emailVerified || current.isBlocked)) throw new Error('Редагування доступне після підтвердження пошти для активного акаунта.');
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
      this.assertSession(identity);
      const firebaseUser = requireAuth().currentUser!;
      if (changes.fullName !== undefined) await updateFirebaseProfile(firebaseUser, { displayName: changes.fullName });
      this.assertSession(identity);
      await organizationRepository.ensureIdentity(firebaseUser);
    }
    this.assertSession(identity);
    const updated = current.isDemoUser ? { ...current, ...changes } : await readProfile(requireAuth().currentUser!);
    this.assertSession(identity);
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
