import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Eye, EyeOff, CheckCircle, AlertTriangle } from 'lucide-react';
import { Button } from '../../components/common/Button.tsx';
import { BrandLogo } from '../../components/common/BrandLogo.tsx';
import { authService, authErrorMessage } from '../../services/authService.ts';
import { useTurnstile } from '../../components/common/TurnstileChallenge.tsx';

export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const code = searchParams.get('oobCode') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const captcha = useTurnstile('reset_password', !isChecking && !linkError && !success);

  useEffect(() => {
    let active = true;
    setIsChecking(true);
    setLinkError(null);
    authService.verifyPasswordResetCode(code).catch(error => {
      if (active) setLinkError(authErrorMessage(error));
    }).finally(() => { if (active) setIsChecking(false); });
    return () => { active = false; };
  }, [code]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || isChecking || linkError || !captcha.ready) return;
    setError(null);

    if (password.length < 6) {
      setError('Пароль має містити не менше 6 символів');
      return;
    }
    if (password !== confirmPassword) {
      setError('Паролі не збігаються');
      return;
    }

    setIsSubmitting(true);
    try {
      await authService.resetPassword(password, code, captcha.token);
      setSuccess(true);
    } catch (error) {
      setError(authErrorMessage(error));
    } finally {
      captcha.reset();
      setIsSubmitting(false);
    }
  };

  if (linkError) {
    return (
      <div className="min-h-screen bg-neutral-100/70 dark:bg-neutral-950 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md bg-white dark:bg-neutral-900 p-8 rounded-2xl border border-neutral-200 dark:border-neutral-800 text-center space-y-4">
          <div className="w-12 h-12 bg-amber-50 dark:bg-amber-950 text-amber-600 rounded-full flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-white">
            Посилання для відновлення недійсне
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {linkError}
          </p>
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            onClick={() => navigate('/auth/forgot-password')}
          >
            Запросити нове посилання
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-100/70 dark:bg-neutral-950 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center space-y-2">
        <NavLink to="/" className="inline-flex items-center justify-center">
          <BrandLogo size="lg" />
        </NavLink>
        <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">
          Встановлення нового пароля
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-neutral-900 py-8 px-6 shadow-sm border border-neutral-200 dark:border-neutral-800 rounded-2xl space-y-6">
          {success ? (
            <div className="space-y-4 text-center">
              <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-white">
                Пароль успішно змінено
              </p>
              <Button
                variant="primary"
                size="sm"
                className="w-full"
                onClick={() => navigate('/auth/login')}
              >
                Перейти до входу
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div role="alert" className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 text-xs text-red-700 rounded-lg">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="reset-password" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                  Новий пароль
                </label>
                <div className="relative flex items-center rounded-lg border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900 focus-within:ring-2 focus-within:ring-emerald-500">
                  <div className="pl-3 pr-2 text-neutral-500 text-xs">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="reset-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Мінімум 6 знаків"
                    className="w-full px-3 py-2 text-sm bg-transparent focus:outline-none dark:text-white"
                    required
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Приховати пароль' : 'Показати пароль'}
                    onClick={() => setShowPassword(!showPassword)}
                    className="pr-3 pl-2 text-neutral-400"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="reset-password-confirm" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                  Повторіть новий пароль
                </label>
                <div className="relative flex items-center rounded-lg border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900 focus-within:ring-2 focus-within:ring-emerald-500">
                  <div className="pl-3 pr-2 text-neutral-500 text-xs">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="reset-password-confirm"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Повторіть пароль"
                    className="w-full px-3 py-2 text-sm bg-transparent focus:outline-none dark:text-white"
                    required
                  />
                </div>
              </div>

              {captcha.field}

              <Button
                type="submit"
                variant="primary"
                size="md"
                className="w-full"
                isLoading={isSubmitting}
                disabled={isChecking || !captcha.ready}
              >
                {isChecking ? 'Перевірка посилання…' : 'Зберегти новий пароль'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
