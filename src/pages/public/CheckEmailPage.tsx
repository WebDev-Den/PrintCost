import React from 'react';
import { NavLink } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';
import { Button } from '../../components/common/Button.tsx';

export const CheckEmailPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-neutral-100/70 dark:bg-neutral-950 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md bg-white dark:bg-neutral-900 p-8 rounded-2xl border border-neutral-200 dark:border-neutral-800 text-center space-y-4">
        <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
          <Mail className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-neutral-900 dark:text-white">
          Перевірте вашу поштову скриньку
        </h2>
        <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
          Ми надіслали лист із підтвердженням реєстрації. Перейдіть за посиланням у листі для активації доступу.
        </p>
        <div className="pt-2">
          <NavLink to="/auth/login">
            <Button variant="outline" size="sm" className="w-full">
              Повернутися до входу
            </Button>
          </NavLink>
        </div>
      </div>
    </div>
  );
};
