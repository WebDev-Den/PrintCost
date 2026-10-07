import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal.tsx';
import { Button } from '../common/Button.tsx';
import { Input } from '../common/Input.tsx';
import { NumberInput } from '../common/NumberInput.tsx';
import type { PrinterProfile, MachineCostMode } from '../../domain/types.ts';
import { AlertCircle, HelpCircle } from 'lucide-react';

interface PrinterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Omit<PrinterProfile, 'id' | 'createdAt'>) => Promise<void>;
  initialPrinter?: PrinterProfile | null;
}

export const PrinterModal: React.FC<PrinterModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialPrinter,
}) => {
  const [name, setName] = useState('');
  const [modelId, setModelId] = useState('Bambu Lab P1S');
  const [averagePowerWatts, setAveragePowerWatts] = useState('100');
  const [costMode, setCostMode] = useState<MachineCostMode>('manual_rate');
  const [manualRateUah, setManualRateUah] = useState('10.00');

  // Depreciation fields
  const [purchasePriceUah, setPurchasePriceUah] = useState('48000');
  const [lifespanHours, setLifespanHours] = useState('4000');
  const [maintenanceHourlyRateUah, setMaintenanceHourlyRateUah] = useState('5.00');

  const [isDefault, setIsDefault] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (initialPrinter) {
      setName(initialPrinter.name);
      setModelId(initialPrinter.modelId || '');
      setAveragePowerWatts(initialPrinter.averagePowerWatts);
      setCostMode(initialPrinter.costCalculationMode);
      setManualRateUah(initialPrinter.machineHourlyRateUah);
      setPurchasePriceUah(initialPrinter.printerPurchasePriceUah || '');
      setLifespanHours(initialPrinter.lifespanHours || '');
      setMaintenanceHourlyRateUah(initialPrinter.maintenanceHourlyRateUah || '');
      setIsDefault(initialPrinter.isDefault);
    } else {
      setName('');
      setModelId('Bambu Lab P1S');
      setAveragePowerWatts('100');
      setCostMode('manual_rate');
      setManualRateUah('10.00');
      setPurchasePriceUah('45000');
      setLifespanHours('4000');
      setMaintenanceHourlyRateUah('5.00');
      setIsDefault(false);
    }
  }, [initialPrinter, isOpen]);

  // Derived calculated depreciation rate
  const calculatedDepreciationRate = () => {
    const price = parseFloat(purchasePriceUah);
    const life = parseFloat(lifespanHours);
    const maint = parseFloat(maintenanceHourlyRateUah || '0');
    if (!isNaN(price) && !isNaN(life) && life > 0) {
      const depPerHour = price / life;
      const total = depPerHour + (isNaN(maint) ? 0 : maint);
      return total.toFixed(2);
    }
    return '0.00';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      const effectiveHourlyRate =
        costMode === 'manual_rate' ? manualRateUah : calculatedDepreciationRate();

      await onSave({
        name: name.trim(),
        modelId: modelId.trim() || undefined,
        averagePowerWatts: averagePowerWatts.trim() || '100',
        costCalculationMode: costMode,
        machineHourlyRateUah: effectiveHourlyRate,
        printerPurchasePriceUah: costMode === 'depreciation' ? purchasePriceUah : null,
        lifespanHours: costMode === 'depreciation' ? lifespanHours : null,
        maintenanceHourlyRateUah: costMode === 'depreciation' ? maintenanceHourlyRateUah : null,
        isDefault,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialPrinter ? 'Редагувати принтер' : 'Додати 3D-принтер'}
      description="Параметри потужності та машинного часу для калькулятора."
      maxWidth="lg"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
            Скасувати
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            isLoading={isSubmitting}
            disabled={!name.trim()}
          >
            Зберегти принтер
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Назва принтера в майстерні"
          placeholder="напр., Bambu Lab P1S #1 (AMS)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <Input
          label="Модель або ідентифікатор (model ID)"
          placeholder="Bambu Lab P1S, X1-Carbon, A1 mini..."
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
        />

        {/* Average Power Section with explicit disclaimer */}
        <div className="p-3.5 bg-neutral-50 dark:bg-neutral-800/40 rounded-xl border border-neutral-200 dark:border-neutral-700/80 space-y-2">
          <NumberInput
            label="Середня робоча потужність друку"
            unit="Вт"
            value={averagePowerWatts}
            onChange={(v) => setAveragePowerWatts(v)}
            placeholder="100"
          />
          <div className="flex items-start gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong>Важливо:</strong> Середню потужність задаєте ви; це не вимірювання споживання з розетки в реальному часі. Не підставляйте паспортну максимальну пікову потужність нагріву (наприклад, 1000 Вт) як середню — типовий P1S у роботі споживає близько 80–120 Вт. Електроенергія рахується окремо за тарифом.
            </p>
          </div>
        </div>

        {/* Machine Cost Mode (Mutually Exclusive) */}
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-neutral-800 dark:text-neutral-200">
            Розрахунок машинної години (амортизація та знос)
          </label>

          <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg">
            <button
              type="button"
              onClick={() => setCostMode('manual_rate')}
              className={`py-1.5 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                costMode === 'manual_rate'
                  ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-semibold'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
              }`}
            >
              Ручна ставка (грн/год)
            </button>
            <button
              type="button"
              onClick={() => setCostMode('depreciation')}
              className={`py-1.5 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                costMode === 'depreciation'
                  ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-semibold'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
              }`}
            >
              Амортизація + Сервіс
            </button>
          </div>

          {costMode === 'manual_rate' ? (
            <NumberInput
              label="Фіксована машинна ставка"
              unit="грн/год"
              value={manualRateUah}
              onChange={(v) => setManualRateUah(v)}
              placeholder="10.00"
              helperText="Враховує знос механіки, ременів, сопел та окупність станка на годину роботи."
            />
          ) : (
            <div className="space-y-3 p-3 bg-neutral-50 dark:bg-neutral-800/40 rounded-lg border border-neutral-200 dark:border-neutral-700">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <NumberInput
                  label="Вартість закупівлі принтера"
                  unit="грн"
                  value={purchasePriceUah}
                  onChange={(v) => setPurchasePriceUah(v)}
                  placeholder="48000"
                />
                <NumberInput
                  label="Очікуваний ресурс до списання"
                  unit="год"
                  value={lifespanHours}
                  onChange={(v) => setLifespanHours(v)}
                  placeholder="4000"
                />
              </div>

              <NumberInput
                label="Резерв на регулярне обслуговування (сопла, мастило)"
                unit="грн/год"
                value={maintenanceHourlyRateUah}
                onChange={(v) => setMaintenanceHourlyRateUah(v)}
                placeholder="5.00"
              />

              <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 rounded flex items-center justify-between text-xs">
                <span className="text-emerald-900 dark:text-emerald-200">
                  Розрахована ставка:
                </span>
                <span className="font-mono font-bold text-emerald-800 dark:text-emerald-300">
                  {calculatedDepreciationRate()} грн/год
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Set default toggle */}
        <label className="flex items-center gap-2 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-neutral-300"
          />
          <span className="text-xs text-neutral-700 dark:text-neutral-300">
            Встановити як типовий принтер для нових розрахунків
          </span>
        </label>
      </form>
    </Modal>
  );
};
