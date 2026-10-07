import React from 'react';
import { Layers, Info, Check } from 'lucide-react';
import type { ParsedPlate } from '../../domain/types.ts';
import { formatDurationUk, formatWeightUk } from '../../domain/formatters.ts';

interface PlatesSelectorProps {
  plates: ParsedPlate[];
  onTogglePlate: (plateIndex: number) => void;
  onChangeRepeats: (plateIndex: number, count: number) => void;
}

export const PlatesSelector: React.FC<PlatesSelectorProps> = ({
  plates,
  onTogglePlate,
  onChangeRepeats,
}) => {
  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 space-y-4 shadow-2xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Пластини друку у проєкті
          </h3>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          <Info className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
          <span>Повтор — це друк усієї нарізаної пластини, а не кількість деталей на ній.</span>
        </div>
      </div>

      <div className="space-y-2.5">
        {plates.map((plate) => {
          const isSelected = plate.selected;
          return (
            <div
              key={plate.plateIndex}
              className={`p-3.5 rounded-lg border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                isSelected
                  ? 'border-emerald-300 dark:border-emerald-800/80 bg-emerald-50/20 dark:bg-emerald-950/10'
                  : 'border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/40 opacity-70'
              }`}
            >
              {/* Checkbox and Plate Info */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onTogglePlate(plate.plateIndex)}
                  className={`w-5 h-5 rounded flex items-center justify-center border transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800'
                  }`}
                  aria-label={`Включити пластину ${plate.plateName} у розрахунок`}
                >
                  {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </button>

                <div>
                  <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                    {plate.plateName}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 font-mono tabular-nums mt-0.5">
                    <span>{formatDurationUk(plate.predictionSeconds)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatWeightUk(plate.totalWeightGrams)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{plate.filaments.length} філамент(и)</span>
                  </div>
                </div>
              </div>

              {/* Repeats Counter */}
              <div className="flex items-center gap-2 self-end sm:self-center">
                <span className="text-xs text-neutral-600 dark:text-neutral-400 font-medium">
                  Кількість запусків:
                </span>
                <div className="flex items-center border border-neutral-300 dark:border-neutral-700 rounded-lg overflow-hidden bg-white dark:bg-neutral-800">
                  <button
                    type="button"
                    disabled={!isSelected || plate.repeatsCount <= 1}
                    onClick={() => onChangeRepeats(plate.plateIndex, Math.max(1, plate.repeatsCount - 1))}
                    className="px-2.5 py-1 text-xs font-mono text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-40"
                  >
                    -
                  </button>
                  <span className="px-3 py-1 text-xs font-mono font-semibold tabular-nums text-neutral-900 dark:text-white min-w-[28px] text-center">
                    {plate.repeatsCount}
                  </span>
                  <button
                    type="button"
                    disabled={!isSelected}
                    onClick={() => onChangeRepeats(plate.plateIndex, plate.repeatsCount + 1)}
                    className="px-2.5 py-1 text-xs font-mono text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
