import React, { useState, useEffect, useRef } from 'react';
import { Navigate, NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
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
  BookOpen,
  ShieldCheck,
  PanelLeftClose,
  ChevronLeft,
  ChevronRight,
  Loader2,
  BarChart3,
  KeyRound,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useAppData } from '../../context/AppDataContext.tsx';
import { DemoBanner } from '../common/DemoBanner.tsx';
import { BrandLogo } from '../common/BrandLogo.tsx';
import { ErrorPage } from '../../pages/ErrorPage.tsx';
import { authErrorMessage } from '../../services/authService.ts';
import { useDialogFocus } from '../common/useDialogFocus.ts';

export const AppLayout: React.FC = () => {
  const { user, logout, isLoading: authLoading, isDemoSession, authError, reloadUser } = useAuth();
  const { theme, setTheme, isLoading, loadError, actionError, clearActionError, retryLoad } = useAppData();
  const navigate = useNavigate();
  const location = useLocation();
  const canManageCatalog = !isDemoSession && user?.isAdmin === true;

  // Mobile menu drawer state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  useDialogFocus(mobileMenuRef, mobileMenuOpen, () => setMobileMenuOpen(false));
  useEffect(() => { setMobileMenuOpen(false); }, [location.pathname, user?.id, user?.isBlocked, user?.deletionPending]);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  // Desktop sidebar collapsed state (persistent in localStorage)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('kilog_sidebar_collapsed');
      if (saved !== null) return saved === 'true';
      return localStorage.getItem('kilog_sidebar_hidden') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('kilog_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  // Keyboard shortcut Ctrl+B or Cmd+B to toggle sidebar collapse
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const navItems = [
    { to: '/app/dashboard', label: 'Огляд', icon: LayoutDashboard },
    { to: '/app/calculator', label: 'Калькулятор', icon: Calculator },
    { to: '/app/templates', label: 'Шаблони розрахунку', icon: BookOpen },
    { to: '/app/calculations', label: 'Історія розрахунків', icon: History },
    { to: '/app/materials', label: 'Матеріали', icon: Layers },
    { to: '/filaments', label: 'Каталог пластиків', icon: BookOpen },
    { to: '/app/admin/catalog', label: 'Адмінка каталогу', icon: ShieldCheck },
    { to: '/app/admin/access', label: 'Користувачі та компанії', icon: ShieldCheck },
    { to: '/app/company/offers', label: 'Пропозиції компанії', icon: Layers },
    { to: '/app/analytics', label: 'Аналітика каталогу', icon: BarChart3 },
    { to: '/app/api', label: 'API та імпорт', icon: KeyRound },
    { to: '/app/printers', label: 'Принтери', icon: Printer },
    { to: '/app/settings', label: 'Налаштування', icon: Settings },
    { to: '/app/account', label: 'Акаунт', icon: User },
  ].filter((item) => (!item.to.startsWith('/app/admin') || canManageCatalog)
    && (!['/app/company/offers', '/app/analytics', '/app/api'].includes(item.to) || (!isDemoSession && (user?.role === 'manager' || user?.role === 'admin'))));

  const handleLogout = async () => {
    setLogoutError(null);
    try { await logout(); navigate('/'); }
    catch (error) { setLogoutError(authErrorMessage(error)); }
  };

  const getPageTitle = () => {
    const current = navItems.find((item) => location.pathname.startsWith(item.to));
    if (location.pathname.startsWith('/app/onboarding')) return 'Початкове налаштування';
    if (location.pathname.includes('/calculations/')) return 'Деталі розрахунку';
    return current ? current.label : 'Кабінет';
  };

  if (authLoading) return <div role="status" className="p-12 flex justify-center"><Loader2 className="animate-spin" aria-label="Завантаження акаунту" /></div>;
  if (authError) return <ErrorPage error={new Error(authError)} resetErrorBoundary={() => { void reloadUser(); }} />;
  if (!user) return <Navigate to="/auth/login" state={{ from: location }} replace />;
  if (!isDemoSession && user.deletionPending) return <Navigate to="/auth/delete-account" replace />;
  if (!isDemoSession && user.isBlocked) return <div className="min-h-screen flex items-center justify-center bg-neutral-100 dark:bg-neutral-950 p-6">
    <div className="max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 space-y-4">
      <h1 className="text-lg font-semibold text-neutral-900 dark:text-white">Доступ до акаунта призупинено</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">Адміністратор обмежив доступ для {user.email}. Зверніться до адміністратора системи.</p>
      {logoutError && <p role="alert" className="text-sm text-red-600">{logoutError}</p>}
      <button className="text-sm underline text-emerald-600" onClick={handleLogout}>Вийти з акаунта</button>
      <NavLink className="block text-sm underline text-red-600" to="/auth/delete-account">Видалити власний акаунт</NavLink>
    </div>
  </div>;
  if (!isDemoSession && !user.emailVerified) return <Navigate to="/auth/check-email" replace />;
  if (isLoading) return <div role="status" className="p-12 flex justify-center"><Loader2 className="animate-spin" aria-label="Завантаження даних" /></div>;
  if (loadError) return <ErrorPage error={new Error(loadError)} resetErrorBoundary={retryLoad} />;
  if (location.pathname.startsWith('/app/admin') && !canManageCatalog) return <Navigate to="/app/dashboard" replace />;
  if (location.pathname.startsWith('/app/company') && (isDemoSession || !['manager', 'admin'].includes(user.role || 'user'))) return <Navigate to="/app/dashboard" replace />;
  if (location.pathname.startsWith('/app/analytics') && (isDemoSession || !['manager', 'admin'].includes(user.role || 'user'))) return <Navigate to="/app/dashboard" replace />;
  if (location.pathname.startsWith('/app/api') && (isDemoSession || !['manager', 'admin'].includes(user.role || 'user'))) return <Navigate to="/app/dashboard" replace />;

  return (
    <div className="min-h-screen bg-neutral-100/70 dark:bg-neutral-950 flex flex-col antialiased">
      <DemoBanner />

      <div className="flex-1 flex overflow-hidden relative">
        {/* Desktop Sidebar (Full w-64 or Collapsed Icon-only Rail w-16) */}
        <aside
          className={`hidden lg:flex flex-col border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shrink-0 transition-[width] duration-300 ease-in-out ${
            sidebarCollapsed ? 'w-16' : 'w-64'
          }`}
        >
          {/* Logo & Brand Zone + Collapse Button */}
          {sidebarCollapsed ? (
            <div className="h-14 px-2 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-center">
              <NavLink to="/app/dashboard" title="KILO·G — На головну" className="flex items-center justify-center">
                <BrandLogo size="sm" iconOnly />
              </NavLink>
            </div>
          ) : (
            <div className="h-14 px-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
              <NavLink to="/app/dashboard" className="truncate">
                <BrandLogo size="sm" />
              </NavLink>
              <button
                type="button"
                onClick={toggleSidebar}
                className="p-1.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
                title="Згорнути меню (Ctrl+B)"
                aria-label="Згорнути меню"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Navigation Links with visible icons always */}
          <nav className={`flex-1 ${sidebarCollapsed ? 'px-2' : 'px-3'} py-3 space-y-1 overflow-y-auto overflow-x-hidden`}>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={item.label}
                  className={({ isActive }) =>
                    `flex items-center ${
                      sidebarCollapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2'
                    } text-sm font-medium rounded-xl transition-all ${
                      isActive
                        ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 font-semibold shadow-2xs'
                        : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-800/60'
                    }`
                  }
                >
                  <Icon className={`${sidebarCollapsed ? 'w-5 h-5' : 'w-4 h-4'} shrink-0`} />
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                </NavLink>
              );
            })}

            <div className={`pt-2 mt-2 border-t border-neutral-200 dark:border-neutral-800 ${sidebarCollapsed ? 'px-0' : ''}`}>
              <NavLink
                to="/app/onboarding"
                title="Майстер налаштування"
                className={({ isActive }) =>
                  `flex items-center ${
                    sidebarCollapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2'
                  } text-xs font-medium rounded-xl transition-all ${
                    isActive
                      ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-semibold'
                      : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
                  }`
                }
              >
                <Compass className={`${sidebarCollapsed ? 'w-5 h-5' : 'w-4 h-4'} shrink-0`} />
                {!sidebarCollapsed && <span className="truncate">Майстер налаштування</span>}
              </NavLink>
            </div>
          </nav>

          {/* User Profile & Controls in Sidebar */}
          {sidebarCollapsed ? (
            <div className="p-2 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/60 flex flex-col items-center gap-1.5">
              <NavLink
                to="/app/account"
                title={`Акаунт: ${user?.fullName || user?.email || 'Майстерня'}`}
                className="flex items-center justify-center w-10 h-10 rounded-xl text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <User className="w-4 h-4" />
              </NavLink>

              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                title={`Тема: ${theme === 'dark' ? 'Світла' : 'Темна'}`}
                className="flex items-center justify-center w-10 h-10 rounded-xl text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                aria-label="Перемкнути тему"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={handleLogout}
                title="Вийти з акаунту"
                className="flex items-center justify-center w-10 h-10 rounded-xl text-neutral-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                aria-label="Вийти"
              >
                <LogOut className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={toggleSidebar}
                title="Розгорнути меню (Ctrl+B)"
                className="flex items-center justify-center w-10 h-10 mt-1 rounded-xl text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 transition-colors"
                aria-label="Розгорнути меню"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="p-3 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50">
              <div className="flex items-center justify-between mb-2 px-1">
                <NavLink to="/app/account" className="truncate pr-2 hover:opacity-80 transition-opacity block flex-1">
                  <p className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">
                    {user?.fullName || 'Майстерня'}
                  </p>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                    {user?.workshopName || user?.email}
                  </p>
                </NavLink>

                <button
                  type="button"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
                  title="Перемкнути тему"
                  aria-label="Перемкнути тему"
                >
                  {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-500" /> : <Moon className="w-3.5 h-3.5" />}
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleLogout}
                  className="flex-1 flex items-center gap-2 px-2.5 py-1.5 text-xs text-neutral-600 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Вийти</span>
                </button>

                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="p-1.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md transition-colors"
                  title="Згорнути меню (Ctrl+B)"
                  aria-label="Згорнути меню"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* Top Bar Header */}
          <header className="h-14 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-3 sticky top-0 z-30">
            <div className="flex-1 flex items-center gap-2 sm:gap-3 min-w-0">
              {/* Mobile hamburger button */}
              <button
                type="button"
                className="lg:hidden p-1.5 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Відкрити меню"
              >
                <Menu className="w-5 h-5" />
              </button>


              <h1 className="text-sm sm:text-base font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                {getPageTitle()}
              </h1>
            </div>

            <div className="shrink-0 flex items-center gap-2">
              {/* Quick Theme Switcher in Header */}
              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors border border-neutral-200 dark:border-neutral-700"
                title={`Перемкнути на ${theme === 'dark' ? 'світлу' : 'темну'} тему`}
                aria-label="Перемкнути тему"
              >
                {theme === 'dark' ? (
                  <Sun className="w-4 h-4 text-amber-500" />
                ) : (
                  <Moon className="w-4 h-4 text-neutral-600 dark:text-neutral-300" />
                )}
              </button>

              <NavLink
                to="/filaments"
                aria-label="Каталог пластиків"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors border border-neutral-200 dark:border-neutral-700"
              >
                <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
                <span className="hidden sm:inline">Каталог пластиків</span>
                <span className="hidden min-[400px]:inline sm:hidden">Каталог</span>
              </NavLink>

              <NavLink
                to="/app/calculator"
                aria-label="Новий розрахунок"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-xs"
              >
                <Calculator className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Новий розрахунок</span>
                <span className="hidden min-[400px]:inline sm:hidden">Розрахунок</span>
              </NavLink>
            </div>
          </header>

          {/* Page Content Viewport with Responsive Max-Width */}
          <main className="flex-1 p-3 sm:p-5 lg:p-6 w-full mx-auto max-w-full">
            {logoutError && <p role="alert" className="mb-4 p-3 rounded-lg bg-red-50 text-red-700">{logoutError}</p>}
            {actionError && <div role="alert" className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 flex items-center justify-between gap-3"><span>{actionError}</span><button onClick={clearActionError} aria-label="Закрити повідомлення"><X className="w-4 h-4" /></button></div>}
            <Outlet key={isDemoSession ? 'demo' : user.id} />
          </main>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-neutral-900/50 backdrop-blur-xs animate-in fade-in duration-200"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div ref={mobileMenuRef} role="dialog" aria-modal="true" aria-label="Навігація кабінету" tabIndex={-1} className="relative w-72 bg-white dark:bg-neutral-900 flex-1 flex flex-col max-w-xs shadow-xl z-10 border-r border-neutral-200 dark:border-neutral-800">
            <div className="h-14 px-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
              <BrandLogo size="sm" />
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

            <div className="p-4 border-t border-neutral-200 dark:border-neutral-800 space-y-2">
              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="w-full flex items-center justify-center gap-2 py-2 text-xs text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 rounded-lg"
              >
                {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                <span>{theme === 'dark' ? 'Світла тема' : 'Темна тема'}</span>
              </button>
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
