import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail, Sparkles } from 'lucide-react';
import { Input } from '../../components/common/Input.tsx';
import { Button } from '../../components/common/Button.tsx';
import { BrandLogo } from '../../components/common/BrandLogo.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { authErrorMessage } from '../../services/authService.ts';
import { useTurnstile } from '../../components/common/TurnstileChallenge.tsx';

export const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { register, enableDemoSession } = useAuth();
  const captcha = useTurnstile('register');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !captcha.ready) return;
    setError(null);

    if (!email || !email.includes('@')) {
      setError('Введіть коректну електронну пошту');
      return;
    }
    if (password.length < 6) {
      setError('Пароль повинен бути щонайменше 6 символів');
      return;
    }
    if (password !== confirmPassword) {
      setError('Введені паролі не збігаються');
      return;
    }

    setIsSubmitting(true);
    try {
      await register(email, password, captcha.token);
      navigate('/auth/check-email', { state: { verificationSent: true } });
    } catch (error) {
      setError(authErrorMessage(error));
    } finally {
      captcha.reset();
      setIsSubmitting(false);
    }
  };

  const handleDemoAccess = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await enableDemoSession();
      navigate('/app/dashboard');
    } catch (error) {
      setError(authErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-100/70 dark:bg-neutral-950 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center space-y-2">
        <NavLink to="/" className="inline-flex items-center justify-center">
          <BrandLogo size="lg" />
        </NavLink>
        <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">
          Реєстрація нової майстерні
        </h2>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          Створіть свій ізольований простір матеріалів і тарифів
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-neutral-900 py-8 px-6 shadow-sm border border-neutral-200 dark:border-neutral-800 rounded-2xl space-y-6">
          {error && (
            <div role="alert" className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300 font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Електронна пошта"
              type="email"
              autoComplete="email"
              placeholder="workshop@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              leftAddon={<Mail className="w-4 h-4" />}
              required
            />

            <div>
              <label htmlFor="register-password" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                Пароль
              </label>
              <div className="relative flex items-center rounded-lg border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900 focus-within:ring-2 focus-within:ring-emerald-500">
                <div className="pl-3 pr-2 text-neutral-500 text-xs">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="register-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Мінімум 6 символів"
                  className="w-full px-3 py-2 text-sm bg-transparent focus:outline-none dark:text-white"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="pr-3 pl-2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                  aria-label={showPassword ? 'Приховати пароль' : 'Показати пароль'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="register-password-confirm" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                Повторіть пароль
              </label>
              <div className="relative flex items-center rounded-lg border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900 focus-within:ring-2 focus-within:ring-emerald-500">
                <div className="pl-3 pr-2 text-neutral-500 text-xs">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="register-password-confirm"
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
              disabled={!captcha.ready}
            >
              Створити акаунт та почати
            </Button>
          </form>

          <div className="pt-2 border-t border-neutral-200 dark:border-neutral-800 space-y-3 text-center text-xs">
            <div>
              <span className="text-neutral-500 dark:text-neutral-400">Вже маєте акаунт? </span>
              <NavLink
                to="/auth/login"
                className="font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 underline"
              >
                Увійти
              </NavLink>
            </div>

            <button
              type="button"
              onClick={handleDemoAccess}
              disabled={isSubmitting}
              className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 flex items-center justify-center gap-1 mx-auto"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Або відкрити деморежим</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
