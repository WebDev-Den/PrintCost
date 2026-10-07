import React from 'react';
import { normalizeDecimalInput } from '../../domain/formatters.ts';

interface NumberInputProps {
  label?: string;
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  unit?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: string | number;
  disabled?: boolean;
  error?: string;
  helperText?: string;
  className?: string;
  id?: string;
}

export const NumberInput: React.FC<NumberInputProps> = ({
  label,
  value,
  onChange,
  unit,
  placeholder = '0.00',
  min,
  max,
  disabled,
  error,
  helperText,
  className = '',
  id,
}) => {
  const generatedId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  const displayValue = value === null || value === undefined ? '' : String(value);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const normalized = normalizeDecimalInput(raw);
    onChange(normalized);
  };

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
        <input
          id={generatedId}
          type="text"
          inputMode="decimal"
          value={displayValue}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          min={min}
          max={max}
          className={`w-full px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 bg-transparent placeholder-neutral-400 font-mono tabular-nums focus:outline-none disabled:opacity-50 disabled:bg-neutral-50 dark:disabled:bg-neutral-800 rounded-lg ${
            error ? 'border-red-500 ring-1 ring-red-500' : ''
          } ${className}`}
        />

        {unit && (
          <div className="pr-3 pl-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 select-none whitespace-nowrap">
            {unit}
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
