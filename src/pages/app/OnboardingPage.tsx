import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User,
  Zap,
  Printer,
  Layers,
  DollarSign,
  ArrowRight,
  ArrowLeft,
  Check,
  SkipForward,
  AlertCircle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useAppData } from '../../context/AppDataContext.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';
import { NumberInput } from '../../components/common/NumberInput.tsx';
import type { PricingMode, RoundingMode } from '../../domain/types.ts';
import { authErrorMessage } from '../../services/authService.ts';

export const OnboardingPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();
  const { materials, printers, updateSettings, addPrinter, addMaterial, updatePrinter, updateMaterial } = useAppData();

  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const skippedSteps = useRef(new Set<number>());
  const createdPrinterId = useRef<string | null>(null);
  const createdMaterialIds = useRef(new Map<string, string>());

  // Step 1: User & Workshop
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [workshopName, setWorkshopName] = useState(user?.workshopName || '');

  // Step 2: Electricity
  const [electricityTariff, setElectricityTariff] = useState('5.00');

  // Step 3: Printer
  const [printerName, setPrinterName] = useState('Bambu Lab P1S');
  const [printerModelId, setPrinterModelId] = useState('Bambu Lab P1S');
  const [printerPower, setPrinterPower] = useState('100');
  const [printerHourlyRate, setPrinterHourlyRate] = useState('10.00');

  // Step 4: Core Materials (PLA, PETG, ABS, ASA, TPU, custom)
  const [matPrices, setMatPrices] = useState<Record<string, string>>({
    PLA: '600',
    PETG: '650',
    ABS: '720',
    ASA: '980',
    TPU: '1100',
  });
  const [customMatType, setCustomMatType] = useState('');
  const [customMatPrice, setCustomMatPrice] = useState('');

  // Step 5: Pricing & Margin
  const [pricingMode, setPricingMode] = useState<PricingMode>('markup');
  const [markupPercent, setMarkupPercent] = useState('100');
  const [marginPercent, setMarginPercent] = useState('50');
  const [minOrder, setMinOrder] = useState('200');
  const [rounding, setRounding] = useState<RoundingMode>('up_10');

  const steps = [
    { num: 1, title: 'Майстерня', icon: User },
    { num: 2, title: 'Електроенергія', icon: Zap },
    { num: 3, title: 'Принтер', icon: Printer },
    { num: 4, title: 'Матеріали', icon: Layers },
    { num: 5, title: 'Ціноутворення', icon: DollarSign },
  ];

  const handleNext = () => {
    skippedSteps.current.delete(currentStep);
    if (currentStep < 5) {
      setCurrentStep((s) => s + 1);
    } else {
      handleComplete();
    }
  };

  const handleSkip = () => {
    skippedSteps.current.add(currentStep);
    if (currentStep < 5) {
      setCurrentStep((s) => s + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = async () => {
    if (busy.current) return;
    busy.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
    // 1. Profile
    if (!skippedSteps.current.has(1) && (fullName.trim() || workshopName.trim())) {
      await updateUser({
        fullName: fullName.trim() || user?.fullName || 'Оператор',
        workshopName: workshopName.trim() || user?.workshopName || '',
      });
    }

    const settingsUpdates = {
      ...(!skippedSteps.current.has(2) ? { electricityTariffUahPerKwh: electricityTariff.trim() || null } : {}),
      ...(!skippedSteps.current.has(5) ? {
        pricingMode,
        defaultMarkupPercent: markupPercent.trim() || '100',
        defaultMarginPercent: marginPercent.trim() || '50',
        minOrderPriceUah: minOrder.trim() || '200',
        roundingMode: rounding,
      } : {}),
    };
    if (Object.keys(settingsUpdates).length) await updateSettings(settingsUpdates);

    // 3. Printer (if name provided)
    if (!skippedSteps.current.has(3) && printerName.trim()) {
      const data = {
        name: printerName.trim(),
        modelId: printerModelId.trim() || undefined,
        averagePowerWatts: printerPower.trim() || '100',
        costCalculationMode: 'manual_rate' as const,
        machineHourlyRateUah: printerHourlyRate.trim() || '10.00',
        isDefault: true,
      };
      if (createdPrinterId.current) await updatePrinter(createdPrinterId.current, data);
      else if (!printers.some(printer => printer.name === data.name && printer.modelId === data.modelId)) {
        createdPrinterId.current = (await addPrinter(data)).id;
      }
    }

    // 4. Core Materials
    for (const [type, price] of skippedSteps.current.has(4) ? [] : Object.entries(matPrices)) {
      if (price.trim()) {
        const data = {
          name: `${type} базовий`,
          type,
          family: type === 'TPU' ? 'Гнучкі' : type === 'ABS' || type === 'ASA' ? 'Інженерні' : 'Стандартні',
          brand: 'Основний постачальник',
          pricePerKgUah: price.trim(),
          isArchived: false,
        };
        const createdId = createdMaterialIds.current.get(type);
        if (createdId) await updateMaterial(createdId, data);
        else if (!materials.some(material => material.name === data.name && material.type === data.type && material.brand === data.brand)) {
          createdMaterialIds.current.set(type, (await addMaterial(data)).id);
        }
      }
    }

    if (!skippedSteps.current.has(4) && customMatType.trim() && customMatPrice.trim()) {
      const data = {
        name: `${customMatType.trim().toUpperCase()} котушка`,
        type: customMatType.trim().toUpperCase(),
        family: 'Спеціальні',
        brand: 'Власний бренд',
        pricePerKgUah: customMatPrice.trim(),
        isArchived: false,
      };
      const key = 'custom';
      const createdId = createdMaterialIds.current.get(key);
      if (createdId) await updateMaterial(createdId, data);
      else if (!materials.some(material => material.name === data.name && material.type === data.type && material.brand === data.brand)) {
        createdMaterialIds.current.set(key, (await addMaterial(data)).id);
      }
    }

    navigate('/app/dashboard');
    } catch (error) {
      setError(authErrorMessage(error));
    } finally {
      busy.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-6 space-y-8">
      {error && <p role="alert" className="p-3 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded-lg">{error} Збережені позиції залишилися у вашому акаунті; можна повторити завершення.</p>}
      {/* Step Indicators */}
      <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-4">
        {steps.map((st) => {
          const Icon = st.icon;
          const isDone = st.num < currentStep;
          const isCurrent = st.num === currentStep;

          return (
            <div key={st.num} className="flex flex-col items-center gap-1.5 flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                  isDone
                    ? 'bg-emerald-600 text-white'
                    : isCurrent
                    ? 'border-2 border-emerald-600 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40'
                    : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400'
                }`}
              >
                {isDone ? <Check className="w-4 h-4 stroke-[3]" /> : st.num}
              </div>
              <span
                className={`text-[11px] hidden sm:block ${
                  isCurrent ? 'font-semibold text-neutral-900 dark:text-white' : 'text-neutral-400'
                }`}
              >
                {st.title}
              </span>
            </div>
          );
        })}
      </div>

      {/* Wizard Card Body */}
      <div className="bg-white dark:bg-neutral-900 p-6 sm:p-8 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm space-y-6">
        {/* Step 1: Workshop */}
        {currentStep === 1 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-neutral-900 dark:text-white">
                Крок 1. Профіль оператора та майстерні
              </h3>
              <p className="text-xs text-neutral-500 mt-1">
                Як звертатися до вас та які реквізити вказувати в комерційних пропозиціях для клієнтів.
              </p>
            </div>

            <Input
              label="Ваше ім'я"
              placeholder="напр., Олександр"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />

            <Input
              label="Назва майстерні (необов'язково)"
              placeholder="напр., Horizon 3D Print Lab"
              value={workshopName}
              onChange={(e) => setWorkshopName(e.target.value)}
            />
          </div>
        )}

        {/* Step 2: Electricity */}
        {currentStep === 2 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-neutral-900 dark:text-white">
                Крок 2. Тариф на електроенергію
              </h3>
              <p className="text-xs text-neutral-500 mt-1">
                Вартість спожитої електроенергії буде розраховуватися виходячи з тривалості нарізки та середньої потужності столу й хотенду.
              </p>
            </div>

            <NumberInput
              label="Тариф електроенергії майстерні"
              unit="грн/кВт·год"
              value={electricityTariff}
              onChange={(v) => setElectricityTariff(v)}
              placeholder="5.00"
              helperText="Якщо пропустити — поле залишиться порожнім і розрахунок буде позначено як неповний."
            />
          </div>
        )}

        {/* Step 3: Printer */}
        {currentStep === 3 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-neutral-900 dark:text-white">
                Крок 3. Перший 3D-принтер
              </h3>
              <p className="text-xs text-neutral-500 mt-1">
                Додайте основний принтер, на якому ви друкуєте замовлення.
              </p>
            </div>

            <Input
              label="Назва принтера"
              placeholder="Bambu Lab P1S"
              value={printerName}
              onChange={(e) => setPrinterName(e.target.value)}
            />

            <Input
              label="Model ID (ідентифікатор моделі)"
              placeholder="Bambu Lab P1S / X1-Carbon"
              value={printerModelId}
              onChange={(e) => setPrinterModelId(e.target.value)}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <NumberInput
                label="Середня робоча потужність"
                unit="Вт"
                value={printerPower}
                onChange={(v) => setPrinterPower(v)}
                placeholder="100"
                helperText="Типово 80-120 Вт під час друку"
              />
              <NumberInput
                label="Машинна ставка принтера"
                unit="грн/год"
                value={printerHourlyRate}
                onChange={(v) => setPrinterHourlyRate(v)}
                placeholder="10.00"
                helperText="Амортизація та окупність на 1 год"
              />
            </div>
          </div>
        )}

        {/* Step 4: Materials */}
        {currentStep === 4 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-neutral-900 dark:text-white">
                Крок 4. Закупівельні ціни основних пластиків
              </h3>
              <p className="text-xs text-neutral-500 mt-1">
                Вкажіть актуальну вартість за 1 кг для швидкого підбору при аналізі .gcode.3mf файлу.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {['PLA', 'PETG', 'ABS', 'ASA', 'TPU'].map((mat) => (
                <NumberInput
                  key={mat}
                  label={`Ціна ${mat}`}
                  unit="грн/кг"
                  value={matPrices[mat] ?? ''}
                  onChange={(v) => setMatPrices({ ...matPrices, [mat]: v })}
                  placeholder="напр. 650"
                />
              ))}
            </div>

            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg space-y-2 border border-neutral-200 dark:border-neutral-700">
              <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                Додати додатковий матеріал (опціонально):
              </span>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Тип (напр., PA-CF, PC)"
                  value={customMatType}
                  onChange={(e) => setCustomMatType(e.target.value)}
                />
                <NumberInput
                  unit="грн/кг"
                  placeholder="Ціна за кг"
                  value={customMatPrice}
                  onChange={(v) => setCustomMatPrice(v)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Pricing Rules */}
        {currentStep === 5 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-neutral-900 dark:text-white">
                Крок 5. Правила ціноутворення та продаж
              </h3>
              <p className="text-xs text-neutral-500 mt-1">
                Встановіть бажаний рівень прибутку та правила округлення чеку для клієнта.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Метод розрахунку вартості
              </label>
              <select
                value={pricingMode}
                onChange={(e) => setPricingMode(e.target.value as PricingMode)}
                className="w-full py-2 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
              >
                <option value="markup">Націнка на собівартість (%)</option>
                <option value="target_margin">Цільова маржа від ціни продажу (%)</option>
              </select>
            </div>

            {pricingMode === 'markup' ? (
              <NumberInput
                label="Типова націнка"
                unit="%"
                value={markupPercent}
                onChange={(v) => setMarkupPercent(v)}
                placeholder="100"
                helperText="100% означає ціну вдвічі вищу за собівартість"
              />
            ) : (
              <NumberInput
                label="Цільова маржа"
                unit="%"
                value={marginPercent}
                onChange={(v) => setMarginPercent(v)}
                placeholder="50"
              />
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <NumberInput
                label="Мінімальне замовлення"
                unit="грн"
                value={minOrder}
                onChange={(v) => setMinOrder(v)}
                placeholder="200"
              />

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  Округлення
                </label>
                <select
                  value={rounding}
                  onChange={(e) => setRounding(e.target.value as RoundingMode)}
                  className="w-full py-2 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                >
                  <option value="none">Без округлення</option>
                  <option value="up_5">Вгору до 5 грн</option>
                  <option value="up_10">Вгору до 10 грн</option>
                  <option value="up_50">Вгору до 50 грн</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Skipped warning notice */}
        <div className="flex items-start gap-2 p-3 bg-neutral-50 dark:bg-neutral-800/40 rounded-lg text-[11px] text-neutral-500">
          <AlertCircle className="w-3.5 h-3.5 text-neutral-400 shrink-0 mt-0.5" />
          <p>
            Ви можете пропустити будь-який крок. Пропуск зберігає поточний профіль, тариф і правила ціноутворення; принтери й матеріали з пропущених кроків не додаються. У новому акаунті тариф залишиться незаповненим. Дані можна заповнити пізніше в налаштуваннях майстерні.
          </p>
        </div>

        {/* Navigation Buttons */}
        <div className="flex items-center justify-between pt-4 border-t border-neutral-200 dark:border-neutral-800">
          <div>
            {currentStep > 1 && (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}
              onClick={() => setCurrentStep((s) => s - 1)}
              disabled={isSubmitting}
              >
                Назад
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<SkipForward className="w-3.5 h-3.5" />}
              onClick={handleSkip}
              disabled={isSubmitting}
            >
              Пропустити крок
            </Button>
            <Button
              variant="primary"
              size="sm"
              rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
              onClick={handleNext}
              isLoading={isSubmitting}
            >
              {currentStep === 5 ? 'Завершити налаштування' : 'Далі'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
