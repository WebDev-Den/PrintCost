import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  RotateCcw,
  Copy,
  FileText,
  Share2,
  Calendar,
  Layers,
  Printer,
  Zap,
} from 'lucide-react';
import { useAppData } from '../../context/AppDataContext.tsx';
import type { CalculationSnapshot } from '../../domain/types.ts';
import { Button } from '../../components/common/Button.tsx';
import { StatusBadge } from '../../components/common/StatusBadge.tsx';
import { ClientQuoteModal } from '../../components/calculator/ClientQuoteModal.tsx';
import { CostBreakdownChart } from '../../components/calculator/CostBreakdownChart.tsx';
import { formatUah, formatDurationUk, formatWeightUk, formatNumberUk } from '../../domain/formatters.ts';

export const CalculationDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { calculations, settings, printers, materials, saveCalculation } = useAppData();

  const [snapshot, setSnapshot] = useState<CalculationSnapshot | null>(null);
  const [isClientQuoteOpen, setIsClientQuoteOpen] = useState(false);
  const [copiedPrice, setCopiedPrice] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);

  useEffect(() => {
    if (id) {
      const found = calculations.find((c) => c.id === id);
      if (found) {
        setSnapshot(found);
      }
    }
  }, [id, calculations]);

  if (!snapshot) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-sm text-neutral-500">Розрахунок не знайдено або він був видалений.</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/app/calculations')}>
          Повернутися до історії
        </Button>
      </div>
    );
  }

  const { input, result } = snapshot;

  /**
   * Section 11 requirement:
   * «Дія "Перерахувати за поточними тарифами" створює нову версію, а не непомітно змінює стару.»
   */
  const handleRecalculateWithCurrentTariffs = async () => {
    setIsRecalculating(true);
    try {
      const activePrinter = printers.find((p) => p.id === settings.defaultPrinterId) || printers[0];

      // Update filament prices from current master catalog
      const updatedFilaments = input.filaments.map((f) => {
        const catalogMat = materials.find((m) => m.id === f.mappedMaterialId);
        const currentPrice = catalogMat?.pricePerKgUah || f.pricePerKgUah;
        let updatedCost = f.costUah;
        if (currentPrice && parseFloat(f.weightGrams) > 0) {
          updatedCost = ((parseFloat(f.weightGrams) / 1000) * parseFloat(currentPrice)).toFixed(2);
        }
        return {
          ...f,
          pricePerKgUah: currentPrice,
          costUah: updatedCost,
        };
      });

      const updatedInput = {
        ...input,
        filaments: updatedFilaments,
        averagePowerWatts: activePrinter?.averagePowerWatts || input.averagePowerWatts,
        electricityTariffUahPerKwh: settings.electricityTariffUahPerKwh || input.electricityTariffUahPerKwh,
        machineHourlyRateUah: activePrinter?.machineHourlyRateUah || input.machineHourlyRateUah,
        operatorFeeUah: settings.defaultOperatorFeeUah || input.operatorFeeUah,
        packagingFeeUah: settings.defaultPackagingFeeUah || input.packagingFeeUah,
        scrapReservePercent: settings.scrapReservePercent || input.scrapReservePercent,
        pricingMode: settings.pricingMode || input.pricingMode,
        markupPercent: settings.defaultMarkupPercent || input.markupPercent,
        marginPercent: settings.defaultMarginPercent || input.marginPercent,
        minOrderPriceUah: settings.minOrderPriceUah || input.minOrderPriceUah,
        roundingMode: settings.roundingMode || input.roundingMode,
      };

      // Import calculator dynamically or call calculation engine
      const { calculatePrintCost } = await import('../../domain/calculator.ts');
      const newResult = calculatePrintCost(updatedInput);

      // Save as a NEW separate version
      const newSnapshot = await saveCalculation({
        title: `${snapshot.title} (оновлені тарифи ${new Date().toLocaleDateString('uk-UA')})`,
        status: newResult.status,
        input: updatedInput,
        result: newResult,
        fileName: snapshot.fileName,
        clientName: snapshot.clientName,
        notes: `Створено як нову версію на основі розрахунку #${snapshot.id}`,
      });

      navigate(`/app/calculations/${newSnapshot.id}`);
    } finally {
      setIsRecalculating(false);
    }
  };

  const handleCopyPrice = () => {
    navigator.clipboard.writeText(result.sellingPriceUah);
    setCopiedPrice(true);
    setTimeout(() => setCopiedPrice(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-200 dark:border-neutral-800 pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/app/calculations')}
            className="p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-white rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Назад до списку"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-neutral-900 dark:text-white">
                {snapshot.title}
              </h2>
              <StatusBadge status={snapshot.status} />
            </div>
            <p className="text-xs text-neutral-500 font-mono mt-0.5">
              Файл: {snapshot.fileName} · Збережено: {new Date(snapshot.createdAt).toLocaleString('uk-UA')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={handleRecalculateWithCurrentTariffs}
            isLoading={isRecalculating}
            title="Створює окремий новий розрахунок із поточними тарифами з налаштувань"
          >
            Перерахувати за поточними тарифами
          </Button>

          <Button
            variant="primary"
            size="sm"
            leftIcon={<Share2 className="w-3.5 h-3.5" />}
            onClick={() => setIsClientQuoteOpen(true)}
          >
            Пропозиція для клієнта
          </Button>
        </div>
      </div>

      {/* Grid: Tariffs Locked at Calculation Time vs Results */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Sliced Filaments & Locked Tariffs */}
        <div className="lg:col-span-2 space-y-6">
          {/* Visual Cost Distribution Chart using Recharts */}
          <CostBreakdownChart result={result} />

          {/* Filaments snapshot table */}
          <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-2xs">
            <div className="p-4 border-b border-neutral-200 dark:border-neutral-800">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-600" />
                <span>Матеріали та вартість у цьому розрахунку</span>
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-50 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 font-semibold border-b border-neutral-200 dark:border-neutral-800">
                  <tr>
                    <th className="py-2.5 px-3">Пластина</th>
                    <th className="py-2.5 px-3">Філамент</th>
                    <th className="py-2.5 px-3">Матеріал</th>
                    <th className="py-2.5 px-3 text-right">Витрата</th>
                    <th className="py-2.5 px-3 text-right">Ціна за кг</th>
                    <th className="py-2.5 px-3 text-right">Сума</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {input.filaments.map((f, i) => (
                    <tr key={i} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                      <td className="py-2.5 px-3 font-medium">{f.plateName}</td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono">{f.typeFromFile}</span>
                      </td>
                      <td className="py-2.5 px-3 text-neutral-600 dark:text-neutral-400">
                        {f.mappedMaterialName || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatWeightUk(f.weightGrams)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatUah(f.pricePerKgUah)}/кг
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                        {formatUah(f.costUah)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Locked Tariffs Card */}
          <div className="bg-white dark:bg-neutral-900 p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-3 shadow-2xs">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              <span>Зафіксовані тарифи на момент цього розрахунку</span>
            </h3>
            <p className="text-xs text-neutral-500">
              Ці значення збережені у знімку розрахунку і залишаються незмінними навіть після коригування глобальних налаштувань.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs pt-1">
              <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
                <span className="text-neutral-500 block text-[11px]">Тариф електроенергії:</span>
                <span className="font-mono font-semibold text-neutral-900 dark:text-white">
                  {formatUah(input.electricityTariffUahPerKwh)}/кВт·год
                </span>
              </div>

              <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
                <span className="text-neutral-500 block text-[11px]">Машинна ставка принтера:</span>
                <span className="font-mono font-semibold text-neutral-900 dark:text-white">
                  {formatUah(input.machineHourlyRateUah)}/год
                </span>
              </div>

              <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
                <span className="text-neutral-500 block text-[11px]">Потужність принтера:</span>
                <span className="font-mono font-semibold text-neutral-900 dark:text-white">
                  {input.averagePowerWatts} Вт
                </span>
              </div>

              <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
                <span className="text-neutral-500 block text-[11px]">Робота оператора:</span>
                <span className="font-mono font-semibold text-neutral-900 dark:text-white">
                  {formatUah(input.operatorFeeUah)}
                </span>
              </div>

              <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
                <span className="text-neutral-500 block text-[11px]">Резерв браку:</span>
                <span className="font-mono font-semibold text-neutral-900 dark:text-white">
                  {input.scrapReservePercent}%
                </span>
              </div>

              <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
                <span className="text-neutral-500 block text-[11px]">
                  {input.pricingMode === 'markup' ? 'Націнка:' : 'Цільова маржа:'}
                </span>
                <span className="font-mono font-semibold text-neutral-900 dark:text-white">
                  {input.pricingMode === 'markup' ? `${input.markupPercent}%` : `${input.marginPercent}%`}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: Cost Price Breakdown Summary */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-neutral-900 p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-4 shadow-2xs">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
              Структура собівартості
            </h3>

            <div className="space-y-2 text-xs divide-y divide-neutral-100 dark:divide-neutral-800">
              <div className="pt-1.5 flex justify-between">
                <span className="text-neutral-600 dark:text-neutral-400">Матеріали:</span>
                <span className="font-mono tabular-nums font-semibold">
                  {formatUah(result.materialsCostUah)}
                </span>
              </div>

              <div className="pt-1.5 flex justify-between">
                <span className="text-neutral-600 dark:text-neutral-400">
                  Електроенергія ({result.totalEnergyKwh} кВт·год):
                </span>
                <span className="font-mono tabular-nums font-semibold">
                  {formatUah(result.electricityCostUah)}
                </span>
              </div>

              <div className="pt-1.5 flex justify-between">
                <span className="text-neutral-600 dark:text-neutral-400">Машинний час:</span>
                <span className="font-mono tabular-nums font-semibold">
                  {formatUah(result.machineCostUah)}
                </span>
              </div>

              <div className="pt-1.5 flex justify-between">
                <span className="text-neutral-600 dark:text-neutral-400">Оператор:</span>
                <span className="font-mono tabular-nums font-semibold">
                  {formatUah(result.operatorCostUah)}
                </span>
              </div>

              <div className="pt-1.5 flex justify-between">
                <span className="text-neutral-600 dark:text-neutral-400">
                  Резерв браку ({input.scrapReservePercent}%):
                </span>
                <span className="font-mono tabular-nums font-semibold">
                  {formatUah(result.scrapReserveUah)}
                </span>
              </div>

              <div className="pt-2 flex justify-between bg-neutral-50 dark:bg-neutral-800 p-2 rounded font-semibold">
                <span>Собівартість:</span>
                <span className="font-mono text-neutral-900 dark:text-white">
                  {formatUah(result.costPriceUah)}
                </span>
              </div>
            </div>

            {/* Client Final Price Block */}
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-center space-y-2">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-emerald-800 dark:text-emerald-300">
                Зафіксована ціна клієнту
              </span>
              <div className="text-3xl font-extrabold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                {formatUah(result.sellingPriceUah)}
              </div>
              <div className="flex justify-around text-xs font-mono pt-2 border-t border-emerald-500/20">
                <div>
                  <span className="text-neutral-500 text-[10px] block">Прибуток:</span>
                  <span className="font-bold">+{formatUah(result.profitUah)}</span>
                </div>
                <div>
                  <span className="text-neutral-500 text-[10px] block">Маржа:</span>
                  <span className="font-bold text-emerald-600">{result.marginPercent}%</span>
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              leftIcon={<Copy className="w-3.5 h-3.5" />}
              onClick={handleCopyPrice}
            >
              {copiedPrice ? 'Ціну скопійовано' : 'Копіювати ціну'}
            </Button>
          </div>
        </div>
      </div>

      {/* Client Quote Modal */}
      <ClientQuoteModal
        isOpen={isClientQuoteOpen}
        onClose={() => setIsClientQuoteOpen(false)}
        calcSnapshot={{
          fileName: snapshot.fileName,
          sellingPriceUah: result.sellingPriceUah,
          totalWeightGrams: result.totalWeightGrams,
          totalDurationSeconds: result.totalDurationSeconds,
          filaments: input.filaments,
        }}
      />
    </div>
  );
};
