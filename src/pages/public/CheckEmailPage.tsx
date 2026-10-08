import React, { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { Button } from '../../components/common/Button.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { authService, authErrorMessage } from '../../services/authService.ts';

export const CheckEmailPage: React.FC = () => {
  const { user, isDemoSession } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sent, setSent] = useState(Boolean(location.state?.verificationSent));
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const sendVerification = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await authService.sendVerificationEmail();
      setSent(true);
    } catch (error) {
      setError(authErrorMessage(error));
    } finally { setIsLoading(false); }
  };

  const checkVerification = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const current = await authService.refreshCurrentUser();
      if (current?.emailVerified) navigate('/app/onboarding');
      else setError('Пошта ще не підтверджена. Перейдіть за посиланням у листі й повторіть перевірку.');
    } catch (error) {
      setError(authErrorMessage(error));
    } finally { setIsLoading(false); }
  };

  return (
    <div className="min-h-screen bg-neutral-100/70 dark:bg-neutral-950 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md bg-white dark:bg-neutral-900 p-8 rounded-2xl border border-neutral-200 dark:border-neutral-800 text-center space-y-4">
        <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 rounded-full flex items-center justify-center mx-auto"><Mail className="w-6 h-6" /></div>
        <h2 className="text-lg font-bold text-neutral-900 dark:text-white">Підтвердження електронної пошти</h2>
        <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
          {user?.emailVerified ? 'Вашу електронну пошту підтверджено.' : sent ? `Лист підтвердження надіслано на ${user?.email || 'вашу пошту'}. Перейдіть за посиланням у листі. Перевірте також папку «Спам».` : 'Підтвердіть адресу пошти за посиланням із листа Firebase.'}
        </p>
        {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {user && !isDemoSession ? <div className="space-y-3">
          {!user.emailVerified && <>
            <Button variant="outline" size="sm" className="w-full" onClick={sendVerification} isLoading={isLoading}>{sent ? 'Надіслати лист повторно' : 'Надіслати лист підтвердження'}</Button>
            <Button variant="primary" size="sm" className="w-full" onClick={checkVerification} disabled={isLoading}>Я підтвердив пошту — перевірити</Button>
          </>}
          <NavLink to="/app/onboarding" className="block text-xs text-emerald-600 dark:text-emerald-400 underline">Перейти до налаштування майстерні</NavLink>
        </div> : <NavLink to="/auth/login" className="block"><Button variant="outline" size="sm" className="w-full">Повернутися до входу</Button></NavLink>}
      </div>
    </div>
  );
};
