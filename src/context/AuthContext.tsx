import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { UserProfile } from '../domain/types.ts';
import { authService, authErrorMessage } from '../services/authService.ts';

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  isDemoSession: boolean;
  authError: string | null;
  login: (email: string, pass: string, captchaToken?: string) => Promise<void>;
  loginWithGoogle: (captchaToken?: string, action?: 'login' | 'register') => Promise<void>;
  register: (email: string, pass: string, captchaToken?: string) => Promise<void>;
  logout: () => Promise<void>;
  enableDemoSession: () => Promise<void>;
  updateUser: (updates: Partial<Pick<UserProfile, 'fullName' | 'workshopName'>>) => Promise<void>;
  reloadUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDemoSession, setIsDemoSession] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const revision = useRef(0);

  const acceptUser = (next: UserProfile | null) => {
    if (authService.getSessionIdentity() !== (next ? next.isDemoUser ? 'demo' : next.id : '')) return;
    ++revision.current;
    setUser(next);
    setIsDemoSession(Boolean(next?.isDemoUser));
    setAuthError(null);
    setIsLoading(false);
  };

  useEffect(() => authService.subscribe(acceptUser, (error) => {
    ++revision.current;
    setUser(null);
    setIsDemoSession(false);
    setAuthError(authErrorMessage(error));
    setIsLoading(false);
  }, () => {
    ++revision.current;
    setUser(null);
    setIsDemoSession(false);
    setAuthError(null);
    setIsLoading(true);
  }), []);

  const acceptOperation = async (operation: Promise<UserProfile | null>) => {
    const started = revision.current;
    const next = await operation;
    if (started === revision.current) acceptUser(next);
  };
  const login = async (email: string, pass: string, captchaToken?: string) => acceptOperation(authService.login(email, pass, captchaToken));
  const loginWithGoogle = async (captchaToken?: string, action?: 'login' | 'register') => acceptOperation(authService.loginWithGoogle(captchaToken, action));
  const register = async (email: string, pass: string, captchaToken?: string) => acceptOperation(authService.register(email, pass, captchaToken));
  const logout = async () => { await authService.logout(); acceptUser(null); };
  const enableDemoSession = async () => acceptOperation(authService.enableDemoSession());
  const updateUser = async (updates: Partial<Pick<UserProfile, 'fullName' | 'workshopName'>>) => {
    const identity = user ? user.isDemoUser ? 'demo' : user.id : '';
    authService.assertSession(identity);
    const started = revision.current;
    const updated = await authService.updateProfile(updates);
    authService.assertSession(identity);
    if ((updated.isDemoUser ? 'demo' : updated.id) !== identity) throw new Error('Акаунт змінився під час операції. Повторіть дію.');
    if (started === revision.current) acceptUser(updated);
  };
  const reloadUser = async () => acceptOperation(authService.refreshCurrentUser());

  return (
    <AuthContext.Provider value={{ user, isLoading, isDemoSession, authError, login, loginWithGoogle, register, logout, enableDemoSession, updateUser, reloadUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
