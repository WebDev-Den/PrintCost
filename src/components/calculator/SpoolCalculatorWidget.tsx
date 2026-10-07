import React, { useState, useMemo } from 'react';
import {
  Disc,
  Calculator,
  Coins,
  Scale,
  Ruler,
  Package,
  Layers,
  ArrowRight,
  Sparkles,
  Check,
  PlusCircle,
  HelpCircle,
} from 'lucide-react';
import { formatUah, formatNumberUk, formatWeightUk } from '../../domain/formatters.ts';
import { Button } from '../common/Button.tsx';
import { useAppData } from '../../context/AppDataContext.tsx';

// Standard polymer densities in g/cm³ for length estimation (1.75 mm filament)
export const POLYMER_DENSITIES: Record<string, { density: number; label: string }> = {
  PLA: { density: 1.24, label: 'PLA / PLA+ (~1.24 г/см³)' },
  PETG: { density: 1.27, label: 'PETG (~1.27 г/см³)' },
  ABS: { density: 1.05, label: 'ABS (~1.05 г/см³)' },
  ASA: { density: 1.07, label: 'ASA (~1.07 г/см³)' },
  TPU: { density: 1.21, label: 'TPU 95A (~1.21 г/см³)' },
  PA: { density: 1.14, label: 'Nylon / PA (~1.14 г/см³)' },
  'PA-CF': { density: 1.22, label: 'PA-CF (~1.22 г/см³)' },
  PC: { density: 1.20, label: 'Polycarbonate PC (~1.20 г/см³)' },
};

export const COMMON_SPOOL_SIZES = [
  { grams: 250, label: '250 г (пробник / семпл)' },
  { grams: 500, label: '500 г (міні-котушка)' },
  { grams: 750, label: '750 г (євро-формат)' },
  { grams: 800, label: '800 г (стандарт Bambu)' },
  { grams: 1000, label: '1 000 г (1 кг, стандарт)' },
  { grams: 2500, label: '2 500 г (2.5 кг, максі)' },
  { grams: 3000, label: '3 000 г (3 кг)' },
  { grams: 5000, label: '5 000 г (5 кг, промислова)' },
];

interface SpoolCalculatorWidgetProps {
  initialWeightGrams?: number;
  initialPriceUah?: number;
  initialCount?: number;
  initialType?: string;
  targetPrintWeightGrams?: number;
  onApplyToRate?: (pricePerKg: number, spoolWeight: number, spoolPrice: number) => void;
  title?: string;
  description?: string;
  compact?: boolean;
  showSaveToCatalog?: boolean;
  onClose?: () => void;
}

export const SpoolCalculatorWidget: React.FC<SpoolCalculatorWidgetProps> = ({
  initialWeightGrams = 1000,
  initialPriceUah = 650,
  initialCount = 1,
  initialType = 'PETG',
  targetPrintWeightGrams,
  onApplyToRate,
  title = 'Розрахунок вартості котушок та ціни за кг',
  description = 'Введіть масу і ціну котушки (або партії) для миттєвого розрахунку собівартості за 1 кг, 1 грам та метражу нитки.',
  compact = false,
  showSaveToCatalog = true,
  onClose,
}) => {
  const { addMaterial } = useAppData();

  const [spoolWeightGrams, setSpoolWeightGrams] = useState<number>(initialWeightGrams);
  const [spoolPriceUah, setSpoolPriceUah] = useState<number>(initialPriceUah);
  const [spoolCount, setSpoolCount] = useState<number>(initialCount);
  const [plasticType, setPlasticType] = useState<string>(initialType);
  const [materialBrand, setMaterialBrand] = useState<string>('Bambu Lab');
  const [colorName, setColorName] = useState<string>('');
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // Math calculations
  const safeWeight = Math.max(1, spoolWeightGrams || 1000);
  const safePrice = Math.max(0, spoolPriceUah || 0);
  const safeCount = Math.max(1, spoolCount || 1);

  // Price per 1 kg (1000g)
  const pricePerKg = useMemo(() => {
    return (safePrice / safeWeight) * 1000;
  }, [safePrice, safeWeight]);

  // Price per 1 gram
  const pricePerGram = useMemo(() => {
    return safePrice / safeWeight;
  }, [safePrice, safeWeight]);

  // Total batch stats
  const totalWeightGrams = safeCount * safeWeight;
  const totalWeightKg = totalWeightGrams / 1000;
  const totalPriceUah = safeCount * safePrice;

  // Filament length calculation for 1.75 mm filament
  // radius = 0.175 cm / 2 = 0.0875 cm
  // area = pi * r^2 = 3.14159 * (0.0875)^2 = 0.0240528 cm^2
  const density = POLYMER_DENSITIES[plasticType]?.density || 1.25;
  const lengthPerSpoolMeters = useMemo(() => {
    const areaCm2 = Math.PI * Math.pow(0.175 / 2, 2);
    const volumeCm3 = safeWeight / density;
    const lengthCm = volumeCm3 / areaCm2;
    return Math.round(lengthCm / 100);
  }, [safeWeight, density]);

  const totalLengthMeters = lengthPerSpoolMeters * safeCount;

  // Print consumption breakdown if targetPrintWeightGrams is specified
  const printConsumption = useMemo(() => {
    if (!targetPrintWeightGrams || targetPrintWeightGrams <= 0) return null;

    const grams = targetPrintWeightGrams;
    const costUah = grams * pricePerGram;
    const spoolsFraction = grams / safeWeight;
    const percentOfSpool = (spoolsFraction * 100).toFixed(1);
    const spoolsNeededWhole = Math.ceil(spoolsFraction);
    const leftoverGrams = Math.max(0, spoolsNeededWhole * safeWeight - grams);
    const partsPerSpool = Math.floor(safeWeight / grams);

    return {
      grams,
      costUah,
      spoolsFraction,
      percentOfSpool,
      spoolsNeededWhole,
      leftoverGrams,
      partsPerSpool,
    };
  }, [targetPrintWeightGrams, safeWeight, pricePerGram]);

  // Save as material profile to workshop
  const handleSaveToCatalog = async () => {
    try {
      const name = `${materialBrand} ${plasticType} ${colorName ? colorName : `${safeWeight}г`}`.trim();
      await addMaterial({
        name,
        type: plasticType,
        family: 'Стандартні',
        brand: materialBrand,
        colorHex: '#10b981',
        colorName: colorName || 'Стандартний',
        pricePerKgUah: pricePerKg.toFixed(2),
        spoolWeightGrams: String(safeWeight),
        spoolPriceUah: String(safePrice),
        isArchived: false,
        notes: `Котушка ${safeWeight}г за ${safePrice} грн (собівартість ${pricePerKg.toFixed(2)} грн/кг)`,
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 sm:p-6 shadow-sm space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-neutral-900 dark:text-white flex items-center gap-2">
            <Disc className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <span>{title}</span>
          </h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            {description}
          </p>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 text-xs px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700"
          >
            Закрити
          </button>
        )}
      </div>

      {/* Main Grid: Inputs vs Big Calculated Results */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Inputs (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Spool Weight Presets & Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-emerald-600" />
                <span>Маса котушки нетто (вага пластику):</span>
              </label>
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                {formatWeightUk(safeWeight)}
              </span>
            </div>

            {/* Quick Presets Buttons */}
            <div className="flex flex-wrap gap-1.5">
              {COMMON_SPOOL_SIZES.map((item) => (
                <button
                  key={item.grams}
                  type="button"
                  onClick={() => setSpoolWeightGrams(item.grams)}
                  className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                    safeWeight === item.grams
                      ? 'bg-emerald-600 text-white font-bold shadow-xs'
                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                  }`}
                >
                  {item.grams >= 1000 ? `${item.grams / 1000} кг` : `${item.grams} г`}
                </button>
              ))}
            </div>

            <div className="relative mt-1">
              <input
                type="number"
                min="1"
                step="10"
                value={spoolWeightGrams}
                onChange={(e) => setSpoolWeightGrams(parseFloat(e.target.value) || 0)}
                placeholder="Введіть грами"
                className="w-full px-3 py-2 pr-12 text-sm rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <span className="absolute right-3 top-2.5 text-xs text-neutral-400 font-medium">
                грамів
              </span>
            </div>
          </div>

          {/* Spool Price and Count */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                Ціна за 1 котушку (грн):
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={spoolPriceUah}
                  onChange={(e) => setSpoolPriceUah(parseFloat(e.target.value) || 0)}
                  placeholder="напр. 650"
                  className="w-full px-3 py-2 pr-12 text-sm rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white font-mono font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <span className="absolute right-3 top-2.5 text-xs text-neutral-400 font-medium">
                  грн
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                Кількість котушок (партія):
              </label>
              <div className="flex items-center gap-1.5">
                {[1, 2, 4, 10].map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() => setSpoolCount(cnt)}
                    className={`text-xs px-2.5 py-1.5 rounded-lg border font-mono transition-all ${
                      spoolCount === cnt
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold'
                        : 'border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    {cnt} шт
                  </button>
                ))}
                <input
                  type="number"
                  min="1"
                  value={spoolCount}
                  onChange={(e) => setSpoolCount(parseInt(e.target.value, 10) || 1)}
                  className="w-16 px-2 py-1.5 text-xs text-center rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Plastic Type & Density */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                Тип пластику:
              </label>
              <select
                value={plasticType}
                onChange={(e) => setPlasticType(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
              >
                {Object.entries(POLYMER_DENSITIES).map(([type, meta]) => (
                  <option key={type} value={type}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                Виробник / Бренд:
              </label>
              <input
                type="text"
                value={materialBrand}
                onChange={(e) => setMaterialBrand(e.target.value)}
                placeholder="Bambu Lab, Plexiwire, Devil Design..."
                className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Right Output: Key Calculation per Kg and breakdown (5 cols) */}
        <div className="lg:col-span-5 space-y-4 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/80 rounded-2xl p-4 sm:p-5">
          <div className="text-center sm:text-left space-y-1">
            <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider block">
              Головний результат:
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black font-mono text-emerald-700 dark:text-emerald-300 tracking-tight">
                {pricePerKg.toFixed(2)}
              </span>
              <span className="text-base font-bold text-emerald-800 dark:text-emerald-400">
                грн / 1 кг
              </span>
            </div>
            <p className="text-[11px] text-neutral-600 dark:text-neutral-400">
              Собівартість 1 грама пластику:{' '}
              <span className="font-mono font-bold text-neutral-900 dark:text-white">
                {pricePerGram.toFixed(3)} грн/г
              </span>
            </p>
          </div>

          {/* Detailed Specifications of this Spool / Batch */}
          <div className="space-y-2 text-xs bg-white dark:bg-neutral-900 p-3.5 rounded-xl border border-emerald-200/60 dark:border-emerald-800/60">
            <div className="flex items-center justify-between py-1 border-b border-neutral-100 dark:border-neutral-800">
              <span className="text-neutral-500 flex items-center gap-1.5">
                <Disc className="w-3.5 h-3.5 text-neutral-400" />
                <span>Формат котушки:</span>
              </span>
              <span className="font-mono font-bold text-neutral-900 dark:text-white">
                {safeWeight} г ({safeWeight >= 1000 ? `${safeWeight / 1000} кг` : `${safeWeight}г`})
              </span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-neutral-100 dark:border-neutral-800">
              <span className="text-neutral-500 flex items-center gap-1.5">
                <Coins className="w-3.5 h-3.5 text-neutral-400" />
                <span>Ціна котушки:</span>
              </span>
              <span className="font-mono font-bold text-neutral-900 dark:text-white">
                {formatUah(safePrice)}
              </span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-neutral-100 dark:border-neutral-800">
              <span className="text-neutral-500 flex items-center gap-1.5">
                <Ruler className="w-3.5 h-3.5 text-neutral-400" />
                <span>Довжина нитки 1.75мм:</span>
              </span>
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                ~{lengthPerSpoolMeters} метрів
              </span>
            </div>

            {safeCount > 1 && (
              <>
                <div className="flex items-center justify-between py-1 border-b border-neutral-100 dark:border-neutral-800">
                  <span className="text-neutral-500 flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Партія ({safeCount} шт):</span>
                  </span>
                  <span className="font-mono font-bold text-neutral-900 dark:text-white">
                    {totalWeightKg.toFixed(2)} кг ({totalWeightGrams} г)
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-neutral-500 flex items-center gap-1.5">
                    <Coins className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Загальна сума покупки:</span>
                  </span>
                  <span className="font-mono font-black text-neutral-900 dark:text-white">
                    {formatUah(totalPriceUah)}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Target Print Consumption Simulation (if applicable) */}
          {printConsumption && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-800 text-xs space-y-1.5">
              <span className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-amber-600" />
                <span>Розрахунок для поточного друку ({printConsumption.grams} г):</span>
              </span>
              <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                <div className="bg-white/80 dark:bg-neutral-900/80 p-2 rounded-lg">
                  <span className="text-neutral-500 block">Витрата котушки:</span>
                  <span className="font-mono font-bold text-amber-800 dark:text-amber-300">
                    {printConsumption.percentOfSpool}% ({printConsumption.spoolsFraction.toFixed(2)} шт)
                  </span>
                </div>
                <div className="bg-white/80 dark:bg-neutral-900/80 p-2 rounded-lg">
                  <span className="text-neutral-500 block">Вартість пластику на деталь:</span>
                  <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                    {formatUah(printConsumption.costUah)}
                  </span>
                </div>
                <div className="bg-white/80 dark:bg-neutral-900/80 p-2 rounded-lg">
                  <span className="text-neutral-500 block">Залишок на котушці:</span>
                  <span className="font-mono font-bold text-neutral-800 dark:text-neutral-200">
                    {printConsumption.leftoverGrams} г
                  </span>
                </div>
                <div className="bg-white/80 dark:bg-neutral-900/80 p-2 rounded-lg">
                  <span className="text-neutral-500 block">Деталей з 1 котушки:</span>
                  <span className="font-mono font-bold text-neutral-800 dark:text-neutral-200">
                    ~{printConsumption.partsPerSpool} шт
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2 pt-1">
            {onApplyToRate && (
              <Button
                variant="primary"
                size="sm"
                className="w-full text-xs font-bold"
                onClick={() => onApplyToRate(pricePerKg, safeWeight, safePrice)}
                leftIcon={<Check className="w-3.5 h-3.5" />}
              >
                Застосувати ціну {pricePerKg.toFixed(2)} грн/кг
              </Button>
            )}

            {showSaveToCatalog && (
              <Button
                variant={savedSuccess ? 'primary' : 'outline'}
                size="sm"
                className="w-full text-xs font-semibold"
                onClick={handleSaveToCatalog}
                leftIcon={savedSuccess ? <Check className="w-3.5 h-3.5" /> : <PlusCircle className="w-3.5 h-3.5" />}
              >
                {savedSuccess ? 'Збережено в каталог майстерні!' : 'Зберегти як матеріал у мій кабінет'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
