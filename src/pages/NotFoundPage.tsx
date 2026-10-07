import React from 'react';
import { NavLink } from 'react-router-dom';
import { Compass, ArrowLeft } from 'lucide-react';
import { Button } from '../components/common/Button.tsx';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-neutral-100/70 dark:bg-neutral-950 flex flex-col items-center justify-center p-4 text-center space-y-4">
      <div className="w-14 h-14 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-emerald-600 flex items-center justify-center shadow-xs">
        <Compass className="w-7 h-7" />
      </div>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">404 — Сторінку не знайдено</h1>
        <p className="text-xs text-neutral-500 max-w-sm">
          Запитувана сторінка або розрахунок не існує або була переміщена.
        </p>
      </div>
      <NavLink to="/app/dashboard">
        <Button variant="primary" size="sm" leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}>
          Повернутися в кабінет
        </Button>
      </NavLink>
    </div>
  );
};
