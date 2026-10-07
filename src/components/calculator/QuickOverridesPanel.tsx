import React from 'react';
import { Sliders, Save, AlertCircle } from 'lucide-react';
import { NumberInput } from '../common/NumberInput.tsx';
import { Button } from '../common/Button.tsx';
import type { CalculationInput, PricingMode, RoundingMode } from '../../domain/types.ts';

export type QuickOverrideKey =
  | 'averagePowerWatts'
  | 'electricityTariffUahPerKwh'
  | 'machineHourlyRateUah'
  | 'operatorFeeUah'
  | 'packagingFeeUah'
  | 'postProcessingFeeUah'
  | 'otherFeeUah'
  | 'scrapReservePercent'
  | 'pricingMode'
  | 'markupPercent'
  | 'marginPercent'
  | 'minOrderPriceUah'
  | 'roundingMode';

interface QuickOverridesPanelProps {
  input: CalculationInput;
  onChangeInput: (key: QuickOverrideKey, value: any) => void;
  onSaveAsDefault: () => void;
}

export const QuickOverridesPanel: React.FC<QuickOverridesPanelProps> = ({
  input,
  onChangeInput,
  onSaveAsDefault,
}) => {
  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 space-y-4 shadow-2xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-3">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Швидкі параметри для цього розрахунку
          </h3>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          leftIcon={<Save className="w-3.5 h-3.5" />}
          onClick={onSaveAsDefault}
          title="Застосувати поточні значення як глобальні за замовчуванням"
        >
          Зберегти як типове
        </Button>
      </div>

      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        Тимчасове перевизначення параметрів діє для цього замовлення і не змінює ваш каталог матеріалів та принтерів.
      </p>

      {/* Grid of inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {/* Electricity Tariff */}
        <NumberInput
          label="Тариф електроенергії"
          unit="грн/кВт·год"
          value={input.electricityTariffUahPerKwh ?? ''}
          onChange={(v) => onChangeInput('electricityTariffUahPerKwh', v)}
          placeholder="5.00"
        />

        {/* Average Power */}
        <NumberInput
          label="Середня потужність"
          unit="Вт"
          value={input.averagePowerWatts}
          onChange={(v) => onChangeInput('averagePowerWatts', v)}
          placeholder="100"
          helperText="Задається вами, а не пікове споживання"
        />

        {/* Machine Rate */}
        <NumberInput
          label="Машинна ставка принтера"
          unit="грн/год"
          value={input.machineHourlyRateUah}
          onChange={(v) => onChangeInput('machineHourlyRateUah', v)}
          placeholder="10.00"
        />

        {/* Operator Fee */}
        <NumberInput
          label="Робота оператора (на все замовлення)"
          unit="грн"
          value={input.operatorFeeUah}
          onChange={(v) => onChangeInput('operatorFeeUah', v)}
          placeholder="20.00"
        />

        {/* Packaging Fee */}
        <NumberInput
          label="Пакування"
          unit="грн"
          value={input.packagingFeeUah}
          onChange={(v) => onChangeInput('packagingFeeUah', v)}
          placeholder="0.00"
        />

        {/* Post Processing Fee */}
        <NumberInput
          label="Постобробка"
          unit="грн"
          value={input.postProcessingFeeUah}
          onChange={(v) => onChangeInput('postProcessingFeeUah', v)}
          placeholder="0.00"
        />

        {/* Contingency Reserve */}
        <NumberInput
          label="Резерв браку та ризику"
          unit="%"
          value={input.scrapReservePercent}
          onChange={(v) => onChangeInput('scrapReservePercent', v)}
          placeholder="10"
        />

        {/* Pricing Mode Selection */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
            Метод ціноутворення
          </label>
          <select
            value={input.pricingMode}
            onChange={(e) => onChangeInput('pricingMode', e.target.value as PricingMode)}
            className="w-full py-2 px-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="markup">Націнка на собівартість (%)</option>
            <option value="target_margin">Цільова маржа від продажу (%)</option>
          </select>
        </div>

        {/* Percentage Input depending on mode */}
        {input.pricingMode === 'markup' ? (
          <NumberInput
            label="Націнка на собівартість"
            unit="%"
            value={input.markupPercent}
            onChange={(v) => onChangeInput('markupPercent', v)}
            placeholder="100"
          />
        ) : (
          <NumberInput
            label="Цільова маржа (до 99%)"
            unit="%"
            value={input.marginPercent}
            onChange={(v) => onChangeInput('marginPercent', v)}
            placeholder="50"
            helperText="Маржа 100% неможлива математично"
          />
        )}

        {/* Minimum Order */}
        <NumberInput
          label="Мінімальне замовлення"
          unit="грн"
          value={input.minOrderPriceUah}
          onChange={(v) => onChangeInput('minOrderPriceUah', v)}
          placeholder="200"
        />

        {/* Rounding Mode */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
            Округлення ціни клієнту
          </label>
          <select
            value={input.roundingMode}
            onChange={(e) => onChangeInput('roundingMode', e.target.value as RoundingMode)}
            className="w-full py-2 px-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="none">Без округлення (до копійок)</option>
            <option value="up_1">Вгору до 1 грн</option>
            <option value="up_5">Вгору до 5 грн</option>
            <option value="up_10">Вгору до 10 грн (стандарт)</option>
            <option value="up_50">Вгору до 50 грн</option>
            <option value="up_100">Вгору до 100 грн</option>
          </select>
        </div>
      </div>
    </div>
  );
};
