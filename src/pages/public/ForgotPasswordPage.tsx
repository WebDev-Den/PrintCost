import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react';
import { Input } from '../../components/common/Input.tsx';
import { Button } from '../../components/common/Button.tsx';
import { BrandLogo } from '../../components/common/BrandLogo.tsx';
import { authService, authErrorMessage } from '../../services/authService.ts';
import { useTurnstile } from '../../components/common/TurnstileChallenge.tsx';

export const ForgotPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const captcha = useTurnstile('forgot_password', !submitted);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || isLoading || !captcha.ready) return;

    setIsLoading(true);
    setError(null);
    try {
      await authService.forgotPassword(email, captcha.token);
      setSubmitted(true);
    } catch (error) {
      setError(authErrorMessage(error));
    } finally {
      captcha.reset();
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-100/70 dark:bg-neutral-950 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center space-y-2">
        <NavLink to="/" className="inline-flex items-center justify-center">
          <BrandLogo size="lg" />
        </NavLink>
        <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">
          Відновлення пароля
        </h2>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          Введіть адресу пошти для отримання інструкцій
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-neutral-900 py-8 px-6 shadow-sm border border-neutral-200 dark:border-neutral-800 rounded-2xl space-y-6">
          {submitted ? (
            <div className="space-y-4 text-center">
              <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                  Лист для скидання надіслано
                </h3>
                <p className="text-xs text-neutral-600 dark:text-neutral-400">
                  Якщо акаунт з адресою <strong className="text-neutral-900 dark:text-white">{email}</strong> існує, ви отримаєте посилання для створення нового пароля.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => navigate('/auth/login')}
              >
                Повернутися до входу
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
              <Input
                label="Ваша електронна пошта"
                type="email"
                placeholder="workshop@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                leftAddon={<Mail className="w-4 h-4" />}
                required
              />

              {captcha.field}

              <Button
                type="submit"
                variant="primary"
                size="md"
                className="w-full"
                isLoading={isLoading}
                disabled={!captcha.ready}
              >
                Надіслати посилання
              </Button>

              <div className="text-center pt-2">
                <NavLink
                  to="/auth/login"
                  className="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Повернутися назад</span>
                </NavLink>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
