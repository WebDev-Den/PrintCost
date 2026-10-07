import React from 'react';
import { NavLink } from 'react-router-dom';

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 py-8 px-4 sm:px-6 lg:px-8 mt-auto">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-500 dark:text-neutral-400">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-neutral-800 dark:text-neutral-200">PrintCost</span>
          <span>·</span>
          <span>Особистий кабінет FDM/FFF розрахунку для майстерень</span>
        </div>
        <div className="flex items-center gap-6">
          <NavLink to="/auth/login" className="hover:text-neutral-800 dark:hover:text-neutral-200">
            Вхід
          </NavLink>
          <NavLink to="/auth/register" className="hover:text-neutral-800 dark:hover:text-neutral-200">
            Реєстрація
          </NavLink>
          <NavLink to="/app/calculator" className="hover:text-neutral-800 dark:hover:text-neutral-200">
            Калькулятор
          </NavLink>
        </div>
      </div>
    </footer>
  );
};
