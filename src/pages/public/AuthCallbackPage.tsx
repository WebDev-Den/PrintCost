import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle } from 'lucide-react';
import { authService, authErrorMessage } from '../../services/authService.ts';
import { Button } from '../../components/common/Button.tsx';

export const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const mode = params.get('mode');
  const code = params.get('oobCode') || '';
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const action = useRef<{ mode: string; code: string; promise: Promise<void> } | null>(null);

  useEffect(() => {
    setError(null);
    setVerified(false);
    if (mode === 'resetPassword') {
      navigate(`/auth/reset-password?${new URLSearchParams({ oobCode: code })}`, { replace: true });
      return;
    }
    if ((mode !== 'verifyEmail' && mode !== 'recoverEmail') || !code) {
      setError('Посилання недійсне. Відкрийте повне посилання з листа Firebase.');
      return;
    }
    let active = true;
    if (action.current?.mode !== mode || action.current.code !== code) {
      action.current = { mode, code, promise: authService.completeEmailAction(code, mode) };
    }
    action.current.promise.then(() => { if (active) setVerified(true); })
      .catch(error => { if (active) setError(authErrorMessage(error)); });
    return () => { active = false; };
  }, [mode, code, navigate]);

  return (
    <div className="min-h-screen bg-neutral-100/70 dark:bg-neutral-950 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-neutral-900 p-8 rounded-2xl border border-neutral-200 dark:border-neutral-800 text-center space-y-4 max-w-sm w-full">
        {verified ? <CheckCircle className="w-8 h-8 text-emerald-600 mx-auto" /> : !error && <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />}
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white">
          {verified ? mode === 'recoverEmail' ? 'Попередню електронну пошту відновлено' : 'Електронну пошту підтверджено' : error ? 'Не вдалося виконати дію' : 'Перевірка посилання…'}
        </h2>
        {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {verified && mode === 'recoverEmail' && <p className="text-xs text-neutral-600 dark:text-neutral-400">Якщо ви не змінювали адресу, відновіть пароль для захисту акаунта.</p>}
        {verified && mode === 'recoverEmail' && <NavLink to="/auth/forgot-password"><Button variant="outline" size="sm" className="w-full">Відновити пароль</Button></NavLink>}
        {(verified || error) && <NavLink to={verified && mode === 'verifyEmail' ? '/auth/check-email' : '/auth/login'}>
          <Button variant="primary" size="sm" className="w-full">Продовжити</Button>
        </NavLink>}
      </div>
    </div>
  );
};
