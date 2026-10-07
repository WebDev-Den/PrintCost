import React, { createContext, useContext, useEffect, useState } from 'react';
import type { UserProfile } from '../domain/types.ts';
import { authService } from '../services/authService.ts';

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  isDemoSession: boolean;
  login: (email: string, pass: string) => Promise<void>;
  register: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  enableDemoSession: () => Promise<void>;
  updateUser: (updates: Partial<UserProfile>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDemoSession, setIsDemoSession] = useState(true);

  useEffect(() => {
    async function initAuth() {
      try {
        const currentUser = await authService.getCurrentUser();
        setUser(currentUser);
        setIsDemoSession(authService.isDemoSession());
      } catch (err) {
        console.error('Auth initialization error', err);
      } finally {
        setIsLoading(false);
      }
    }
    initAuth();
  }, []);

  const login = async (email: string, pass: string) => {
    const u = await authService.login(email, pass);
    setUser(u);
    setIsDemoSession(false);
  };

  const register = async (email: string, pass: string) => {
    const u = await authService.register(email, pass);
    setUser(u);
    setIsDemoSession(false);
  };

  const logout = async () => {
    await authService.logout();
    setUser(null);
    setIsDemoSession(false);
  };

  const enableDemoSession = async () => {
    const u = await authService.enableDemoSession();
    setUser(u);
    setIsDemoSession(true);
  };

  const updateUser = (updates: Partial<UserProfile>) => {
    if (!user) return;
    setUser({ ...user, ...updates });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isDemoSession,
        login,
        register,
        logout,
        enableDemoSession,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
