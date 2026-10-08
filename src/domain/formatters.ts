/**
 * Formatting and input normalization helpers for uk-UA locale.
 */

export function formatUah(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return '— грн';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (!Number.isFinite(num)) return '— грн';
  return (
    new Intl.NumberFormat('uk-UA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num) + ' грн'
  );
}

export function formatNumberUk(val: string | number | null | undefined, decimals = 2): string {
  if (val === null || val === undefined || val === '') return '—';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

export function formatDurationUk(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || !totalSeconds || totalSeconds < 0) return '0 год 00 хв';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours} год ${minutes.toString().padStart(2, '0')} хв`;
  }
  return `${minutes} хв ${seconds.toString().padStart(2, '0')} с`;
}

export function formatWeightUk(grams: string | number | null | undefined): string {
  if (grams === null || grams === undefined || grams === '') return '— г';
  const num = typeof grams === 'string' ? parseFloat(grams) : grams;
  if (!Number.isFinite(num)) return '— г';
  if (num >= 1000) {
    const kg = num / 1000;
    return `${formatNumberUk(kg, 3)} кг (${formatNumberUk(num, 1)} г)`;
  }
  return `${formatNumberUk(num, 1)} г`;
}

/**
 * Normalizes user input allowing both commas and dots for decimals.
 * Keeps partial input unchanged for editing; validation is separate.
 */
export function normalizeDecimalInput(input: string): string {
  if (!input) return '';
  // Replace comma with dot
  const replaced = input.replace(',', '.').trim();
  // Allow empty or negative or partial input like "12."
  return replaced;
}

/**
 * Validates whether string is a valid positive decimal number
 */
export function isValidDecimalString(val: string): boolean {
  if (!val.trim()) return false;
  const normalized = normalizeDecimalInput(val);
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized) && Number.isFinite(Number(normalized));
}
