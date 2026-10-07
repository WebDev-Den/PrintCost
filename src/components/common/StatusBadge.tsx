import React from 'react';
import { CheckCircle2, AlertCircle, Clock, Archive } from 'lucide-react';

interface StatusBadgeProps {
  status: 'complete' | 'incomplete' | 'warning' | 'archived' | 'info';
  label?: string;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, className = '' }) => {
  switch (status) {
    case 'complete':
      return (
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 ${className}`}
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>{label || 'Повний розрахунок'}</span>
        </span>
      );

    case 'incomplete':
      return (
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 ${className}`}
        >
          <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          <span>{label || 'Розрахунок неповний'}</span>
        </span>
      );

    case 'warning':
      return (
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 ${className}`}
        >
          <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          <span>{label || 'Потрібна увага'}</span>
        </span>
      );

    case 'archived':
      return (
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400 ${className}`}
        >
          <Archive className="w-3.5 h-3.5 text-neutral-400" />
          <span>{label || 'В архіві'}</span>
        </span>
      );

    case 'info':
    default:
      return (
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 ${className}`}
        >
          <span>{label}</span>
        </span>
      );
  }
};
