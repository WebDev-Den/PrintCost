import React, { useState } from 'react';
import {
  Copy,
  Check,
  Save,
  FileDown,
  Share2,
  HelpCircle,
  AlertTriangle,
  FileSpreadsheet,
  Coins,
  TrendingUp,
  Percent,
} from 'lucide-react';
import type { CalculationResult, CalculationInput } from '../../domain/types.ts';
import { formatUah } from '../../domain/formatters.ts';
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
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5 sm:p-6 space-y-5 shadow-sm sticky top-20">
      {/* Header status */}
      <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-3">
        <div className="flex items-center gap-2">
          <Coins className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
            Підсумок розрахунку
          </h3>
        </div>
        <StatusBadge status={result.status} />
      </div>

      {/* Incomplete calculation reasons */}
      {!isComplete && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-xl text-xs space-y-1 text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Розрахунок неповний:</span>
          </div>
          <ul className="list-disc list-inside space-y-0.5 pl-1 text-[11px] leading-relaxed">
            {result.incompleteReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Internal Cost Breakdown Lines */}
      <div className="space-y-2 text-xs">
        <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          Складові базової собівартості
        </div>

        <div className="space-y-2 divide-y divide-neutral-100 dark:divide-neutral-800/80">
          {/* Materials */}
          <div className="pt-2 flex items-center justify-between">
            <span className="text-neutral-600 dark:text-neutral-300">Матеріали (філаменти):</span>
            <span className="font-mono tabular-nums font-bold text-neutral-900 dark:text-neutral-100">
              {formatUah(result.materialsCostUah)}
            </span>
          </div>

          {/* Electricity */}
          <div className="pt-2 flex items-center justify-between">
            <div className="flex items-center gap-1 text-neutral-600 dark:text-neutral-300">
              <span>Електроенергія</span>
              <span className="text-[10px] text-neutral-400 font-mono">
                ({result.totalEnergyKwh} кВт·год)
              </span>
            </div>
            <span className="font-mono tabular-nums font-bold text-neutral-900 dark:text-neutral-100">
              {formatUah(result.electricityCostUah)}
            </span>
          </div>

          {/* Machine Time */}
          <div className="pt-2 flex items-center justify-between">
            <span className="text-neutral-600 dark:text-neutral-300">Машинний час (амортизація):</span>
            <span className="font-mono tabular-nums font-bold text-neutral-900 dark:text-neutral-100">
              {formatUah(result.machineCostUah)}
            </span>
          </div>

          {/* Operator */}
          <div className="pt-2 flex items-center justify-between">
            <span className="text-neutral-600 dark:text-neutral-300">Робота оператора:</span>
            <span className="font-mono tabular-nums font-bold text-neutral-900 dark:text-neutral-100">
              {formatUah(result.operatorCostUah)}
            </span>
          </div>

          {/* Packaging */}
          {parseFloat(result.packagingCostUah) > 0 && (
            <div className="pt-2 flex items-center justify-between">
              <span className="text-neutral-600 dark:text-neutral-300">Пакування:</span>
              <span className="font-mono tabular-nums font-bold text-neutral-900 dark:text-neutral-100">
                {formatUah(result.packagingCostUah)}
              </span>
            </div>
          )}

          {/* Post Processing */}
          {parseFloat(result.postProcessingCostUah) > 0 && (
            <div className="pt-2 flex items-center justify-between">
              <span className="text-neutral-600 dark:text-neutral-300">Постобробка:</span>
              <span className="font-mono tabular-nums font-bold text-neutral-900 dark:text-neutral-100">
                {formatUah(result.postProcessingCostUah)}
              </span>
            </div>
          )}

          {/* Other */}
          {parseFloat(result.otherCostUah) > 0 && (
            <div className="pt-2 flex items-center justify-between">
              <span className="text-neutral-600 dark:text-neutral-300">Інші супутні витрати:</span>
              <span className="font-mono tabular-nums font-bold text-neutral-900 dark:text-neutral-100">
                {formatUah(result.otherCostUah)}
              </span>
            </div>
          )}

          {/* Contingency / Scrap reserve */}
          <div className="pt-2 flex items-center justify-between text-neutral-700 dark:text-neutral-300">
            <div className="flex items-center gap-1">
              <span>Резерв браку та ризику</span>
              <span className="text-[10px] text-neutral-400 font-mono">
                ({input.scrapReservePercent}%)
              </span>
            </div>
            <span className="font-mono tabular-nums font-bold text-neutral-800 dark:text-neutral-200">
              {formatUah(result.scrapReserveUah)}
            </span>
          </div>

          {/* Total Cost Price */}
          <div className="pt-2.5 flex items-center justify-between bg-neutral-100/70 dark:bg-neutral-800/80 p-3 rounded-xl border border-neutral-200 dark:border-neutral-700">
            <span className="font-bold text-neutral-900 dark:text-neutral-100">
              Собівартість замовлення:
            </span>
            <span className="font-mono tabular-nums font-black text-base text-neutral-900 dark:text-neutral-100">
              {formatUah(result.costPriceUah)}
            </span>
          </div>
        </div>
      </div>

      {/* Pricing Rules & Method */}
      <div className="p-3 bg-neutral-50 dark:bg-neutral-800/40 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
            <span className="font-semibold">
              {input.pricingMode === 'markup'
                ? `Націнка (+${input.markupPercent}%)`
                : `Цільова маржа (${input.marginPercent}%)`}
            </span>
            <button
              type="button"
              onClick={() => setShowPricingExplanation(!showPricingExplanation)}
              className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
              title="Пояснення різниці націнки та маржі"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          </div>
          <span className="font-mono tabular-nums text-neutral-500 text-[11px]">
            до окр.: {formatUah(result.preRoundingPriceUah)}
          </span>
        </div>

        {showPricingExplanation && (
          <div className="p-2.5 bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-700 text-[11px] space-y-1 text-neutral-600 dark:text-neutral-300">
            <p>
              <strong>Націнка (%):</strong> скільки додається до собівартості. Ціна = Собівартість × (1 + Націнка / 100).
            </p>
            <p>
              <strong>Цільова маржа (%):</strong> частка прибутку у фінальній ціні. Ціна = Собівартість / (1 - Маржа / 100).
            </p>
          </div>
        )}

        <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 text-[11px]">
          <span>Мінімальне замовлення: {formatUah(input.minOrderPriceUah)}</span>
          {result.minOrderApplied && (
            <span className="text-amber-600 dark:text-amber-400 font-semibold">
              (застосовано мінімум)
            </span>
          )}
        </div>
      </div>

      {/* Final Client Price Hero Card */}
      <div className="p-4 bg-emerald-500/10 dark:bg-emerald-500/15 border-2 border-emerald-500/30 rounded-2xl space-y-2 text-center relative overflow-hidden">
        <span className="text-xs uppercase tracking-wider font-bold text-emerald-800 dark:text-emerald-300 block">
          Кінцева ціна для клієнта
        </span>
        <div className="text-3xl sm:text-4xl font-black font-mono tabular-nums text-emerald-700 dark:text-emerald-400 tracking-tight">
          {formatUah(result.sellingPriceUah)}
        </div>

        {/* Profit and margin indicators */}
        <div className="pt-2 border-t border-emerald-500/20 flex items-center justify-around text-xs font-mono tabular-nums">
          <div>
            <span className="text-neutral-500 dark:text-neutral-400 block text-[10px]">
              Чистий прибуток
            </span>
            <span className="font-bold text-neutral-900 dark:text-neutral-100 text-sm">
              +{formatUah(result.profitUah)}
            </span>
          </div>
          <div>
            <span className="text-neutral-500 dark:text-neutral-400 block text-[10px]">
              Маржинальність
            </span>
            <span className="font-bold text-emerald-700 dark:text-emerald-400 text-sm">
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
          className="w-full font-bold shadow-sm"
          leftIcon={<Save className="w-4 h-4" />}
          onClick={onSave}
          isLoading={isSaving}
          disabled={input.job.parseStatus !== 'success'}
        >
          Зберегти розрахунок в історію
        </Button>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            leftIcon={<Share2 className="w-3.5 h-3.5 text-emerald-600" />}
            onClick={onOpenClientQuote}
            disabled={!isComplete}
          >
            Комерційний текст
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            leftIcon={copiedPrice ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            onClick={handleCopyPrice}
            disabled={!isComplete}
          >
            {copiedPrice ? 'Скопійовано' : 'Копіювати ціну'}
          </Button>
        </div>

        {/* Export buttons */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
            leftIcon={<FileSpreadsheet className="w-3.5 h-3.5" />}
            onClick={onExportCsv}
            title="Експорт собівартості в Excel / CSV таблицю"
          >
            Експорт CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
            leftIcon={<FileDown className="w-3.5 h-3.5" />}
            onClick={onExportJson}
            title="Експорт повного JSON снапшоту розрахунку"
          >
            Експорт JSON
          </Button>
        </div>
      </div>
    </div>
  );
};
