import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail, ArrowRight, Sparkles } from 'lucide-react';
import { Input } from '../../components/common/Input.tsx';
import { Button } from '../../components/common/Button.tsx';
import { BrandLogo } from '../../components/common/BrandLogo.tsx';
import { useAuth } from '../../context/AuthContext.tsx';

// Google auth feature flag (hidden or enabled per configuration)
const FEATURE_FLAG_GOOGLE_AUTH = false;

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login, enableDemoSession } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email || !email.includes('@')) {
      setError('Введіть коректну адресу електронної пошти');
      return;
    }
    if (!password || password.length < 6) {
      setError('Пароль має містити не менше 6 символів');
      return;
    }

    setIsSubmitting(true);
    try {
      await login(email, password);
      navigate('/app/dashboard');
    } catch {
      setError('Невірний логін або пароль');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDemoLogin = async () => {
    setIsSubmitting(true);
    try {
      await enableDemoSession();
      navigate('/app/dashboard');
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
          Вхід до особистого кабінету
        </h2>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          Керуйте матеріалами, принтерами та розрахунками
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-neutral-900 py-8 px-6 shadow-sm border border-neutral-200 dark:border-neutral-800 rounded-2xl space-y-6">
          {/* Prominent Demo Entry Action */}
          <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800 space-y-2 text-center">
            <p className="text-xs text-emerald-900 dark:text-emerald-200 font-medium">
              Хочете одразу випробувати інтерфейс без реєстрації?
            </p>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="w-full"
              leftIcon={<Sparkles className="w-4 h-4" />}
              onClick={handleDemoLogin}
              disabled={isSubmitting}
            >
              Переглянути демо
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-neutral-200 dark:border-neutral-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white dark:bg-neutral-900 px-2 text-neutral-500">
                або за адресою email
              </span>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300 font-medium">
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
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  Пароль
                </label>
                <NavLink
                  to="/auth/forgot-password"
                  className="text-xs text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                >
                  Забули пароль?
                </NavLink>
              </div>

              <div className="relative flex items-center rounded-lg border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900 focus-within:ring-2 focus-within:ring-emerald-500">
                <div className="pl-3 pr-2 text-neutral-500 text-xs">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
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

            <Button
              type="submit"
              variant="secondary"
              size="md"
              className="w-full"
              isLoading={isSubmitting}
            >
              Увійти в кабінет
            </Button>

            {/* Optional Google Auth behind feature flag */}
            {FEATURE_FLAG_GOOGLE_AUTH && (
              <Button
                type="button"
                variant="outline"
                size="md"
                className="w-full"
                onClick={() => setError('Google OAuth доступний для корпоративного підключення')}
              >
                Увійти через Google
              </Button>
            )}
          </form>

          <div className="text-center text-xs text-neutral-500 dark:text-neutral-400 pt-2 border-t border-neutral-200 dark:border-neutral-800">
            <span>Ще немає акаунта? </span>
            <NavLink
              to="/auth/register"
              className="font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 underline"
            >
              Зареєструватися
            </NavLink>
          </div>
        </div>
      </div>
    </div>
  );
};
