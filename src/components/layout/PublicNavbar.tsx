import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.tsx';
import { useAppData } from '../../context/AppDataContext.tsx';
import { Button } from '../common/Button.tsx';
import { BrandLogo } from '../common/BrandLogo.tsx';
import { Menu, X, BookOpen, Sparkles, Layers, Calculator, Sun, Moon } from 'lucide-react';

export const PublicNavbar: React.FC = () => {
  const { user, enableDemoSession } = useAuth();
  const { theme, setTheme } = useAppData();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleOpenDemo = async () => {
    await enableDemoSession();
    navigate('/app/dashboard');
  };

  const handleOpenCalculator = async () => {
    setMobileMenuOpen(false);
    if (!user) {
      await enableDemoSession();
    }
    navigate('/app/calculator');
  };

  const isFilaments = location.pathname === '/filaments';

  return (
    <header className="h-16 border-b border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xs sticky top-0 z-40 px-4 sm:px-6 lg:px-8 flex items-center justify-between">
      {/* Zone 1: Single element brand wordmark */}
      <div className="flex items-center gap-6">
        <NavLink to="/" onClick={() => setMobileMenuOpen(false)}>
          <BrandLogo size="md" />
        </NavLink>

        {/* Prominent link to catalog in desktop header menu */}
        <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-neutral-600 dark:text-neutral-300">
          <NavLink
            to="/filaments"
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-3 py-1 rounded-lg transition-colors font-medium ${
                isActive
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800/60'
                  : 'text-neutral-700 dark:text-neutral-200 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`
            }
          >
            <BookOpen className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Каталог пластиків</span>
          </NavLink>

          <a href="/#features" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
            Можливості
          </a>
          <NavLink
            to="/app/calculator"
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-3 py-1 rounded-lg transition-colors font-medium ${
                isActive
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800/60'
                  : 'text-neutral-700 dark:text-neutral-200 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`
            }
            title="Калькулятор собівартості FDM 3D-друку"
          >
            <Calculator className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Розрахунок FDM</span>
          </NavLink>

          <a href="/#universal-3mf" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
            Файли .gcode.3mf
          </a>
        </nav>
      </div>

      {/* Zone 2: Actions & Mobile Hamburger button */}
      <div className="flex items-center gap-2.5">
        {/* On smaller screens, quick button directly to catalog if not already there */}
        {!isFilaments && (
          <NavLink
            to="/filaments"
            className="md:hidden flex items-center gap-1 text-xs font-semibold py-1.5 px-2.5 rounded-lg bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Каталог</span>
          </NavLink>
        )}

        {/* Theme Toggle Button */}
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-2 rounded-xl text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors border border-neutral-200 dark:border-neutral-700/80 flex items-center justify-center"
          title={`Перемкнути на ${theme === 'dark' ? 'світлу' : 'темну'} тему`}
          aria-label="Перемкнути тему оформлення"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-neutral-600 dark:text-neutral-300" />
          )}
        </button>

        <Button variant="outline" size="sm" onClick={handleOpenDemo} className="hidden sm:inline-flex">
          Демо
        </Button>
        <Button variant="primary" size="sm" onClick={() => navigate('/auth/login')}>
          Увійти
        </Button>

        {/* Mobile menu toggle */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          aria-label="Перемкнути мобільне меню"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile navigation drawer / dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-16 left-0 right-0 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 shadow-lg p-4 space-y-3 z-50">
          <nav className="flex flex-col space-y-1 text-sm">
            <NavLink
              to="/filaments"
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2.5 rounded-lg font-medium ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 font-bold'
                    : 'text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`
              }
            >
              <BookOpen className="w-4 h-4 text-emerald-600" />
              <span>Каталог філаментів (Виробники, Ціни, Профілі)</span>
            </NavLink>

            <a
              href="/#features"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-lg text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Можливості сервісу
            </a>
            <NavLink
              to="/app/calculator"
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 font-medium ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 font-bold'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`
              }
            >
              <Calculator className="w-4 h-4 text-emerald-600" />
              <span>Розрахунок FDM (Калькулятор)</span>
            </NavLink>
            <a
              href="/#universal-3mf"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-lg text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Універсальні файли .gcode.3mf
            </a>
          </nav>

          {/* Theme switcher row in mobile menu */}
          <div className="pt-2 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between px-1">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
              Тема оформлення
            </span>
            <div className="inline-flex rounded-lg border border-neutral-200 dark:border-neutral-700 p-0.5 bg-neutral-100 dark:bg-neutral-800">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                  theme === 'light'
                    ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-xs font-semibold'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-900'
                }`}
              >
                <Sun className="w-3.5 h-3.5 text-amber-500" />
                <span>Світла</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                  theme === 'dark'
                    ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-xs font-semibold'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-900'
                }`}
              >
                <Moon className="w-3.5 h-3.5 text-neutral-600 dark:text-indigo-400" />
                <span>Темна</span>
              </button>
            </div>
          </div>

          <div className="pt-2 border-t border-neutral-200 dark:border-neutral-800 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                setMobileMenuOpen(false);
                handleOpenDemo();
              }}
            >
              Переглянути демо
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="w-full"
              onClick={() => {
                setMobileMenuOpen(false);
                navigate('/app/calculator');
              }}
            >
              Калькулятор
            </Button>
          </div>
        </div>
      )}
    </header>
  );
};
