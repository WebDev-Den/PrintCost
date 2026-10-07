import React, { useState, useEffect, useMemo } from 'react';
import {
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
  Tag,
  Disc,
} from 'lucide-react';
import type {
  PublicFilamentItem,
  ManufacturerBrand,
  PopularColorItem,
  FilamentStoreLink,
} from '../../domain/filamentsDirectory.ts';
import { getFilamentEffectiveTemp } from '../../domain/filamentsDirectory.ts';
import { formatUah } from '../../domain/formatters.ts';
import { Button } from '../common/Button.tsx';

interface FilamentDirectoryCardProps {
  filament: PublicFilamentItem;
  manufacturer?: ManufacturerBrand;
  isLiked: boolean;
  onToggleLike: (id: string) => void;
  onAddToWorkshop: (f: PublicFilamentItem, colorName?: string, colorHex?: string) => void;
  isAdded: boolean;
  activeColorToneFilter: string;
  onCalculatePrint: (f: PublicFilamentItem, selectedColor?: PopularColorItem) => void;
  onSelectType: (type: string) => void;
}

export const FilamentDirectoryCard: React.FC<FilamentDirectoryCardProps> = ({
  filament: f,
  manufacturer,
  isLiked,
  onToggleLike,
  onAddToWorkshop,
  isAdded,
  activeColorToneFilter,
  onCalculatePrint,
  onSelectType,
}) => {
  // Determine initial color index based on active filter or default to 0
  const colors = f.popularColors || [];
  const defaultIdx = useMemo(() => {
    if (activeColorToneFilter !== 'all' && colors.length > 0) {
      const idx = colors.findIndex((c) => c.colorTone === activeColorToneFilter);
      if (idx !== -1) return idx;
    }
    return 0;
  }, [activeColorToneFilter, colors]);

  const [selectedColorIdx, setSelectedColorIdx] = useState<number>(defaultIdx);

  // Sync when activeColorToneFilter changes
  useEffect(() => {
    if (activeColorToneFilter !== 'all' && colors.length > 0) {
      const idx = colors.findIndex((c) => c.colorTone === activeColorToneFilter);
      if (idx !== -1) setSelectedColorIdx(idx);
    }
  }, [activeColorToneFilter, colors]);

  const selectedColor: PopularColorItem | undefined = colors[selectedColorIdx] || colors[0];
  const tempInfo = getFilamentEffectiveTemp(f);

  // Store links for this exact selected color and manufacturer
  const effectiveStoreLinks: FilamentStoreLink[] = useMemo(() => {
    if (selectedColor && selectedColor.stores && selectedColor.stores.length > 0) {
      return selectedColor.stores;
    }
    // If color-specific stores not directly attached, generate specific links for this color
    return f.stores.map((st) => {
      const colorLabel = selectedColor ? selectedColor.name : 'Стандартний';
      return {
        ...st,
        productTitle: st.productTitle || `${f.brand} ${f.type} ${colorLabel} (${f.spoolWeightGrams} г)`,
        colorName: colorLabel,
        spoolWeightGrams: st.spoolWeightGrams || f.spoolWeightGrams,
      };
    });
  }, [selectedColor, f]);

  // Primary store price for summary display
  const primaryStore = effectiveStoreLinks[0];
  const spoolPrice = primaryStore?.priceUah || Math.round((f.approxPricePerKgUah * f.spoolWeightGrams) / 1000);
  const spoolGrams = primaryStore?.spoolWeightGrams || f.spoolWeightGrams;
  const calculatedPricePerKg = (spoolPrice / spoolGrams) * 1000;
  const pricePerGram = spoolPrice / spoolGrams;

  return (
    <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 space-y-4 shadow-2xs flex flex-col justify-between hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors relative">
      <div className="space-y-3.5">
        {/* Row 1: 1 Manufacturer Header + Website + Like Button */}
        <div className="flex items-center justify-between pb-2.5 border-b border-neutral-100 dark:border-neutral-800">
          {manufacturer ? (
            <div className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-md ${manufacturer.logoBg} flex items-center justify-center font-black text-[10px] ${manufacturer.logoTextColor} tracking-tighter shrink-0`}
              >
                {manufacturer.logoText}
              </div>
              <div>
                <span className="text-xs font-bold text-neutral-900 dark:text-white block leading-tight">
                  {manufacturer.name}
                </span>
                <span className="text-[10px] text-neutral-400 block leading-none">
                  {manufacturer.country}
                </span>
              </div>
            </div>
          ) : (
            <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200">
              {f.brand}
            </span>
          )}

          <div className="flex items-center gap-2">
            {/* Manufacturer Website */}
            {manufacturer?.website && (
              <a
                href={manufacturer.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-neutral-500 hover:text-emerald-600 dark:hover:text-emerald-400 flex items-center gap-1 font-medium transition-colors"
                title={`Офіційний сайт виробника ${manufacturer.name}`}
              >
                <Globe className="w-3 h-3 text-neutral-400" />
                <span>Сайт бренду</span>
                <ExternalLink className="w-2.5 h-2.5 opacity-70" />
              </a>
            )}

            {/* Like / Favorite Button */}
            <button
              type="button"
              onClick={() => onToggleLike(f.id)}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                isLiked
                  ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400'
                  : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
              title={isLiked ? 'Видалити з обраного' : 'Додати в обране (відстежувати)'}
            >
              <Heart className={`w-4 h-4 ${isLiked ? 'fill-rose-500' : ''}`} />
            </button>
          </div>
        </div>

        {/* Row 2: Title, Stock Status & Filterable Plastic Type Badge */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-neutral-900 dark:text-white leading-tight">
              {f.name}
            </h3>

            {/* In Stock or Out of Stock Badge */}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {f.inStock ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  <span>{f.stockStatusLabel || 'В наявності'}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded border border-rose-200 dark:border-rose-800">
                  <XCircle className="w-3 h-3 text-rose-600" />
                  <span>{f.stockStatusLabel || 'Немає в наявності'}</span>
                </span>
              )}

              {f.badge && (
                <span className="text-[10px] text-neutral-600 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded font-medium">
                  {f.badge}
                </span>
              )}
            </div>
          </div>

          {/* Filterable Plastic Type Badge */}
          <button
            type="button"
            onClick={() => onSelectType(f.type)}
            className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border border-neutral-200 dark:border-neutral-700 hover:border-emerald-500 shrink-0 cursor-pointer"
            title={`Фільтрувати за типом ${f.type}`}
          >
            {f.type}
          </button>
        </div>

        <p className="text-xs text-neutral-600 dark:text-neutral-400 line-clamp-2 leading-relaxed">
          {f.description}
        </p>

        {/* Row 3: 1 Color Selection Interactive Bar */}
        <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/40 rounded-xl space-y-2 border border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
              <span>Виберіть колір (1 колір):</span>
            </span>
            {selectedColor && (
              <span className="text-[11px] font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                <span
                  className="w-3 h-3 rounded-full border border-neutral-300 dark:border-neutral-600 inline-block shadow-2xs"
                  style={{ backgroundColor: selectedColor.hex }}
                />
                <span>{selectedColor.name}</span>
              </span>
            )}
          </div>

          {/* Color Chips with Click to Select */}
          <div className="flex items-center gap-2 flex-wrap">
            {colors.map((c, idx) => {
              const isSelected = selectedColorIdx === idx;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedColorIdx(idx)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer border ${
                    isSelected
                      ? 'border-emerald-600 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white font-bold ring-2 ring-emerald-500/30 shadow-2xs'
                      : 'border-transparent bg-neutral-200/60 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200'
                  }`}
                  title={`Вибрати ${c.name} для перегляду прямих цін і посилань`}
                >
                  <span
                    className="w-3 h-3 rounded-full border border-neutral-400/80 dark:border-neutral-600 shrink-0 shadow-2xs"
                    style={{ backgroundColor: c.hex }}
                  />
                  <span>{c.name.split(' ')[0]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 4: Temperature Profiles */}
        <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/40 rounded-xl space-y-1.5 border border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-neutral-500 font-medium flex items-center gap-1">
              <Thermometer className="w-3.5 h-3.5 text-red-500" />
              <span>Температури друку:</span>
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                tempInfo.isCustom
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
              }`}
            >
              {tempInfo.isCustom ? 'Профіль бренду' : 'Стандартний профіль'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs pt-0.5">
            <div className="bg-white dark:bg-neutral-900/80 p-1.5 rounded-lg border border-neutral-200/60 dark:border-neutral-700/60">
              <span className="text-[10px] text-neutral-400 block">Сопло (Nozzle):</span>
              <span className="font-mono font-bold text-neutral-900 dark:text-white">
                {tempInfo.nozzle}
              </span>
            </div>
            <div className="bg-white dark:bg-neutral-900/80 p-1.5 rounded-lg border border-neutral-200/60 dark:border-neutral-700/60">
              <span className="text-[10px] text-neutral-400 block">Стіл (Bed):</span>
              <span className="font-mono font-bold text-neutral-900 dark:text-white">
                {tempInfo.bed}
              </span>
            </div>
          </div>
        </div>

        {/* Row 5: Spool & Per Kg Calculation Highlight */}
        <div className="p-3 bg-emerald-50/60 dark:bg-emerald-950/20 rounded-xl border border-emerald-200/70 dark:border-emerald-800/60 flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider block flex items-center gap-1">
              <Disc className="w-3 h-3 text-emerald-600" />
              <span>Котушка {spoolGrams} г ({spoolGrams >= 1000 ? `${spoolGrams / 1000} кг` : `${spoolGrams}г`})</span>
            </span>
            <div className="text-xs text-neutral-600 dark:text-neutral-400">
              Ціна котушки: <span className="font-mono font-bold text-neutral-900 dark:text-white">{formatUah(spoolPrice)}</span>
            </div>
            <div className="text-[11px] text-neutral-500">
              За 1 грам: <span className="font-mono font-semibold">{pricePerGram.toFixed(2)} грн/г</span>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] text-neutral-500 block">Розрахунок за кг:</span>
            <span className="text-xl font-black font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
              {formatUah(calculatedPricePerKg)}
            </span>
            <span className="text-[11px] text-neutral-500 font-medium block">/ 1 кг</span>
          </div>
        </div>

        {/* Row 6: 1 Product Page per Seller (1 колір · 1 виробник · Сторінка товару продавця) */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold text-neutral-700 dark:text-neutral-300 flex items-center gap-1">
              <ShoppingCart className="w-3.5 h-3.5 text-neutral-400" />
              <span>Сторінка товару продавця:</span>
            </span>
            <span className="text-[10px] text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.5 rounded font-medium">
              1 колір · 1 виробник
            </span>
          </div>

          <div className="space-y-1.5">
            {effectiveStoreLinks.map((st, i) => {
              const stPrice = st.priceUah;
              const stGrams = st.spoolWeightGrams || spoolGrams;
              const stPerKg = (stPrice / stGrams) * 1000;

              return (
                <a
                  key={i}
                  href={st.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-2 rounded-xl bg-neutral-50 dark:bg-neutral-800/50 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/30 border border-neutral-200/70 dark:border-neutral-700/70 hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-neutral-800 dark:text-neutral-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 flex items-center gap-1">
                      <span>{st.storeName}</span>
                      {st.isOfficialDistributor && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 font-normal">
                          Офіційний
                        </span>
                      )}
                    </span>
                    <span className="font-mono tabular-nums text-sm font-bold text-neutral-900 dark:text-white shrink-0">
                      {stPrice} грн
                    </span>
                  </div>

                  {/* Direct Product Title */}
                  <div className="text-[11px] text-neutral-600 dark:text-neutral-400 truncate mt-0.5">
                    {st.productTitle || `${f.brand} ${f.type} ${selectedColor?.name || ''}`}
                  </div>

                  {/* Calculated per-kg rate and direct product page action */}
                  <div className="flex items-center justify-between text-[10px] pt-1 text-neutral-500">
                    <span className="font-mono">
                      Розрахунок: <strong className="text-emerald-700 dark:text-emerald-400">{stPerKg.toFixed(2)} грн/кг</strong>
                    </span>

                    <span className="text-emerald-600 dark:text-emerald-400 group-hover:underline flex items-center gap-0.5 font-semibold">
                      <span>Перейти до товару</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </span>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      </div>

      {/* Card Actions */}
      <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800 flex items-center gap-2">
        <Button
          variant={isAdded ? 'primary' : 'outline'}
          size="sm"
          className="w-full text-xs font-semibold"
          leftIcon={isAdded ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          onClick={() => onAddToWorkshop(f, selectedColor?.name, selectedColor?.hex)}
        >
          {isAdded ? 'Додано у кабінет!' : 'Додати у мій кабінет'}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="text-xs shrink-0 font-bold text-emerald-700 dark:text-emerald-400"
          onClick={() => onCalculatePrint(f, selectedColor)}
          title="Відкрити калькулятор собівартості з цим філаментом"
          leftIcon={<Calculator className="w-3.5 h-3.5" />}
        >
          Розрахунок FDM
        </Button>
      </div>
    </div>
  );
};
