import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Calculator,
  LayoutDashboard,
  Layers,
  Printer,
  History,
  Settings,
  User,
  Menu,
  X,
  LogOut,
  Moon,
  Sun,
  Compass,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useAppData } from '../../context/AppDataContext.tsx';
import { DemoBanner } from '../common/DemoBanner.tsx';

export const AppLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useAppData();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { to: '/app/dashboard', label: 'Огляд', icon: LayoutDashboard },
    { to: '/app/calculator', label: 'Калькулятор', icon: Calculator },
    { to: '/app/calculations', label: 'Історія розрахунків', icon: History },
    { to: '/app/materials', label: 'Матеріали', icon: Layers },
    { to: '/app/printers', label: 'Принтери', icon: Printer },
    { to: '/app/settings', label: 'Налаштування', icon: Settings },
    { to: '/app/account', label: 'Акаунт', icon: User },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const getPageTitle = () => {
    const current = navItems.find((item) => location.pathname.startsWith(item.to));
    if (location.pathname.startsWith('/app/onboarding')) return 'Початкове налаштування';
    if (location.pathname.includes('/calculations/')) return 'Деталі розрахунку';
    return current ? current.label : 'Кабінет';
  };

  return (
    <div className="min-h-screen bg-neutral-100/70 dark:bg-neutral-950 flex flex-col antialiased">
      <DemoBanner />

      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Sidebar (250px) */}
        <aside className="hidden lg:flex w-64 flex-col border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shrink-0">
          {/* Logo & Brand Zone */}
          <div className="h-14 px-5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
            <NavLink to="/app/dashboard" className="flex items-center gap-2 font-bold text-neutral-900 dark:text-white tracking-tight">
              <span className="w-7 h-7 rounded-md bg-emerald-600 text-white flex items-center justify-center text-xs font-mono font-bold">
                PC
              </span>
              <span className="text-base font-semibold">PrintCost</span>
            </NavLink>
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 text-neutral-500">
              FDM/FFF
            </span>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                      isActive
                        ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 font-semibold'
                        : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-800/60'
                    }`
                  }
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}

            <div className="pt-3 mt-3 border-t border-neutral-200 dark:border-neutral-800">
              <NavLink
                to="/app/onboarding"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                    isActive
                      ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white'
                      : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
                  }`
                }
              >
                <Compass className="w-4 h-4 shrink-0" />
                <span>Майстер налаштування</span>
              </NavLink>
            </div>
          </nav>

          {/* User Profile & Theme Drawer in Sidebar */}
          <div className="p-3 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50">
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="truncate pr-2">
                <p className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">
                  {user?.fullName || 'Майстерня'}
                </p>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                  {user?.workshopName || user?.email}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-800"
                title="Перемкнути тему"
                aria-label="Перемкнути тему"
              >
                {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>
            </div>

            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-neutral-600 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Вийти</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* Top Bar Header */}
          <header className="h-14 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 lg:px-8 flex items-center justify-between sticky top-0 z-30">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="lg:hidden p-1.5 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Відкрити меню"
              >
                <Menu className="w-5 h-5" />
              </button>
              <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                {getPageTitle()}
              </h1>
            </div>

            <div className="flex items-center gap-2">
              <NavLink
                to="/app/calculator"
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-xs"
              >
                <Calculator className="w-3.5 h-3.5" />
                <span>Новий розрахунок</span>
              </NavLink>
            </div>
          </header>

          {/* Page Content Viewport */}
          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-neutral-900/50 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-72 bg-white dark:bg-neutral-900 flex-1 flex flex-col max-w-xs shadow-xl z-10 border-r border-neutral-200 dark:border-neutral-800">
            <div className="h-14 px-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-neutral-900 dark:text-white">
                <span className="w-7 h-7 rounded-md bg-emerald-600 text-white flex items-center justify-center text-xs font-mono font-bold">
                  PC
                </span>
                <span>PrintCost</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-neutral-500 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800"
                aria-label="Закрити меню"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="p-3 space-y-1 flex-1 overflow-y-auto">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg ${
                        isActive
                          ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 font-semibold'
                          : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}

              <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800">
                <NavLink
                  to="/app/onboarding"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-2 text-xs font-medium text-neutral-600 dark:text-neutral-400"
                >
                  <Compass className="w-4 h-4 shrink-0" />
                  <span>Майстер налаштування</span>
                </NavLink>
              </div>
            </nav>

            <div className="p-4 border-t border-neutral-200 dark:border-neutral-800">
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 py-2 text-sm text-red-600 font-medium hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg"
              >
                <LogOut className="w-4 h-4" />
                <span>Вийти з кабінету</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
