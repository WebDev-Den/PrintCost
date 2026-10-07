import type { UserProfile } from '../domain/types.ts';
import { INITIAL_USER_PROFILE } from '../domain/defaultData.ts';

export interface AuthService {
  getCurrentUser(): Promise<UserProfile | null>;
  login(email: string, password: string): Promise<UserProfile>;
  register(email: string, password: string): Promise<UserProfile>;
  forgotPassword(email: string): Promise<void>;
  resetPassword(password: string): Promise<void>;
  logout(): Promise<void>;
  isDemoSession(): boolean;
  enableDemoSession(): Promise<UserProfile>;
}

const STORAGE_KEY_AUTH = 'printcost_auth_user';
const STORAGE_KEY_DEMO_FLAG = 'printcost_is_demo_mode';

/**
 * MockAuthService for frontend development and demonstration.
 * Does NOT store real passwords or fake JWTs.
 * Ready to be replaced by SupabaseAuthService.
 */
export class MockAuthService implements AuthService {
  async getCurrentUser(): Promise<UserProfile | null> {
    const raw = localStorage.getItem(STORAGE_KEY_AUTH);
    if (!raw) {
      // Default to demo session for ease of evaluation
      return INITIAL_USER_PROFILE;
    }
    try {
      return JSON.parse(raw) as UserProfile;
    } catch {
      return INITIAL_USER_PROFILE;
    }
  }

  async login(email: string, _password: string): Promise<UserProfile> {
    const user: UserProfile = {
      ...INITIAL_USER_PROFILE,
      id: 'usr_' + Math.random().toString(36).substring(2, 9),
      email: email.trim().toLowerCase(),
      isDemoUser: false,
    };
    localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(user));
    localStorage.setItem(STORAGE_KEY_DEMO_FLAG, 'false');
    return user;
  }

  async register(email: string, _password: string): Promise<UserProfile> {
    const user: UserProfile = {
      id: 'usr_' + Math.random().toString(36).substring(2, 9),
      email: email.trim().toLowerCase(),
      fullName: email.split('@')[0],
      workshopName: 'Моя 3D Майстерня',
      createdAt: new Date().toISOString(),
      isDemoUser: false,
    };
    localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(user));
    localStorage.setItem(STORAGE_KEY_DEMO_FLAG, 'false');
    return user;
  }

  async forgotPassword(_email: string): Promise<void> {
    // In demo mode: simulate success
    return new Promise((resolve) => setTimeout(resolve, 400));
  }

  async resetPassword(_password: string): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 400));
  }

  async logout(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY_AUTH);
    localStorage.setItem(STORAGE_KEY_DEMO_FLAG, 'false');
  }

  isDemoSession(): boolean {
    const flag = localStorage.getItem(STORAGE_KEY_DEMO_FLAG);
    if (flag === null) return true; // Default is demo mode
    return flag === 'true';
  }

  async enableDemoSession(): Promise<UserProfile> {
    localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(INITIAL_USER_PROFILE));
    localStorage.setItem(STORAGE_KEY_DEMO_FLAG, 'true');
    return INITIAL_USER_PROFILE;
  }
}

export const authService = new MockAuthService();
