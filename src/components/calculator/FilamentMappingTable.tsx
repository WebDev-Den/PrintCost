import React, { useState } from 'react';
import { Layers, Bookmark, AlertTriangle, CheckCircle, HelpCircle, Disc, Calculator } from 'lucide-react';
import type { FilamentUsage, MaterialProfile } from '../../domain/types.ts';
import { formatUah, formatWeightUk, formatNumberUk } from '../../domain/formatters.ts';
import { Modal } from '../common/Modal.tsx';
import { SpoolCalculatorWidget } from './SpoolCalculatorWidget.tsx';

interface FilamentMappingTableProps {
  filaments: FilamentUsage[];
  availableMaterials: MaterialProfile[];
  onMapMaterial: (key: string, materialId: string) => void;
  onPriceOverride: (key: string, newPricePerKg: string) => void;
  onSavePreference: (typeFromFile: string, materialId: string) => void;
  onAddNewMaterialClick?: () => void;
}

export const FilamentMappingTable: React.FC<FilamentMappingTableProps> = ({
  filaments,
  availableMaterials,
  onMapMaterial,
  onPriceOverride,
  onSavePreference,
  onAddNewMaterialClick,
}) => {
  const [activeSpoolCalcRow, setActiveSpoolCalcRow] = useState<FilamentUsage | null>(null);
  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden shadow-2xs">
      <div className="p-4 sm:p-5 border-b border-neutral-200 dark:border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Матеріали та філаменти замовлення</span>
          </h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            Зіставлення шарів нарізки з вашим каталогом котушок. Тип у файлі не визначає бренд або ціну автоматично.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center flex-wrap">
          <button
            type="button"
            onClick={() => {
              if (filaments.length > 0) setActiveSpoolCalcRow(filaments[0]);
            }}
            className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200 flex items-center gap-1.5 transition-colors"
            title="Розрахувати ціну за кг з маси та ціни котушки"
          >
            <Disc className="w-3.5 h-3.5 text-emerald-600" />
            <span>Розрахунок з котушок за кг</span>
          </button>

          {onAddNewMaterialClick && (
            <button
              type="button"
              onClick={onAddNewMaterialClick}
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
            >
              + Додати новий матеріал
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-neutral-50 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 uppercase tracking-wider font-semibold border-b border-neutral-200 dark:border-neutral-800">
            <tr>
              <th className="py-2.5 px-3">Пластина</th>
              <th className="py-2.5 px-3">Колір / Лот</th>
              <th className="py-2.5 px-3">Тип з 3MF</th>
              <th className="py-2.5 px-3 min-w-[200px]">Матеріал з вашого каталогу</th>
              <th className="py-2.5 px-3 text-right">Витрата</th>
              <th className="py-2.5 px-3 text-right min-w-[130px]">Ціна за кг</th>
              <th className="py-2.5 px-3 text-right">Вартість</th>
              <th className="py-2.5 px-3 text-center">Дія</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800 font-sans">
            {filaments.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-6 text-center text-neutral-500">
                  Немає активних шарів або не вибрано жодної пластини
                </td>
              </tr>
            ) : (
              filaments.map((f) => {
                const hasPrice = f.pricePerKgUah !== null && f.pricePerKgUah !== '';
                const hasCost = f.costUah !== null && f.costUah !== '';

                return (
                  <tr
                    key={f.key}
                    className="hover:bg-neutral-50/70 dark:hover:bg-neutral-800/40 transition-colors"
                  >
                    {/* Plate */}
                    <td className="py-3 px-3 text-neutral-700 dark:text-neutral-300 font-medium whitespace-nowrap">
                      {f.plateName}
                    </td>

                    {/* Color & Tray */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-neutral-300 dark:border-neutral-700 shrink-0 shadow-xs"
                          style={{ backgroundColor: f.colorHex || '#94a3b8' }}
                          title={`Колірний код: ${f.colorHex}`}
                        />
                        <span className="text-neutral-500 dark:text-neutral-400 font-mono">
                          #{f.trayId}
                        </span>
                      </div>
                    </td>

                    {/* Type from 3MF */}
                    <td className="py-3 px-3">
                      <span className="font-mono font-medium text-neutral-900 dark:text-neutral-100 px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800">
                        {f.typeFromFile}
                      </span>
                    </td>

                    {/* Mapped Catalog Material */}
                    <td className="py-3 px-3">
                      <select
                        value={f.mappedMaterialId || ''}
                        onChange={(e) => onMapMaterial(f.key, e.target.value)}
                        className={`w-full py-1.5 px-2.5 rounded-md border text-xs bg-white dark:bg-neutral-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 ${
                          !f.mappedMaterialId
                            ? 'border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200 bg-amber-50/40'
                            : 'border-neutral-300 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100'
                        }`}
                      >
                        <option value="">— Оберіть матеріал з каталогу —</option>
                        {availableMaterials
                          .filter((m) => !m.isArchived)
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({m.type}) — {m.pricePerKgUah ? `${m.pricePerKgUah} грн/кг` : 'Ціна не задана'}
                            </option>
                          ))}
                      </select>

                      {/* Matching hint */}
                      <div className="flex items-center gap-1.5 mt-1 text-[11px]">
                        {f.matchMethod === 'exact_preset' && (
                          <span className="text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Запам'ятоване правило
                          </span>
                        )}
                        {f.matchMethod === 'type_match' && (
                          <span className="text-blue-700 dark:text-blue-400 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Збіг за типом
                          </span>
                        )}
                        {f.matchMethod === 'unmatched' && (
                          <span className="text-amber-700 dark:text-amber-400 flex items-center gap-1 font-medium">
                            <AlertTriangle className="w-3 h-3" /> Не зіставлено
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Usage Weight / Length */}
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      <div className="font-semibold text-neutral-900 dark:text-neutral-100">
                        {formatWeightUk(f.weightGrams)}
                      </div>
                      <div className="text-[10px] text-neutral-400">
                        ~{(parseFloat(f.weightGrams) / 1000).toFixed(2)} котушки
                      </div>
                      {f.lengthMeters && (
                        <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                          {formatNumberUk(f.lengthMeters, 1)} м
                        </div>
                      )}
                    </td>

                    {/* Price per Kg (Editable quick override + Spool Calc Button) */}
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setActiveSpoolCalcRow(f)}
                          className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 hover:text-emerald-600 dark:hover:text-emerald-400 cursor-pointer"
                          title="Розрахувати ціну за кг з маси та вартості котушки"
                        >
                          <Disc className="w-3.5 h-3.5" />
                        </button>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={f.pricePerKgUah ?? ''}
                          placeholder="—"
                          onChange={(e) => onPriceOverride(f.key, e.target.value)}
                          className={`w-20 py-1 px-2 text-right text-xs font-mono tabular-nums rounded border bg-white dark:bg-neutral-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 ${
                            !hasPrice
                              ? 'border-red-400 dark:border-red-600 bg-red-50/30 text-red-700'
                              : 'border-neutral-300 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100'
                          }`}
                        />
                        <span className="text-[10px] text-neutral-500 shrink-0">грн/кг</span>
                      </div>
                    </td>

                    {/* Line Cost */}
                    <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {hasCost ? (
                        <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                          {formatUah(f.costUah)}
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 text-[11px] font-medium">
                          Неповний розрахунок
                        </span>
                      )}
                    </td>

                    {/* Action: Remember mapping */}
                    <td className="py-3 px-3 text-center">
                      {f.mappedMaterialId && (
                        <button
                          type="button"
                          onClick={() => onSavePreference(f.typeFromFile, f.mappedMaterialId!)}
                          title={`Запам'ятати: завжди зіставляти "${f.typeFromFile}" з вибраним матеріалом`}
                          className="p-1 text-neutral-400 hover:text-emerald-600 dark:hover:text-emerald-400 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                        >
                          <Bookmark className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Spool Calculator Modal for Active Filament Row */}
      {activeSpoolCalcRow && (
        <Modal
          isOpen={Boolean(activeSpoolCalcRow)}
          onClose={() => setActiveSpoolCalcRow(null)}
          title={`Розрахунок з котушки: ${activeSpoolCalcRow.typeFromFile}`}
          description="Введіть вагу котушки та ціну в магазині — миттєво підставимо ціну за 1 кг у розрахунок."
          maxWidth="2xl"
        >
          <SpoolCalculatorWidget
            initialType={activeSpoolCalcRow.typeFromFile}
            initialPriceUah={activeSpoolCalcRow.pricePerKgUah ? parseFloat(activeSpoolCalcRow.pricePerKgUah) : 650}
            targetPrintWeightGrams={parseFloat(activeSpoolCalcRow.weightGrams) || 0}
            onApplyToRate={(rate) => {
              onPriceOverride(activeSpoolCalcRow.key, rate.toFixed(2));
              setActiveSpoolCalcRow(null);
            }}
            onClose={() => setActiveSpoolCalcRow(null)}
          />
        </Modal>
      )}
    </div>
  );
};
