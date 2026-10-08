import React from 'react';
import {
  Heart,
  Scale,
  Palette,
  Disc,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Eye,
  Plus,
  Check,
} from 'lucide-react';
import type {
  ConcreteFilamentSku,
  ManufacturerBrand,
} from '../../domain/filamentsDirectory.ts';
import { formatUah } from '../../domain/formatters.ts';
import { Button } from '../common/Button.tsx';
import { FilamentColorVisual } from './FilamentColorVisual.tsx';

export interface FilamentDirectoryCardProps {
  item: ConcreteFilamentSku;
  manufacturer?: ManufacturerBrand;
  isLiked: boolean;
  onToggleLike: (id: string) => void;
  onAddToWorkshop: (item: ConcreteFilamentSku) => void;
  isAdded: boolean;
  onCalculatePrint: (item: ConcreteFilamentSku) => void;
  onSelectType: (type: string) => void;
  onOpenDetails: (item: ConcreteFilamentSku) => void;
}

export const FilamentDirectoryCard: React.FC<FilamentDirectoryCardProps> = ({
  item,
  manufacturer,
  isLiked,
  onToggleLike,
  onAddToWorkshop,
  isAdded,
  onSelectType,
  onOpenDetails,
}) => {
  const isRefill = item.packagingType === 'refill';

  return (
    <div
      onClick={() => onOpenDetails(item)}
      className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 sm:p-5 flex flex-col justify-between shadow-2xs hover:shadow-md hover:border-emerald-300 dark:hover:border-emerald-700/70 transition-all cursor-pointer relative group"
    >
      <div className="space-y-3.5">
        {/* ROW 1: ВИРОБНИК + ТИП ПЛАСТИКУ + LIKE BUTTON */}
        <div className="flex items-center justify-between pb-2.5 border-b border-neutral-100 dark:border-neutral-800 gap-2">
          {/* 1. ВИРОБНИК */}
          {manufacturer ? (
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`w-7 h-7 rounded-md ${manufacturer.logoBg} flex items-center justify-center font-black text-[10px] ${manufacturer.logoTextColor} tracking-tighter shrink-0`}
              >
                {manufacturer.logoText}
              </div>
              <div className="min-w-0">
                <span className="text-xs font-bold text-neutral-900 dark:text-white block leading-tight truncate">
                  {manufacturer.name}
                </span>
                <span className="text-[10px] text-neutral-500 dark:text-neutral-400 block leading-none truncate">
                  {manufacturer.country}
                </span>
              </div>
            </div>
          ) : (
            <div className="min-w-0">
              <span className="text-xs font-bold text-neutral-900 dark:text-white truncate block">
                {item.brand}
              </span>
            </div>
          )}

          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            {/* 2. ТИП ПЛАСТИКУ */}
            <button
              type="button"
              onClick={() => onSelectType(item.type)}
              className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border border-neutral-200 dark:border-neutral-700 hover:border-emerald-500 shrink-0 cursor-pointer transition-colors"
              title={`Фільтрувати за типом ${item.type}`}
            >
              {item.type}
            </button>

            {/* Like button */}
            <button
              type="button"
              onClick={() => onToggleLike(item.id)}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                isLiked
                  ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400'
                  : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
              title={isLiked ? 'Видалити з обраного' : 'Додати в обране (❤️)'}
              aria-label={isLiked ? 'Видалити з обраного' : 'Додати в обране'}
            >
              <Heart className={`w-4 h-4 ${isLiked ? 'fill-rose-500' : ''}`} />
            </button>
          </div>
        </div>

        {/* ROW 2: НАЗВА ТОВАРУ ТА НАЯВНІСТЬ/ВІДСУТНІСТЬ */}
        <div className="space-y-1.5">
          <h3 className="text-sm sm:text-base font-bold text-neutral-900 dark:text-white leading-tight break-words group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
            {item.name}
          </h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Продавець: {item.companyName || item.storeName}</p>

          {/* 3. НАЯВНІСТЬ / ВІДСУТНІСТЬ */}
          <div className="flex items-center gap-2 flex-wrap">
            {item.inStock ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                <span>{item.stockStatusLabel || 'В наявності'}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded border border-rose-200 dark:border-rose-800">
                <XCircle className="w-3 h-3 text-rose-600 shrink-0" />
                <span>{item.stockStatusLabel || 'Немає в наявності'}</span>
              </span>
            )}

            {/* 4. З КОТУШКОЮ АБО БЕЗ */}
            {isRefill ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-violet-800 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/50 px-2 py-0.5 rounded border border-violet-200 dark:border-violet-800">
                <RefreshCw className="w-3 h-3 text-violet-600 dark:text-violet-400 shrink-0" />
                <span>Без котушки (Рефіл)</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-800 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/50 px-2 py-0.5 rounded border border-sky-200 dark:border-sky-800">
                <Disc className="w-3 h-3 text-sky-600 dark:text-sky-400 shrink-0" />
                <span>З котушкою</span>
              </span>
            )}
          </div>
        </div>

        {/* ROW 3: ПАРАМЕТРИ КАТАЛОГУ (КОЛІР + ВАГА КОТУШКИ) */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          {/* 5. КОЛІР (іконка з кольором та назва, підтримка мультиколору/веселки/дуалу) */}
          <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-xl border border-neutral-100 dark:border-neutral-800 flex items-center gap-2 min-w-0">
            <FilamentColorVisual
              colorHex={item.colorHex}
              colorHexList={item.colorHexList}
              colorType={item.colorType}
              colorName={item.colorName}
              size="md"
            />
            <div className="min-w-0 leading-tight">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-neutral-400 font-medium">Колір:</span>
                {item.isMulticolor && (
                  <span className="text-[9px] font-bold px-1 rounded bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-300">
                    Мульті
                  </span>
                )}
              </div>
              <span
                className="text-xs font-bold text-neutral-900 dark:text-white truncate block"
                title={item.colorName}
              >
                {item.colorName}
              </span>
            </div>
          </div>

          {/* 6. ВАГА КОТУШКИ */}
          <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-xl border border-neutral-100 dark:border-neutral-800 flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <Scale className="w-3 h-3" />
            </div>
            <div className="min-w-0 leading-tight">
              <span className="text-[10px] text-neutral-400 block font-medium">Вага:</span>
              <span className="text-xs font-bold text-neutral-900 dark:text-white truncate block">
                {item.weightKgDisplay} ({item.spoolWeightGrams} г)
              </span>
            </div>
          </div>
        </div>

        {/* ЦІНА ТА ЕКОНОМІКА */}
        <div className="p-2.5 bg-emerald-50/70 dark:bg-emerald-950/30 rounded-xl border border-emerald-200/70 dark:border-emerald-800/60 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-neutral-500 block">Ціна за котушку:</span>
            <span className="text-base font-black font-mono text-neutral-900 dark:text-white leading-none">
              {formatUah(item.priceUah)}
            </span>
          </div>

          <div className="text-right">
            <span className="text-[10px] text-neutral-500 block">За 1 кг:</span>
            <span className="text-xs font-bold font-mono text-emerald-700 dark:text-emerald-300">
              {formatUah(item.calculatedPricePerKg)} / кг
            </span>
          </div>
        </div>
      </div>

      {/* КНОПКИ ДІЙ: ДЕТАЛЬНІШЕ (ПОПАП) ТА В КАБІНЕТ */}
      <div
        className="pt-3 mt-3 border-t border-neutral-100 dark:border-neutral-800 flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs font-semibold justify-center bg-white dark:bg-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-700"
          leftIcon={<Eye className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
          onClick={() => onOpenDetails(item)}
        >
          Детальніше
        </Button>

        <Button
          variant={isAdded ? 'primary' : 'outline'}
          size="sm"
          className="text-xs font-medium justify-center shrink-0 px-2.5"
          onClick={() => onAddToWorkshop(item)}
          title={isAdded ? 'Додано у кабінет' : 'Додати у мій кабінет'}
        >
          {isAdded ? (
            <Check className="w-3.5 h-3.5 text-white" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
};
