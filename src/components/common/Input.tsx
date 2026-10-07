import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftAddon?: React.ReactNode;
  rightAddon?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  leftAddon,
  rightAddon,
  id,
  className = '',
  disabled,
  ...props
}) => {
  const generatedId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="w-full space-y-1.5">
      {label && (
        <label
          htmlFor={generatedId}
          className="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
        >
          {label}
        </label>
      )}

      <div className="relative flex items-center rounded-lg border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900 focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500 transition-shadow">
        {leftAddon && (
          <div className="pl-3 pr-2 text-neutral-500 dark:text-neutral-400 select-none text-xs">
            {leftAddon}
          </div>
        )}

        <input
          id={generatedId}
          disabled={disabled}
          className={`w-full px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 bg-transparent placeholder-neutral-400 focus:outline-none disabled:opacity-50 disabled:bg-neutral-50 dark:disabled:bg-neutral-800 rounded-lg ${
            error ? 'border-red-500 ring-1 ring-red-500' : ''
          } ${className}`}
          {...props}
        />

        {rightAddon && (
          <div className="pr-3 pl-2 text-neutral-500 dark:text-neutral-400 select-none text-xs">
            {rightAddon}
          </div>
        )}
      </div>

      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400 font-medium">{error}</p>
      ) : helperText ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{helperText}</p>
      ) : null}
    </div>
  );
};
