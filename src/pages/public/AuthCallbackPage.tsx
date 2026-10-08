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
  const action = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (mode === 'resetPassword') {
      navigate(`/auth/reset-password?${new URLSearchParams({ oobCode: code })}`, { replace: true });
      return;
    }
    if (mode !== 'verifyEmail' || !code) {
      setError('Посилання недійсне. Відкрийте повне посилання з листа Firebase.');
      return;
    }
    let active = true;
    action.current ??= authService.verifyEmail(code);
    action.current.then(() => { if (active) setVerified(true); })
      .catch(error => { if (active) setError(authErrorMessage(error)); });
    return () => { active = false; };
  }, [mode, code, navigate]);

  return (
    <div className="min-h-screen bg-neutral-100/70 dark:bg-neutral-950 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-neutral-900 p-8 rounded-2xl border border-neutral-200 dark:border-neutral-800 text-center space-y-4 max-w-sm w-full">
        {verified ? <CheckCircle className="w-8 h-8 text-emerald-600 mx-auto" /> : !error && <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />}
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white">
          {verified ? 'Електронну пошту підтверджено' : error ? 'Не вдалося підтвердити пошту' : 'Перевірка посилання…'}
        </h2>
        {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {(verified || error) && <NavLink to={verified ? '/auth/check-email' : '/auth/login'}>
          <Button variant="primary" size="sm" className="w-full">Продовжити</Button>
        </NavLink>}
      </div>
    </div>
  );
};
