import React, { useRef } from 'react';
import {
  X,
  ExternalLink,
  Heart,
  Globe,
  Thermometer,
  ShoppingCart,
  Plus,
  Check,
  Calculator,
  CheckCircle2,
  XCircle,
  Scale,
  Palette,
  Disc,
  RefreshCw,
  Wind,
  Box,
  Clock,
  Flame,
  Info,
} from 'lucide-react';
import type {
  ConcreteFilamentSku,
  ManufacturerBrand,
} from '../../domain/filamentsDirectory.ts';
import { STANDARD_TEMPERATURE_PROFILES } from '../../domain/filamentsDirectory.ts';
import { formatUah } from '../../domain/formatters.ts';
import { Button } from '../common/Button.tsx';
import { FilamentColorVisual } from './FilamentColorVisual.tsx';
import { useDialogFocus } from '../common/useDialogFocus.ts';

interface FilamentDetailsModalProps {
  sku: ConcreteFilamentSku | null;
  manufacturer?: ManufacturerBrand;
  isOpen: boolean;
  onClose: () => void;
  isLiked: boolean;
  onToggleLike: (id: string) => void;
  onAddToWorkshop: (sku: ConcreteFilamentSku) => void;
  isAdded: boolean;
  onCalculatePrint: (sku: ConcreteFilamentSku) => void;
  onSellerClick?: (sku: ConcreteFilamentSku) => void;
}

export const FilamentDetailsModal: React.FC<FilamentDetailsModalProps> = ({
  sku,
  manufacturer,
  isOpen,
  onClose,
  isLiked,
  onToggleLike,
  onAddToWorkshop,
  isAdded,
  onCalculatePrint,
  onSellerClick,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, isOpen, onClose);

  if (!isOpen || !sku) return null;

  const isRefill = sku.packagingType === 'refill';
  const standardProfile = STANDARD_TEMPERATURE_PROFILES[sku.type];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-neutral-900/60 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="filament-modal-title"
        className="relative w-full max-w-2xl bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden z-10 flex flex-col max-h-[92vh] my-auto animate-in fade-in zoom-in-95 duration-150"
      >
        {/* HEADER */}
        <div className="px-5 py-4 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-3 bg-neutral-50/70 dark:bg-neutral-900/80">
          {/* Manufacturer & Country */}
          <div className="flex items-center gap-2.5 min-w-0">
            {manufacturer ? (
              <>
                <div
                  className={`w-8 h-8 rounded-lg ${manufacturer.logoBg} flex items-center justify-center font-black text-xs ${manufacturer.logoTextColor} tracking-tighter shrink-0 shadow-2xs`}
                >
                  {manufacturer.logoText}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-neutral-900 dark:text-white truncate">
                      {manufacturer.name}
                    </span>
                    <span className="text-[11px] text-neutral-500 dark:text-neutral-400 hidden xs:inline truncate">
                      ({manufacturer.country})
                    </span>
                  </div>
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 block font-medium">
                    {sku.companyId ? `Пропозиція компанії ${sku.companyName || sku.storeName}` : 'Профіль виробника з каталогу'}
                  </span>
                </div>
              </>
            ) : (
              <div>
                <span className="text-sm font-bold text-neutral-900 dark:text-white">
                  {sku.brand}
                </span>
                {sku.companyName && <p className="text-xs text-neutral-500">Продавець: {sku.companyName}</p>}
              </div>
            )}
          </div>

          {/* Right Action Icons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {manufacturer?.website && (
              <a
                href={manufacturer.website}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-xl text-neutral-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors inline-flex items-center gap-1 text-xs"
                title={`Офіційний сайт ${manufacturer.name}`}
              >
                <Globe className="w-4 h-4" />
                <span className="hidden sm:inline text-xs">Сайт бренду</span>
                <ExternalLink className="w-3 h-3 opacity-60" />
              </a>
            )}

            <button
              type="button"
              onClick={() => onToggleLike(sku.id)}
              className={`p-2 rounded-xl transition-colors cursor-pointer ${
                isLiked
                  ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400'
                  : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
              title={isLiked ? 'Видалити з обраного' : 'Додати в обране (❤️)'}
            >
              <Heart className={`w-4 h-4 ${isLiked ? 'fill-rose-500' : ''}`} />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              aria-label="Закрити"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* MODAL BODY (Scrollable) */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 text-sm text-neutral-700 dark:text-neutral-300">
          {/* TITLE & BADGES */}
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <h2
                id="filament-modal-title"
                className="text-lg sm:text-xl font-black text-neutral-900 dark:text-white leading-snug"
              >
                {sku.name}
              </h2>
              <span className="font-mono font-bold text-sm px-2.5 py-1 rounded-lg bg-neutral-900 text-white dark:bg-emerald-600 shrink-0">
                {sku.type}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Статус наявності */}
              {sku.inStock ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{sku.stockStatusLabel || 'В наявності'}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 px-2.5 py-1 rounded-lg border border-rose-200 dark:border-rose-800">
                  <XCircle className="w-3.5 h-3.5 text-rose-600" />
                  <span>{sku.stockStatusLabel || 'Немає в наявності'}</span>
                </span>
              )}

              {/* Фасування: З котушкою або Рефіл */}
              {isRefill ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-violet-800 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/50 px-2.5 py-1 rounded-lg border border-violet-200 dark:border-violet-800">
                  <RefreshCw className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                  <span>Без котушки / Рефіл (Refill)</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-sky-800 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/50 px-2.5 py-1 rounded-lg border border-sky-200 dark:border-sky-800">
                  <Disc className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                  <span>З котушкою (Spool)</span>
                </span>
              )}

              <span className="text-xs text-neutral-600 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 rounded-lg font-medium">
                Група: {sku.family}
              </span>

              {sku.badge && (
                <span className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 px-2.5 py-1 rounded-lg font-medium border border-amber-200/80 dark:border-amber-800">
                  {sku.badge}
                </span>
              )}
            </div>
          </div>

          {/* KEY SPECS GRID (Колір, Вага, Фасування, Діаметр) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {/* 1. Колір */}
            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200/70 dark:border-neutral-700/60 space-y-1">
              <span className="text-[11px] text-neutral-400 dark:text-neutral-500 font-medium flex items-center gap-1">
                <Palette className="w-3.5 h-3.5 text-indigo-500" />
                <span>Колір:</span>
                {sku.isMulticolor && (
                  <span className="text-[9px] font-bold px-1 rounded bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300 ml-auto">
                    Мультиколір
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2 pt-0.5 min-w-0">
                <FilamentColorVisual
                  colorHex={sku.colorHex}
                  colorHexList={sku.colorHexList}
                  colorType={sku.colorType}
                  colorName={sku.colorName}
                  size="md"
                />
                <span className="text-xs font-bold text-neutral-900 dark:text-white truncate">
                  {sku.colorName}
                </span>
              </div>
            </div>

            {/* 2. Вага котушки */}
            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200/70 dark:border-neutral-700/60 space-y-1">
              <span className="text-[11px] text-neutral-400 dark:text-neutral-500 font-medium flex items-center gap-1">
                <Scale className="w-3.5 h-3.5 text-emerald-500" />
                <span>Вага котушки:</span>
              </span>
              <div className="pt-0.5">
                <span className="text-xs font-black text-neutral-900 dark:text-white">
                  {sku.weightKgDisplay}
                </span>
                <span className="text-[11px] text-neutral-500 ml-1">
                  ({sku.spoolWeightGrams} г)
                </span>
              </div>
            </div>

            {/* 3. Фасування */}
            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200/70 dark:border-neutral-700/60 space-y-1">
              <span className="text-[11px] text-neutral-400 dark:text-neutral-500 font-medium flex items-center gap-1">
                {isRefill ? (
                  <RefreshCw className="w-3.5 h-3.5 text-violet-500" />
                ) : (
                  <Disc className="w-3.5 h-3.5 text-sky-500" />
                )}
                <span>Фасування:</span>
              </span>
              <div className="pt-0.5">
                <span className="text-xs font-bold text-neutral-900 dark:text-white truncate block">
                  {isRefill ? 'Рефіл (без котушки)' : 'З котушкою'}
                </span>
              </div>
            </div>

            {/* 4. Діаметр */}
            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200/70 dark:border-neutral-700/60 space-y-1">
              <span className="text-[11px] text-neutral-400 dark:text-neutral-500 font-medium flex items-center gap-1">
                <Box className="w-3.5 h-3.5 text-amber-500" />
                <span>Діаметр нитки:</span>
              </span>
              <div className="pt-0.5">
                <span className="text-xs font-mono font-bold text-neutral-900 dark:text-white">
                  {sku.diameterMm} мм
                </span>
              </div>
            </div>
          </div>

          {/* PRICING & ECONOMICS CARD */}
          <div className="p-4 bg-emerald-50/70 dark:bg-emerald-950/30 rounded-2xl border border-emerald-200 dark:border-emerald-800/60 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5">
                <Calculator className="w-4 h-4 text-emerald-600" />
                <span>Вартість та економіка матеріалу</span>
              </span>
              <span className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                Ціна з каталогу
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white/80 dark:bg-neutral-900/80 p-3 rounded-xl border border-emerald-200/60 dark:border-emerald-800/50">
                <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">
                  Ціна за цю котушку:
                </span>
                <span className="text-lg font-black font-mono text-neutral-900 dark:text-white block mt-0.5">
                  {formatUah(sku.priceUah)}
                </span>
              </div>

              <div className="bg-white/80 dark:bg-neutral-900/80 p-3 rounded-xl border border-emerald-200/60 dark:border-emerald-800/50">
                <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">
                  Розрахунок за 1 кг (1000 г):
                </span>
                <span className="text-lg font-black font-mono text-emerald-700 dark:text-emerald-300 block mt-0.5">
                  {formatUah(sku.calculatedPricePerKg)} / кг
                </span>
              </div>

              <div className="bg-white/80 dark:bg-neutral-900/80 p-3 rounded-xl border border-emerald-200/60 dark:border-emerald-800/50">
                <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">
                  Ціна за 1 грам:
                </span>
                <span className="text-lg font-black font-mono text-neutral-900 dark:text-white block mt-0.5">
                  {sku.pricePerGram.toFixed(2)} грн / г
                </span>
              </div>
            </div>
          </div>

          {/* PRINT PROFILE (1 ПРОФІЛЬ ДРУКУ) */}
          <div className="p-4 bg-neutral-50 dark:bg-neutral-800/40 rounded-2xl border border-neutral-200 dark:border-neutral-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                <Thermometer className="w-4 h-4 text-amber-500" />
                <span>Рекомендований профіль 3D-друку</span>
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                  sku.profileIsCustom
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                    : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300'
                }`}
              >
                {sku.profileIsCustom ? 'Заводський профіль' : 'Стандартний профіль'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <div className="bg-white dark:bg-neutral-900 p-2.5 rounded-xl border border-neutral-200/70 dark:border-neutral-700/70">
                <span className="text-[11px] text-neutral-400 block flex items-center gap-1">
                  <Flame className="w-3 h-3 text-red-500" />
                  <span>Сопло (Hotend):</span>
                </span>
                <span className="text-sm font-mono font-bold text-neutral-900 dark:text-white block mt-0.5">
                  {sku.profileNozzle}
                </span>
              </div>

              <div className="bg-white dark:bg-neutral-900 p-2.5 rounded-xl border border-neutral-200/70 dark:border-neutral-700/70">
                <span className="text-[11px] text-neutral-400 block flex items-center gap-1">
                  <Flame className="w-3 h-3 text-amber-500" />
                  <span>Стіл (Bed):</span>
                </span>
                <span className="text-sm font-mono font-bold text-neutral-900 dark:text-white block mt-0.5">
                  {sku.profileBed}
                </span>
              </div>

              <div className="bg-white dark:bg-neutral-900 p-2.5 rounded-xl border border-neutral-200/70 dark:border-neutral-700/70">
                <span className="text-[11px] text-neutral-400 block flex items-center gap-1">
                  <Box className="w-3 h-3 text-purple-500" />
                  <span>Камера:</span>
                </span>
                <span className="text-xs font-semibold text-neutral-900 dark:text-white block mt-0.5 truncate">
                  {sku.profileChamber || standardProfile?.chamberRange || (sku.companyId ? 'Уточніть у виробника' : 'Кімнатна')}
                </span>
              </div>

              <div className="bg-white dark:bg-neutral-900 p-2.5 rounded-xl border border-neutral-200/70 dark:border-neutral-700/70">
                <span className="text-[11px] text-neutral-400 block flex items-center gap-1">
                  <Wind className="w-3 h-3 text-cyan-500" />
                  <span>Обдув деталі (Fan):</span>
                </span>
                <span className="text-xs font-semibold text-neutral-900 dark:text-white block mt-0.5 truncate">
                  {sku.profileFan || standardProfile?.fanSpeed || (sku.companyId ? 'Уточніть у виробника' : '100%')}
                </span>
              </div>

              <div className="bg-white dark:bg-neutral-900 p-2.5 rounded-xl border border-neutral-200/70 dark:border-neutral-700/70">
                <span className="text-[11px] text-neutral-400 block flex items-center gap-1">
                  <Clock className="w-3 h-3 text-blue-500" />
                  <span>Швидкість друку:</span>
                </span>
                <span className="text-xs font-semibold text-neutral-900 dark:text-white block mt-0.5 truncate">
                  {sku.profileSpeed || (sku.companyId ? 'Уточніть у виробника' : 'до 200–300 мм/с')}
                </span>
              </div>

              <div className="bg-white dark:bg-neutral-900 p-2.5 rounded-xl border border-neutral-200/70 dark:border-neutral-700/70">
                <span className="text-[11px] text-neutral-400 block flex items-center gap-1">
                  <Flame className="w-3 h-3 text-orange-500" />
                  <span>Сушіння нитки:</span>
                </span>
                <span className="text-xs font-semibold text-neutral-900 dark:text-white block mt-0.5 truncate">
                  {standardProfile?.dryingTempTime || (sku.companyId ? 'Уточніть у виробника' : 'Не вимагає')}
                </span>
              </div>
            </div>

            {/* Notes for slicer */}
            {(sku.profileNotes || standardProfile?.notes) && (
              <div className="p-3 bg-amber-50/60 dark:bg-amber-950/20 rounded-xl border border-amber-200/60 dark:border-amber-800/40 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  {sku.profileNotes || standardProfile?.notes}
                </p>
              </div>
            )}
          </div>

          {/* DIRECT STORE PURCHASE (1 СИЛКА НА ТОВАР) */}
          <div className="p-4 bg-neutral-900 dark:bg-neutral-800 rounded-2xl text-white space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-300 flex items-center gap-1.5">
                <ShoppingCart className="w-4 h-4 text-emerald-400" />
                <span>Пряме посилання на товар у продавця</span>
              </span>
              <span className="text-[11px] text-emerald-400 font-medium">
                {sku.companyId ? 'Пропозиція компанії' : sku.isOfficialDistributor ? 'Офіційний дистриб’ютор' : 'Магазин каталогу'}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
              <div>
                <span className="text-sm font-bold block">
                  {sku.storeName}
                </span>
                <span className="text-xs text-neutral-400 block mt-0.5">
                  Пряма сторінка товару: {sku.weightKgDisplay}, {sku.colorName}
                </span>
              </div>

              <a
                href={sku.storeUrl}
                onClick={() => onSellerClick?.(sku)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-xs flex items-center justify-center gap-2 transition-colors shrink-0 shadow-sm"
              >
                <span>Перейти в магазин</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* DESCRIPTION */}
          {sku.description && (
            <div className="space-y-1.5 pt-1">
              <span className="text-xs font-bold text-neutral-900 dark:text-white block">
                Опис та характеристики:
              </span>
              <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed bg-neutral-50 dark:bg-neutral-800/40 p-3.5 rounded-xl border border-neutral-200/60 dark:border-neutral-800">
                {sku.description}
              </p>
            </div>
          )}
        </div>

        {/* MODAL FOOTER ACTIONS */}
        <div className="px-5 py-3.5 bg-neutral-50 dark:bg-neutral-900/90 border-t border-neutral-200 dark:border-neutral-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span>Ціна:</span>
            <span className="font-mono font-bold text-base text-neutral-900 dark:text-white">
              {formatUah(sku.priceUah)}
            </span>
            <span className="text-[11px]">({formatUah(sku.calculatedPricePerKg)}/кг)</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={isAdded ? 'primary' : 'outline'}
              size="sm"
              className="flex-1 sm:flex-none text-xs font-semibold justify-center"
              leftIcon={isAdded ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              onClick={() => onAddToWorkshop(sku)}
            >
              {isAdded ? 'Додано у кабінет!' : 'Додати у мій кабінет'}
            </Button>

            <Button
              variant="primary"
              size="sm"
              className="flex-1 sm:flex-none text-xs font-bold justify-center"
              leftIcon={<Calculator className="w-3.5 h-3.5" />}
              onClick={() => {
                onCalculatePrint(sku);
                onClose();
              }}
            >
              Розрахунок FDM
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
