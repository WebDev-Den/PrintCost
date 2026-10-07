import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal.tsx';
import { Button } from '../common/Button.tsx';
import { Input } from '../common/Input.tsx';
import { NumberInput } from '../common/NumberInput.tsx';
import type { MaterialProfile } from '../../domain/types.ts';
import { Disc, Calculator, Scale, Coins } from 'lucide-react';
import { formatUah } from '../../domain/formatters.ts';

interface MaterialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Omit<MaterialProfile, 'id' | 'createdAt'>) => Promise<void>;
  initialMaterial?: MaterialProfile | null;
}

const COMMON_SPOOLS = [
  { grams: 250, label: '250 г' },
  { grams: 500, label: '500 г' },
  { grams: 750, label: '750 г' },
  { grams: 1000, label: '1 000 г (1 кг)' },
  { grams: 2500, label: '2.5 кг' },
];

export const MaterialModal: React.FC<MaterialModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialMaterial,
}) => {
  const [name, setName] = useState('');
  const [type, setType] = useState('PETG');
  const [family, setFamily] = useState('Стандартні');
  const [brand, setBrand] = useState('Bambu Lab');
  const [colorName, setColorName] = useState('');
  const [colorHex, setColorHex] = useState('#1e293b');
  const [spoolPriceUah, setSpoolPriceUah] = useState<string>('650');
  const [spoolWeightGrams, setSpoolWeightGrams] = useState<string>('1000');
  const [pricePerKgUah, setPricePerKgUah] = useState<string>('650');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (initialMaterial) {
      setName(initialMaterial.name);
      setType(initialMaterial.type);
      setFamily(initialMaterial.family || 'Стандартні');
      setBrand(initialMaterial.brand);
      setColorName(initialMaterial.colorName || '');
      setColorHex(initialMaterial.colorHex || '#1e293b');
      const weight = initialMaterial.spoolWeightGrams || '1000';
      const perKg = initialMaterial.pricePerKgUah ?? '';
      const spoolP = initialMaterial.spoolPriceUah || perKg || '650';

      setSpoolWeightGrams(weight);
      setSpoolPriceUah(spoolP);
      setPricePerKgUah(perKg);
      setNotes(initialMaterial.notes || '');
    } else {
      setName('');
      setType('PETG');
      setFamily('Стандартні');
      setBrand('Bambu Lab');
      setColorName('');
      setColorHex('#1e293b');
      setSpoolWeightGrams('1000');
      setSpoolPriceUah('650');
      setPricePerKgUah('650.00');
      setNotes('');
    }
  }, [initialMaterial, isOpen]);

  // Two-way calculation when changing spool price or weight
  const handleSpoolPriceChange = (val: string) => {
    setSpoolPriceUah(val);
    const p = parseFloat(val);
    const w = parseFloat(spoolWeightGrams) || 1000;
    if (!isNaN(p) && w > 0) {
      setPricePerKgUah(((p / w) * 1000).toFixed(2));
    } else {
      setPricePerKgUah('');
    }
  };

  const handleSpoolWeightChange = (grams: number) => {
    const val = String(grams);
    setSpoolWeightGrams(val);
    const p = parseFloat(spoolPriceUah);
    if (!isNaN(p) && grams > 0) {
      setPricePerKgUah(((p / grams) * 1000).toFixed(2));
    }
  };

  const handlePricePerKgChange = (val: string) => {
    setPricePerKgUah(val);
    const perKg = parseFloat(val);
    const w = parseFloat(spoolWeightGrams) || 1000;
    if (!isNaN(perKg) && w > 0) {
      setSpoolPriceUah(((perKg * w) / 1000).toFixed(0));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
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
        isArchived: initialMaterial ? initialMaterial.isArchived : false,
        notes: notes.trim() || undefined,
      });
      onClose();
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

  const currentGrams = parseFloat(spoolWeightGrams) || 1000;
  const currentPrice = parseFloat(spoolPriceUah) || 0;
  const pricePerGram = currentGrams > 0 ? currentPrice / currentGrams : 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialMaterial ? 'Редагувати матеріал' : 'Додати новий матеріал'}
      description="Внесіть параметри котушки та ціну для точного розрахунку собівартості друку за 1 кг."
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
            Зберегти матеріал
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Назва матеріалу"
          placeholder="напр., Bambu PETG Basic Black"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Тип полімеру
            </label>
            <input
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

        {/* Spool Parameters & Live Calculation Section */}
        <div className="p-4 bg-emerald-50/60 dark:bg-emerald-950/20 rounded-xl border border-emerald-200 dark:border-emerald-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
              <Disc className="w-4 h-4 text-emerald-600" />
              <span>Параметри котушки та ціна закупівлі</span>
            </span>
            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
              Автоматичний розрахунок за 1 кг
            </span>
          </div>

          {/* Quick presets for Spool Weight */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400">
              <span>Вага котушки нетто (грам):</span>
              <span className="font-mono font-bold text-neutral-900 dark:text-white">
                {currentGrams} г
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {COMMON_SPOOLS.map((sp) => (
                <button
                  key={sp.grams}
                  type="button"
                  onClick={() => handleSpoolWeightChange(sp.grams)}
                  className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                    currentGrams === sp.grams
                      ? 'bg-emerald-600 text-white font-bold shadow-2xs'
                      : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  {sp.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <NumberInput
              label="Ціна котушки"
              unit="грн"
              value={spoolPriceUah}
              onChange={handleSpoolPriceChange}
              placeholder="650"
            />

            <NumberInput
              label="Розрахунок за 1 кг"
              unit="грн/кг"
              value={pricePerKgUah}
              onChange={handlePricePerKgChange}
              placeholder="650.00"
            />
          </div>

          {/* Live calculated summary box */}
          <div className="p-2.5 bg-white dark:bg-neutral-900 rounded-lg border border-emerald-200/60 dark:border-emerald-800/60 flex items-center justify-between text-xs">
            <div className="space-y-0.5">
              <span className="text-[10px] text-neutral-400 block">Ціна за 1 грам:</span>
              <span className="font-mono font-bold text-neutral-900 dark:text-white">
                {pricePerGram.toFixed(3)} грн/г
              </span>
            </div>

            <div className="text-right space-y-0.5">
              <span className="text-[10px] text-neutral-400 block">Собівартість 1 кг:</span>
              <span className="font-mono font-black text-emerald-700 dark:text-emerald-300 text-sm">
                {formatUah(pricePerKgUah)}/кг
              </span>
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
