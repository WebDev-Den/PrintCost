import React, { useState, useEffect, useId } from 'react';
import { Modal } from '../common/Modal.tsx';
import { Button } from '../common/Button.tsx';
import { Input } from '../common/Input.tsx';
import { NumberInput } from '../common/NumberInput.tsx';
import type { MaterialProfile } from '../../domain/types.ts';
import { Disc, Scale, Package, Coins, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { formatUah } from '../../domain/formatters.ts';

interface MaterialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Omit<MaterialProfile, 'id' | 'createdAt'>) => Promise<void>;
  initialMaterial?: MaterialProfile | null;
  seededType?: string;
}

const COMMON_SPOOLS = [
  { kg: 0.25, grams: 250, label: '0.25 кг (250г)' },
  { kg: 0.5, grams: 500, label: '0.5 кг (500г)' },
  { kg: 0.75, grams: 750, label: '0.75 кг (750г)' },
  { kg: 1.0, grams: 1000, label: '1.0 кг (1000г)' },
  { kg: 2.5, grams: 2500, label: '2.5 кг (2500г)' },
];

export const MaterialModal: React.FC<MaterialModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialMaterial,
  seededType,
}) => {
  const fieldId = useId();
  const [name, setName] = useState('');
  const [type, setType] = useState('PETG');
  const [family, setFamily] = useState('Стандартні');
  const [brand, setBrand] = useState('Bambu Lab');
  const [colorName, setColorName] = useState('');
  const [colorHex, setColorHex] = useState('#1e293b');

  // Input parameters: Weight (in kg/grams), Price (per spool), and Quantity in stock
  const [weightKgInput, setWeightKgInput] = useState<string>('1.0');
  const [spoolWeightGrams, setSpoolWeightGrams] = useState<string>('1000');
  const [spoolPriceUah, setSpoolPriceUah] = useState<string>('650');
  const [spoolsInStock, setSpoolsInStock] = useState<number>(1);
  const [pricePerKgUah, setPricePerKgUah] = useState<string>('650.00');
  const [priceVatMode, setPriceVatMode] = useState<NonNullable<MaterialProfile['priceVatMode']>>('not_applicable');
  const [vatRatePercent, setVatRatePercent] = useState('20');
  const [vatRecoverable, setVatRecoverable] = useState(false);

  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setSaveError(null);
    if (initialMaterial) {
      setName(initialMaterial.name);
      setType(initialMaterial.type);
      setFamily(initialMaterial.family || 'Стандартні');
      setBrand(initialMaterial.brand);
      setColorName(initialMaterial.colorName || '');
      setColorHex(initialMaterial.colorHex || '#1e293b');
      const weightGrams = initialMaterial.spoolWeightGrams || '1000';
      const parsedGrams = parseFloat(weightGrams) || 1000;
      setSpoolWeightGrams(weightGrams);
      setWeightKgInput((parsedGrams / 1000).toString());

      const perKg = initialMaterial.pricePerKgUah ?? '';
      const spoolP = initialMaterial.spoolPriceUah || perKg || '650';

      setSpoolPriceUah(spoolP);
      setPricePerKgUah(perKg);
      setSpoolsInStock(initialMaterial.spoolsInStock ?? 1);
      setNotes(initialMaterial.notes || '');
      setPriceVatMode(initialMaterial.priceVatMode || 'not_applicable');
      setVatRatePercent(initialMaterial.vatRatePercent || '20');
      setVatRecoverable(initialMaterial.vatRecoverable === true);
    } else {
      setName('');
      setType(seededType || 'PETG');
      setFamily('Стандартні');
      setBrand('Bambu Lab');
      setColorName('');
      setColorHex('#1e293b');
      setWeightKgInput('1.0');
      setSpoolWeightGrams('1000');
      setSpoolPriceUah('650');
      setPricePerKgUah('650.00');
      setSpoolsInStock(1);
      setNotes('');
      setPriceVatMode('not_applicable'); setVatRatePercent('20'); setVatRecoverable(false);
    }
  }, [initialMaterial, isOpen, seededType]);

  // Recalculate automatic fields when weight in kg changes
  const handleWeightKgChange = (kgVal: string) => {
    setWeightKgInput(kgVal);
    const kg = parseFloat(kgVal);
    if (!isNaN(kg) && kg > 0) {
      const grams = Math.round(kg * 1000);
      setSpoolWeightGrams(String(grams));

      const price = parseFloat(spoolPriceUah);
      if (!isNaN(price) && price > 0) {
        setPricePerKgUah((price / kg).toFixed(2));
      }
    }
  };

  // Preset button click (e.g. 1.0 кг, 0.75 кг, etc.)
  const handleSelectPreset = (kg: number, grams: number) => {
    setWeightKgInput(String(kg));
    setSpoolWeightGrams(String(grams));
    const price = parseFloat(spoolPriceUah);
    if (!isNaN(price) && price > 0 && kg > 0) {
      setPricePerKgUah((price / kg).toFixed(2));
    }
  };

  // Recalculate automatic fields when spool price changes
  const handleSpoolPriceChange = (val: string) => {
    setSpoolPriceUah(val);
    const p = parseFloat(val);
    const kg = parseFloat(weightKgInput) || (parseFloat(spoolWeightGrams) || 1000) / 1000;
    if (!isNaN(p) && kg > 0) {
      setPricePerKgUah((p / kg).toFixed(2));
    } else {
      setPricePerKgUah('');
    }
  };

  // Manual change to price per kg updates spool price
  const handlePricePerKgChange = (val: string) => {
    setPricePerKgUah(val);
    const perKg = parseFloat(val);
    const kg = parseFloat(weightKgInput) || (parseFloat(spoolWeightGrams) || 1000) / 1000;
    if (!isNaN(perKg) && kg > 0) {
      setSpoolPriceUah((perKg * kg).toFixed(0));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (isSubmitting) return;

    setIsSubmitting(true);
    setSaveError(null);
    try {
      await onSave({
        name: name.trim(),
        type: type.trim().toUpperCase(),
        family,
        brand: brand.trim(),
        colorName: colorName.trim() || undefined,
        colorHex,
        pricePerKgUah: pricePerKgUah.trim() ? pricePerKgUah.trim() : null,
        spoolWeightGrams: spoolWeightGrams.trim() ? spoolWeightGrams.trim() : '1000',
        spoolPriceUah: spoolPriceUah.trim() ? spoolPriceUah.trim() : undefined,
        spoolsInStock: Math.max(0, spoolsInStock),
        isArchived: initialMaterial ? initialMaterial.isArchived : false,
        notes: notes.trim() || undefined,
        priceVatMode, vatRatePercent, vatRecoverable,
      });
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Не вдалося зберегти матеріал. Перевірте з’єднання й повторіть спробу.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const predefinedFamilies = [
    'Стандартні',
    'Інженерні',
    'Гнучкі',
    'Композитні',
    'Підтримки',
    'Спеціальні',
  ];

  // Live Auto-Calculations
  const parsedWeightGrams = parseFloat(spoolWeightGrams) || 1000;
  const parsedWeightKg = parsedWeightGrams / 1000;
  const currentPrice = parseFloat(spoolPriceUah) || 0;
  const pricePerGram = parsedWeightGrams > 0 ? currentPrice / parsedWeightGrams : 0;
  const computedPricePerKg = parsedWeightKg > 0 ? currentPrice / parsedWeightKg : 0;

  // Auto-calculated availability & inventory totals
  const totalInStockKg = (spoolsInStock * parsedWeightGrams) / 1000;
  const totalStockValue = spoolsInStock * currentPrice;

  const stockStatus =
    spoolsInStock === 0
      ? { label: 'Немає на складі', color: 'text-neutral-500 bg-neutral-100 dark:bg-neutral-800', icon: XCircle }
      : totalInStockKg < 0.5
      ? { label: 'Закінчується', color: 'text-amber-700 bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800', icon: AlertTriangle }
      : { label: 'В наявності', color: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800', icon: CheckCircle };

  const StatusIcon = stockStatus.icon;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { if (!isSubmitting) onClose(); }}
      title={initialMaterial ? 'Редагувати матеріал' : 'Додати позицію матеріалу'}
      description="Введіть вагу в кг та ціну — наявність на складі, вартість за кг, грам та загальний баланс розраховуються автоматично."
      maxWidth="lg"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
            Скасувати
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form="material-profile-form"
            isLoading={isSubmitting}
            disabled={!name.trim()}
          >
            Зберегти позицію
          </Button>
        </>
      }
    >
      <form id="material-profile-form" onSubmit={handleSubmit} className="space-y-4">
        {saveError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{saveError}</p>}
        <Input
          label="Назва позиції / матеріалу"
          placeholder="напр., Bambu PETG Basic Black"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-type`} className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Тип полімеру
            </label>
            <input
              id={`${fieldId}-type`}
              type="text"
              placeholder="PETG, PLA, ABS, ASA, TPU, PA-CF..."
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 uppercase font-mono"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Сімейство
            </label>
            <select
              value={family}
              onChange={(e) => setFamily(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {predefinedFamilies.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Бренд / Виробник"
            placeholder="Bambu Lab, eSUN, Devil Design, Plexiwire..."
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            required
          />

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Колір та відтінок
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={colorHex}
                onChange={(e) => setColorHex(e.target.value)}
                className="w-9 h-9 p-0.5 rounded border border-neutral-300 dark:border-neutral-700 cursor-pointer"
              />
              <Input
                placeholder="напр., Чорний матовий"
                value={colorName}
                onChange={(e) => setColorName(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Input Block: Weight in kg, Price, and In-Stock Count */}
        <div className="p-4 bg-neutral-50 dark:bg-neutral-900/80 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
              <Scale className="w-4 h-4 text-emerald-600" />
              <span>Параметри позиції: Вага, Ціна та Наявність</span>
            </span>
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
              Введіть вагу і ціну — решта рахується сама
            </span>
          </div>

          {/* Quick presets for Spool Weight in kg */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400">
              <span>Вага одиниці / котушки (в кг):</span>
              <span className="font-mono font-bold text-neutral-900 dark:text-white">
                {parsedWeightKg} кг ({parsedWeightGrams} г)
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {COMMON_SPOOLS.map((sp) => (
                <button
                  key={sp.grams}
                  type="button"
                  onClick={() => handleSelectPreset(sp.kg, sp.grams)}
                  className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                    parsedWeightGrams === sp.grams
                      ? 'bg-emerald-600 text-white font-bold shadow-2xs'
                      : 'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                  }`}
                >
                  {sp.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <NumberInput
              label="Вага в кг"
              unit="кг"
              value={weightKgInput}
              onChange={handleWeightKgChange}
              placeholder="1.0"
            />

            <NumberInput
              label="Ціна одиниці"
              unit="грн"
              value={spoolPriceUah}
              onChange={handleSpoolPriceChange}
              placeholder="650"
            />

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Кількість на складі
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSpoolsInStock((prev) => Math.max(0, prev - 1))}
                  className="w-8 h-9 flex items-center justify-center rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 font-bold hover:bg-neutral-100"
                >
                  -
                </button>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={spoolsInStock}
                  onChange={(e) => setSpoolsInStock(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full text-center px-2 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-mono font-bold"
                />
                <button
                  type="button"
                  onClick={() => setSpoolsInStock((prev) => prev + 1)}
                  className="w-8 h-9 flex items-center justify-center rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 font-bold hover:bg-neutral-100"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-700 space-y-3">
          <label className="block text-xs space-y-1.5"><span>ПДВ у ціні матеріалу</span><select aria-label="ПДВ у ціні матеріалу" value={priceVatMode} onChange={event => {
            const mode = event.target.value as NonNullable<MaterialProfile['priceVatMode']>;
            setPriceVatMode(mode); if (mode === 'not_applicable') setVatRecoverable(false);
          }} className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm">
            <option value="not_applicable">ПДВ не застосовується / ціну використовувати як задано</option><option value="included">ПДВ уже включено у вказану ціну</option><option value="excluded">Вказана ціна без ПДВ; додати його до витрат</option>
          </select></label>
          {priceVatMode !== 'not_applicable' && <><NumberInput id="material-vat-rate" label="Ставка ПДВ матеріалу" value={vatRatePercent} onChange={setVatRatePercent} unit="%" min={0} max={100} />
            <label className="flex items-start gap-2 text-xs"><input className="mt-0.5" type="checkbox" checked={vatRecoverable} onChange={event => setVatRecoverable(event.target.checked)} /><span>Є підтверджена підстава виключати вхідний ПДВ із собівартості</span></label>
            <p className="text-[11px] text-neutral-500">Виключення застосовується лише при увімкненій податковій оцінці та статусі платника ПДВ. Сам статус платника не створює такої підстави. Без неї вхідний ПДВ залишається у витратах.</p></>}
          <p className="text-[11px] text-neutral-500">Ціни у цій формі зберігаються у вибраному режимі. У калькуляторі цей режим визначає фактичну вартість матеріалу.</p>
        </div>

        {/* Live Auto-Calculated Results: Наявність & Вартість */}
        <div className="p-4 bg-emerald-50/70 dark:bg-emerald-950/20 rounded-xl border border-emerald-200 dark:border-emerald-800/80 space-y-3">
          <div className="flex items-center justify-between border-b border-emerald-200/60 dark:border-emerald-800/60 pb-2">
            <span className="text-xs font-bold text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5">
              <Coins className="w-4 h-4 text-emerald-600" />
              <span>Автоматичний розрахунок за наявністю та вартістю:</span>
            </span>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border ${stockStatus.color}`}>
              <StatusIcon className="w-3.5 h-3.5" />
              <span>{stockStatus.label}</span>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            {/* 1. Наявність: вага */}
            <div className="p-2.5 bg-white dark:bg-neutral-900 rounded-lg border border-emerald-100 dark:border-emerald-900/60 space-y-0.5">
              <span className="text-[10px] text-neutral-500 block">Залишок на складі:</span>
              <div className="font-mono font-black text-neutral-900 dark:text-white text-sm">
                {totalInStockKg.toFixed(2)} кг
              </div>
              <span className="text-[10px] text-neutral-400 block">{spoolsInStock} котуш. ({spoolsInStock * parsedWeightGrams} г)</span>
            </div>

            {/* 2. Вартість: за 1 кг */}
            <div className="p-2.5 bg-white dark:bg-neutral-900 rounded-lg border border-emerald-100 dark:border-emerald-900/60 space-y-0.5">
              <span className="text-[10px] text-neutral-500 block">Ціна за 1 кг:</span>
              <div className="font-mono font-black text-emerald-700 dark:text-emerald-300 text-sm">
                {computedPricePerKg > 0 ? `${computedPricePerKg.toFixed(2)} грн` : '—'}
              </div>
              <span className="text-[10px] text-neutral-400 block">собівартість кг</span>
            </div>

            {/* 3. Вартість: за 1 грам */}
            <div className="p-2.5 bg-white dark:bg-neutral-900 rounded-lg border border-emerald-100 dark:border-emerald-900/60 space-y-0.5">
              <span className="text-[10px] text-neutral-500 block">Ціна за 1 грам:</span>
              <div className="font-mono font-bold text-neutral-900 dark:text-white text-sm">
                {pricePerGram > 0 ? `${pricePerGram.toFixed(3)} грн/г` : '—'}
              </div>
              <span className="text-[10px] text-neutral-400 block">витрата при друці</span>
            </div>

            {/* 4. Загальна вартість запасів */}
            <div className="p-2.5 bg-white dark:bg-neutral-900 rounded-lg border border-emerald-100 dark:border-emerald-900/60 space-y-0.5">
              <span className="text-[10px] text-neutral-500 block">Вартість запасу:</span>
              <div className="font-mono font-black text-neutral-900 dark:text-white text-sm">
                {formatUah(totalStockValue)}
              </div>
              <span className="text-[10px] text-neutral-400 block">капітал на складі</span>
            </div>
          </div>
        </div>

        <Input
          label="Примітки (опціонально)"
          placeholder="Специфіка сушіння, адгезії, номер партії або посилання на магазин..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </form>
    </Modal>
  );
};
