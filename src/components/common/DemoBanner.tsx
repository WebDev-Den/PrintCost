import React, { useState } from 'react';
import { Info, X, Database } from 'lucide-react';

export const DemoBanner: React.FC = () => {
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 text-amber-900 dark:text-amber-200 px-4 py-2 text-xs flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Database className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <div>
          <span className="font-semibold">Демонстраційний режим frontend:</span>{' '}
          <span>
            Дані зберігаються локально в браузері (localStorage). Production-сервер з Supabase Auth, PostgreSQL та парсером .gcode.3mf буде підключено на наступному етапі (Codex).
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
