import type { UserProfile } from '../domain/types.ts';
import { api } from './api.ts';

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

export class MockAuthService implements AuthService {
  async getCurrentUser(): Promise<UserProfile | null> {
    return api.auth.getCurrentUser();
  }

  async login(email: string, password: string): Promise<UserProfile> {
    return api.auth.login(email, password);
  }

  async register(email: string, password: string): Promise<UserProfile> {
    return api.auth.register(email, password);
  }

  async forgotPassword(email: string): Promise<void> {
    return api.auth.forgotPassword(email);
  }

  async resetPassword(password: string): Promise<void> {
    return api.auth.resetPassword(password);
  }

  async logout(): Promise<void> {
    return api.auth.logout();
  }

  isDemoSession(): boolean {
    return api.auth.isDemoSession();
  }

  async enableDemoSession(): Promise<UserProfile> {
    return api.auth.enableDemoSession();
  }
}

export const authService = new MockAuthService();
