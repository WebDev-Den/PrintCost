import React, { useState } from 'react';
import {
  Copy,
  Check,
  Save,
  FileDown,
  Share2,
  HelpCircle,
  AlertTriangle,
  Info,
} from 'lucide-react';
import type { CalculationResult, CalculationInput, PricingMode, RoundingMode } from '../../domain/types.ts';
import { formatUah, formatNumberUk } from '../../domain/formatters.ts';
import { Button } from '../common/Button.tsx';
import { StatusBadge } from '../common/StatusBadge.tsx';

interface PricingSummaryCardProps {
  input: CalculationInput;
  result: CalculationResult;
  onSave: () => void;
  onOpenClientQuote: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  isSaving?: boolean;
}

export const PricingSummaryCard: React.FC<PricingSummaryCardProps> = ({
  input,
  result,
  onSave,
  onOpenClientQuote,
  onExportJson,
  onExportCsv,
  isSaving = false,
}) => {
  const [copiedPrice, setCopiedPrice] = useState(false);
  const [showPricingExplanation, setShowPricingExplanation] = useState(false);

  const handleCopyPrice = () => {
    navigator.clipboard.writeText(result.sellingPriceUah);
    setCopiedPrice(true);
    setTimeout(() => setCopiedPrice(false), 2000);
  };

  const isComplete = result.status === 'complete';

  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 space-y-5 shadow-sm sticky top-20">
      {/* Header status */}
      <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-3">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          Підсумок собівартості та ціни
        </h3>
        <StatusBadge status={result.status} />
      </div>

      {/* Incomplete calculation reasons */}
      {!isComplete && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-lg text-xs space-y-1 text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-1 font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Розрахунок неповний:</span>
          </div>
          <ul className="list-disc list-inside space-y-0.5 pl-1 text-[11px]">
            {result.incompleteReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Internal Cost Breakdown Lines */}
      <div className="space-y-2 text-xs">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          Складові базової собівартості
        </div>

        <div className="space-y-1.5 divide-y divide-neutral-100 dark:divide-neutral-800">
          {/* Materials */}
          <div className="pt-1.5 flex items-center justify-between">
            <span className="text-neutral-600 dark:text-neutral-400">Матеріали (філаменти):</span>
            <span className="font-mono tabular-nums font-semibold text-neutral-900 dark:text-neutral-100">
              {formatUah(result.materialsCostUah)}
            </span>
          </div>

          {/* Electricity */}
          <div className="pt-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1 text-neutral-600 dark:text-neutral-400">
              <span>Електроенергія</span>
              <span className="text-[10px] text-neutral-400 font-mono">
                ({result.totalEnergyKwh} кВт·год)
              </span>
            </div>
            <span className="font-mono tabular-nums font-semibold text-neutral-900 dark:text-neutral-100">
              {formatUah(result.electricityCostUah)}
            </span>
          </div>

          {/* Machine Time */}
          <div className="pt-1.5 flex items-center justify-between">
            <span className="text-neutral-600 dark:text-neutral-400">Машинний час (знос принтера):</span>
            <span className="font-mono tabular-nums font-semibold text-neutral-900 dark:text-neutral-100">
              {formatUah(result.machineCostUah)}
            </span>
          </div>

          {/* Operator */}
          <div className="pt-1.5 flex items-center justify-between">
            <span className="text-neutral-600 dark:text-neutral-400">Робота оператора:</span>
            <span className="font-mono tabular-nums font-semibold text-neutral-900 dark:text-neutral-100">
              {formatUah(result.operatorCostUah)}
            </span>
          </div>

          {/* Packaging */}
          {parseFloat(result.packagingCostUah) > 0 && (
            <div className="pt-1.5 flex items-center justify-between">
              <span className="text-neutral-600 dark:text-neutral-400">Пакування:</span>
              <span className="font-mono tabular-nums font-semibold text-neutral-900 dark:text-neutral-100">
                {formatUah(result.packagingCostUah)}
              </span>
            </div>
          )}

          {/* Post Processing */}
          {parseFloat(result.postProcessingCostUah) > 0 && (
            <div className="pt-1.5 flex items-center justify-between">
              <span className="text-neutral-600 dark:text-neutral-400">Постобробка:</span>
              <span className="font-mono tabular-nums font-semibold text-neutral-900 dark:text-neutral-100">
                {formatUah(result.postProcessingCostUah)}
              </span>
            </div>
          )}

          {/* Other */}
          {parseFloat(result.otherCostUah) > 0 && (
            <div className="pt-1.5 flex items-center justify-between">
              <span className="text-neutral-600 dark:text-neutral-400">Інші супутні витрати:</span>
              <span className="font-mono tabular-nums font-semibold text-neutral-900 dark:text-neutral-100">
                {formatUah(result.otherCostUah)}
              </span>
            </div>
          )}

          {/* Contingency / Scrap reserve */}
          <div className="pt-1.5 flex items-center justify-between text-neutral-700 dark:text-neutral-300">
            <div className="flex items-center gap-1">
              <span>Резерв браку та ризику</span>
              <span className="text-[10px] text-neutral-400 font-mono">
                ({input.scrapReservePercent}%)
              </span>
            </div>
            <span className="font-mono tabular-nums font-semibold">
              {formatUah(result.scrapReserveUah)}
            </span>
          </div>

          {/* Total Cost Price */}
          <div className="pt-2 flex items-center justify-between bg-neutral-50 dark:bg-neutral-800/60 p-2.5 rounded-lg border border-neutral-200/80 dark:border-neutral-700">
            <span className="font-semibold text-neutral-900 dark:text-neutral-100">
              Собівартість замовлення:
            </span>
            <span className="font-mono tabular-nums font-bold text-sm text-neutral-900 dark:text-neutral-100">
              {formatUah(result.costPriceUah)}
            </span>
          </div>
        </div>
      </div>

      {/* Pricing Rules & Method */}
      <div className="p-3 bg-neutral-50 dark:bg-neutral-800/40 rounded-lg border border-neutral-200 dark:border-neutral-800 space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
            <span className="font-medium">
              {input.pricingMode === 'markup'
                ? `Націнка на собівартість (+${input.markupPercent}%)`
                : `Цільова маржа (${input.marginPercent}%)`}
            </span>
            <button
              type="button"
              onClick={() => setShowPricingExplanation(!showPricingExplanation)}
              className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              title="Пояснення різниці націнки та маржі"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          </div>
          <span className="font-mono tabular-nums text-neutral-500">
            до окр.: {formatUah(result.preRoundingPriceUah)}
          </span>
        </div>

        {showPricingExplanation && (
          <div className="p-2.5 bg-white dark:bg-neutral-900 rounded border border-neutral-200 dark:border-neutral-700 text-[11px] space-y-1 text-neutral-600 dark:text-neutral-300">
            <p>
              <strong>Націнка (%):</strong> скільки відсотків додається до собівартості. Ціна = Собівартість × (1 + Націнка / 100).
            </p>
            <p>
              <strong>Цільова маржа (%):</strong> частка прибутку в кінцевій ціні продажу. Ціна = Собівартість / (1 - Маржа / 100).
            </p>
          </div>
        )}

        <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 text-[11px]">
          <span>Мінімальне замовлення: {formatUah(input.minOrderPriceUah)}</span>
          {result.minOrderApplied && (
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              (застосовано мінімум)
            </span>
          )}
        </div>
      </div>

      {/* Final Client Price Hero Card */}
      <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-2 text-center">
        <span className="text-xs uppercase tracking-wider font-semibold text-emerald-800 dark:text-emerald-300">
          Кінцева ціна для клієнта
        </span>
        <div className="text-3xl font-extrabold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
          {formatUah(result.sellingPriceUah)}
        </div>

        {/* Profit and margin indicators */}
        <div className="pt-2 border-t border-emerald-500/20 flex items-center justify-around text-xs font-mono tabular-nums">
          <div>
            <span className="text-neutral-500 dark:text-neutral-400 block text-[10px]">
              Прибуток (до податків)
            </span>
            <span className="font-semibold text-neutral-900 dark:text-neutral-100">
              +{formatUah(result.profitUah)}
            </span>
          </div>
          <div>
            <span className="text-neutral-500 dark:text-neutral-400 block text-[10px]">
              Маржинальність
            </span>
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
              {result.marginPercent}%
            </span>
          </div>
        </div>
      </div>

      {/* Primary Actions */}
      <div className="space-y-2 pt-1">
        <Button
          variant="primary"
          size="md"
          className="w-full"
          leftIcon={<Save className="w-4 h-4" />}
          onClick={onSave}
          isLoading={isSaving}
        >
          Зберегти розрахунок
        </Button>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={copiedPrice ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            onClick={handleCopyPrice}
          >
            {copiedPrice ? 'Скопійовано' : 'Копіювати ціну'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            leftIcon={<Share2 className="w-3.5 h-3.5" />}
            onClick={onOpenClientQuote}
          >
            Для клієнта
          </Button>
        </div>

        <div className="flex items-center justify-center gap-3 pt-2 text-xs text-neutral-500">
          <button
            type="button"
            onClick={onExportJson}
            className="hover:text-emerald-600 dark:hover:text-emerald-400 flex items-center gap-1 cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>Експорт JSON</span>
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={onExportCsv}
            className="hover:text-emerald-600 dark:hover:text-emerald-400 flex items-center gap-1 cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>Експорт CSV</span>
          </button>
        </div>
      </div>
    </div>
  );
};
