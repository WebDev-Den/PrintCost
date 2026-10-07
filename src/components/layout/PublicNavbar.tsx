import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.tsx';
import { Button } from '../common/Button.tsx';

export const PublicNavbar: React.FC = () => {
  const { enableDemoSession } = useAuth();
  const navigate = useNavigate();

  const handleOpenDemo = async () => {
    await enableDemoSession();
    navigate('/app/dashboard');
  };

  return (
    <header className="h-16 border-b border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xs sticky top-0 z-40 px-4 sm:px-6 lg:px-8 flex items-center justify-between">
      {/* Zone 1: Single element brand wordmark */}
      <NavLink
        to="/"
        className="flex items-center gap-2 text-lg font-bold tracking-tight text-neutral-900 dark:text-white"
      >
        <span className="w-7 h-7 rounded-md bg-emerald-600 text-white flex items-center justify-center text-xs font-mono font-bold">
          PC
        </span>
        <span>PrintCost</span>
      </NavLink>

      {/* Zone 2: 4-6 text links */}
      <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-neutral-600 dark:text-neutral-300">
        <a href="#features" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
          Можливості
        </a>
        <a href="#calculation" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
          Розрахунок FDM
        </a>
        <a href="#bambu-format" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
          Формат .gcode.3mf
        </a>
        <a href="#workflow" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
          Процес роботи
        </a>
      </nav>

      {/* Zone 3: 1-2 primary actions */}
      <div className="flex items-center gap-2.5">
        <Button variant="outline" size="sm" onClick={handleOpenDemo}>
          Переглянути демо
        </Button>
        <Button variant="primary" size="sm" onClick={() => navigate('/auth/login')}>
          Увійти
        </Button>
      </div>
    </header>
  );
};
