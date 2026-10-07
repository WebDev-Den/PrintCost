import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal.tsx';
import { Button } from '../common/Button.tsx';
import { Input } from '../common/Input.tsx';
import { NumberInput } from '../common/NumberInput.tsx';
import type { MaterialProfile } from '../../domain/types.ts';
import { Calculator } from 'lucide-react';

interface MaterialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Omit<MaterialProfile, 'id' | 'createdAt'>) => Promise<void>;
  initialMaterial?: MaterialProfile | null;
}

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
  const [pricePerKgUah, setPricePerKgUah] = useState<string>('650');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Spool calculator helper state
  const [showSpoolCalc, setShowSpoolCalc] = useState(false);
  const [spoolPrice, setSpoolPrice] = useState('650');
  const [spoolWeightGrams, setSpoolWeightGrams] = useState('1000');

  useEffect(() => {
    if (initialMaterial) {
      setName(initialMaterial.name);
      setType(initialMaterial.type);
      setFamily(initialMaterial.family || 'Стандартні');
      setBrand(initialMaterial.brand);
      setColorName(initialMaterial.colorName || '');
      setColorHex(initialMaterial.colorHex || '#1e293b');
      setPricePerKgUah(initialMaterial.pricePerKgUah ?? '');
      setNotes(initialMaterial.notes || '');
    } else {
      setName('');
      setType('PETG');
      setFamily('Стандартні');
      setBrand('Bambu Lab');
      setColorName('');
      setColorHex('#1e293b');
      setPricePerKgUah('');
      setNotes('');
    }
  }, [initialMaterial, isOpen]);

  const handleApplySpoolCalc = () => {
    const p = parseFloat(spoolPrice);
    const w = parseFloat(spoolWeightGrams);
    if (!isNaN(p) && !isNaN(w) && w > 0) {
      const perKg = (p / (w / 1000)).toFixed(2);
      setPricePerKgUah(perKg);
      setShowSpoolCalc(false);
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialMaterial ? 'Редагувати матеріал' : 'Додати новий матеріал'}
      description="Внесіть параметри котушки та ціну закупівлі для розрахунку собівартості."
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
              className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 uppercase"
              required
            />
            <p className="text-[11px] text-neutral-500">Довільний тип, без обмеження каталогу</p>
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
            placeholder="Bambu Lab, eSUN, Devil Design..."
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

        {/* Price per Kg & Spool Helper */}
        <div className="p-3.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-xl border border-neutral-200 dark:border-neutral-700/80 space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold text-neutral-800 dark:text-neutral-200">
              Ціна за кілограм (грн/кг)
            </label>
            <button
              type="button"
              onClick={() => setShowSpoolCalc(!showSpoolCalc)}
              className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <Calculator className="w-3.5 h-3.5" />
              <span>{showSpoolCalc ? 'Приховати калькулятор' : 'Перерахувати з ціни котушки'}</span>
            </button>
          </div>

          <NumberInput
            value={pricePerKgUah}
            onChange={(v) => setPricePerKgUah(v)}
            unit="грн/кг"
            placeholder="Залиште порожнім, якщо ціна невідома"
            helperText="Якщо ціну не вказано, матеріал позначиться як «Не задано»."
          />

          {showSpoolCalc && (
            <div className="p-3 bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-700 space-y-2.5">
              <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Калькулятор перерахунку з котушки:
              </p>
              <div className="grid grid-cols-2 gap-2">
                <NumberInput
                  label="Ціна котушки"
                  unit="грн"
                  value={spoolPrice}
                  onChange={(v) => setSpoolPrice(v)}
                  placeholder="650"
                />
                <NumberInput
                  label="Маса нетто котушки"
                  unit="г"
                  value={spoolWeightGrams}
                  onChange={(v) => setSpoolWeightGrams(v)}
                  placeholder="1000"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={handleApplySpoolCalc}
              >
                Застосувати результат до поля «Ціна за кг»
              </Button>
            </div>
          )}
        </div>

        <Input
          label="Примітки (опціонально)"
          placeholder="Специфіка сушіння, адгезії або номер партії..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </form>
    </Modal>
  );
};
