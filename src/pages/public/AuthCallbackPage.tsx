import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

export const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // In production, this processes the OAuth/Magic link redirect from Supabase
    const timer = setTimeout(() => {
      navigate('/app/dashboard');
    }, 1000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-neutral-100/70 dark:bg-neutral-950 flex flex-col items-center justify-center p-4">
      <div className="bg-white dark:bg-neutral-900 p-8 rounded-2xl border border-neutral-200 dark:border-neutral-800 text-center space-y-4 max-w-sm w-full">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white">
          Авторизація...
        </h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Перевірка сесії та перенаправлення до особистого кабінету майстерні.
        </p>
      </div>
    </div>
  );
};
