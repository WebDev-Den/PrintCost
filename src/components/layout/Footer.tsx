import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAppData } from '../../context/AppDataContext.tsx';
import { Sun, Moon } from 'lucide-react';

export const Footer: React.FC = () => {
  const { theme, setTheme } = useAppData();

  return (
    <footer className="border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 py-8 px-4 sm:px-6 lg:px-8 mt-auto">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-500 dark:text-neutral-400">
        <div className="flex items-center gap-2">
          <span className="font-bold text-neutral-900 dark:text-neutral-100">KILO·G</span>
          <span>·</span>
          <span>Кожен грам на своєму місці — кабінет FDM/FFF розрахунку</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-6">
          <NavLink to="/privacy" className="hover:text-neutral-800 dark:hover:text-neutral-200">
            Дані та приватність
          </NavLink>
          <NavLink to="/filaments" className="hover:text-neutral-800 dark:hover:text-neutral-200">
            Каталог пластиків
          </NavLink>
          <NavLink to="/auth/login" className="hover:text-neutral-800 dark:hover:text-neutral-200">
            Вхід
          </NavLink>
          <NavLink to="/auth/register" className="hover:text-neutral-800 dark:hover:text-neutral-200">
            Реєстрація
          </NavLink>
          <NavLink to="/app/calculator" className="hover:text-neutral-800 dark:hover:text-neutral-200">
            Калькулятор
          </NavLink>
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors border border-neutral-200 dark:border-neutral-700"
            title={`Перемкнути на ${theme === 'dark' ? 'світлу' : 'темну'} тему`}
            aria-label="Перемкнути тему"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-500" />
                <span>Світла тема</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-neutral-500" />
                <span>Темна тема</span>
              </>
            )}
          </button>
        </div>
      </div>
    </footer>
  );
};
