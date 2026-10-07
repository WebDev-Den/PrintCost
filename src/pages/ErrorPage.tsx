import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '../components/common/Button.tsx';

interface ErrorPageProps {
  error?: Error;
  resetErrorBoundary?: () => void;
}

export const ErrorPage: React.FC<ErrorPageProps> = ({ error, resetErrorBoundary }) => {
  return (
    <div className="min-h-screen bg-neutral-100/70 dark:bg-neutral-950 flex flex-col items-center justify-center p-4 text-center space-y-4">
      <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 text-red-600 flex items-center justify-center shadow-xs">
        <AlertTriangle className="w-7 h-7" />
      </div>
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-white">
          Виникла неочікувана помилка застосунку
        </h1>
        <p className="text-xs text-neutral-500 max-w-md">
          {error?.message || 'Сталася помилка при завантаженні даних або розрахунку.'}
        </p>
      </div>
      <Button
        variant="primary"
        size="sm"
        leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
        onClick={() => {
          if (resetErrorBoundary) resetErrorBoundary();
          else window.location.href = '/app/dashboard';
        }}
      >
        Перезавантажити кабінет
      </Button>
    </div>
  );
};
