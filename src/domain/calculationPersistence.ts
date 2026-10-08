import { Decimal } from 'decimal.js';
import { normalizeDecimalInput } from './formatters.ts';
import type { CalculationInput } from './types.ts';

export function getRecalculationTitle(title: string, date = new Date()): string {
  const suffix = ` (оновлені тарифи ${date.toLocaleDateString('uk-UA')})`;
  return `${title.slice(0, 300 - suffix.length)}${suffix}`;
}

const REQUIRED_AMOUNTS = {
  averagePowerWatts: 'Потужність принтера',
  machineHourlyRateUah: 'Машинна ставка',
  operatorFeeUah: 'Робота оператора',
  packagingFeeUah: 'Пакування',
  postProcessingFeeUah: 'Постобробка',
  otherFeeUah: 'Інші витрати',
  scrapReservePercent: 'Резерв браку',
  markupPercent: 'Націнка',
  marginPercent: 'Маржа',
  minOrderPriceUah: 'Мінімальне замовлення',
} as const;

// Incomplete material prices and an unknown electricity tariff are valid drafts.
// Other numeric parameters must fit the persisted Firestore input contract.
export function getCalculationSaveErrors(input: CalculationInput): string[] {
  const errors: string[] = [];
  const checkAmount = (value: unknown, label: string) => {
    const normalized = typeof value === 'string' ? normalizeDecimalInput(value) : '';
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
      errors.push(`${label}: введіть невід’ємне число.`);
    } else if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(new Decimal(normalized).toFixed())) {
      errors.push(`${label}: допускається до 12 цифр перед крапкою та 6 після неї.`);
    }
  };
  for (const [field, label] of Object.entries(REQUIRED_AMOUNTS)) checkAmount(input[field as keyof typeof REQUIRED_AMOUNTS], label);
  if (input.electricityTariffUahPerKwh !== null && input.electricityTariffUahPerKwh !== '') checkAmount(input.electricityTariffUahPerKwh, 'Тариф на електроенергію');
  if (typeof input.marginPercent === 'string' && /^\d+(?:\.\d*)?$/.test(normalizeDecimalInput(input.marginPercent)) && new Decimal(normalizeDecimalInput(input.marginPercent)).gte(100)) errors.push('Маржа: введіть значення менше 100%.');
  return errors;
}
