import React, { useState } from 'react';
import { X, Database } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';

export const DemoBanner: React.FC = () => {
  const [isDismissed, setIsDismissed] = useState(false);
  const { isDemoSession } = useAuth();

  if (isDismissed || !isDemoSession) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 text-amber-900 dark:text-amber-200 px-4 py-2 text-xs flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Database className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <div>
          <span className="font-semibold">Демо-режим:</span>{' '}
          <span>
            Дані цього прикладу зберігаються лише в цьому браузері. Для роботи зі своїми даними увійдіть у власний акаунт.
          </span>
        </div>
      </div>
      <button
        onClick={() => setIsDismissed(true)}
        className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-white p-1 ml-3"
        aria-label="Приховати повідомлення"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
