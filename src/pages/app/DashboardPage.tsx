import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Calculator,
  Layers,
  Printer,
  History,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  Clock,
  Sparkles,
} from 'lucide-react';
import { useAppData } from '../../context/AppDataContext.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { Button } from '../../components/common/Button.tsx';
import { StatusBadge } from '../../components/common/StatusBadge.tsx';
import { formatUah, formatDurationUk, formatWeightUk } from '../../domain/formatters.ts';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { materials, printers, settings, calculations } = useAppData();

  // Compute metrics purely from stored calculations (no fabricated revenue graphs)
  const totalCalculationsCount = calculations.length;
  const completeCalculations = calculations.filter((c) => c.status === 'complete');
  const activeMaterialsCount = materials.filter((m) => !m.isArchived).length;
  const printersCount = printers.length;

  const averageSellingPrice =
    completeCalculations.length > 0
      ? (
          completeCalculations.reduce(
            (acc, c) => acc + parseFloat(c.result.sellingPriceUah || '0'),
            0
          ) / completeCalculations.length
        ).toFixed(2)
      : null;

  // Compute warehouse weight and inventory value
  const warehouseTotals = React.useMemo(() => {
    let totalGrams = 0;
    let totalValue = 0;
    materials.forEach((m) => {
      if (m.isArchived) return;
      const count = m.spoolsInStock ?? 1;
      const grams = parseFloat(m.spoolWeightGrams || '1000') || 1000;
      const price = parseFloat(m.spoolPriceUah || m.pricePerKgUah || '0') || 0;
      if (count > 0) {
        totalGrams += count * grams;
        totalValue += count * price;
      }
    });
    return {
      totalKg: (totalGrams / 1000).toFixed(1),
      totalValue,
    };
  }, [materials]);

  // Check incomplete setup items
  const missingElectricity = settings.electricityTariffUahPerKwh === null || settings.electricityTariffUahPerKwh === '';
  const unpricedMaterialsCount = materials.filter((m) => !m.isArchived && (!m.pricePerKgUah || parseFloat(m.pricePerKgUah) <= 0)).length;
  const hasNoPrinters = printers.length === 0;

  const hasSetupIssues = missingElectricity || unpricedMaterialsCount > 0 || hasNoPrinters;

  return (
    <div className="space-y-6">
      {/* Welcome & Primary CTA header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-2xs">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">
            Вітаємо, {user?.fullName || 'Майстерня'}
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            {user?.workshopName || 'Особистий кабінет FDM/FFF розрахунку'} · Готовий до аналізу .gcode.3mf
          </p>
        </div>

        <Button
          variant="primary"
          size="md"
          leftIcon={<Calculator className="w-4 h-4" />}
          onClick={() => navigate('/app/calculator')}
        >
          Новий розрахунок замовлення
        </Button>
      </div>

      {/* Setup Warning Hint Banner (if any parameters are unconfigured) */}
      {hasSetupIssues && (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-xl space-y-2 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Підказка щодо налаштувань майстерні:</span>
          </div>
          <ul className="list-disc list-inside space-y-1 text-amber-800 dark:text-amber-300 pl-1 text-[11px]">
            {missingElectricity && (
              <li>
                Не задано власний тариф електроенергії (грн/кВт·год).{' '}
                <NavLink to="/app/settings" className="underline font-semibold">
                  Вказати в налаштуваннях
                </NavLink>
              </li>
            )}
            {unpricedMaterialsCount > 0 && (
              <li>
                У {unpricedMaterialsCount} матеріалів каталогу не задано закупівельну ціну за кг.{' '}
                <NavLink to="/app/materials" className="underline font-semibold">
                  Переглянути матеріали
                </NavLink>
              </li>
            )}
            {hasNoPrinters && (
              <li>
                Не додано жодного принтера з машинною ставкою.{' '}
                <NavLink to="/app/printers" className="underline font-semibold">
                  Додати принтер
                </NavLink>
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Domain Metrics Grid (Real counts, no hallucinated revenue) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 text-xs">
            <span>Останні 200 розрахунків</span>
            <History className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-neutral-900 dark:text-white mt-2">
            {totalCalculationsCount}
          </p>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            {completeCalculations.length} готових · {totalCalculationsCount - completeCalculations.length} чернеток
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 text-xs">
            <span>Запас філаменту</span>
            <Layers className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-neutral-900 dark:text-white mt-2">
            {warehouseTotals.totalKg} кг
          </p>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            {activeMaterialsCount} позицій · {formatUah(warehouseTotals.totalValue)}
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 text-xs">
            <span>Парк принтерів</span>
            <Printer className="w-4 h-4 text-purple-600" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-neutral-900 dark:text-white mt-2">
            {printersCount}
          </p>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            FDM станків
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 text-xs">
            <span>Сер. чек замовлення</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-neutral-900 dark:text-white mt-2">
            {averageSellingPrice ? formatUah(averageSellingPrice) : '— грн'}
          </p>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            за збереженими записами
          </p>
        </div>
      </div>

      {/* Recent Calculations Table */}
      <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-2xs space-y-0">
        <div className="p-4 sm:p-5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
              Останні розрахунки
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              Історія розрахунків собівартості та зафіксовані ціни клієнтам
            </p>
          </div>
          <NavLink
            to="/app/calculations"
            className="text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 flex items-center gap-1"
          >
            <span>Вся історія</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </NavLink>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 uppercase font-semibold border-b border-neutral-200 dark:border-neutral-800">
              <tr>
                <th className="py-2.5 px-4">Назва / Файл</th>
                <th className="py-2.5 px-4">Дата</th>
                <th className="py-2.5 px-4">Маса / Час</th>
                <th className="py-2.5 px-4 text-right">Собівартість</th>
                <th className="py-2.5 px-4 text-right">Ціна клієнту</th>
                <th className="py-2.5 px-4 text-center">Статус</th>
                <th className="py-2.5 px-4 text-right">Дія</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {calculations.slice(0, 5).map((c) => (
                <tr
                  key={c.id}
                  className="hover:bg-neutral-50/70 dark:hover:bg-neutral-800/40 transition-colors"
                >
                  <td className="py-3 px-4">
                    <p className="font-semibold text-neutral-900 dark:text-white truncate max-w-xs">
                      {c.title}
                    </p>
                    <p className="text-[11px] text-neutral-500 font-mono truncate max-w-xs">
                      {c.fileName}
                    </p>
                  </td>
                  <td className="py-3 px-4 text-neutral-500 whitespace-nowrap">
                    {new Date(c.createdAt).toLocaleDateString('uk-UA', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-neutral-700 dark:text-neutral-300 whitespace-nowrap">
                    <div>{formatWeightUk(c.result.totalWeightGrams)}</div>
                    <div className="text-[11px] text-neutral-500">
                      {formatDurationUk(c.result.totalDurationSeconds)}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-neutral-900 dark:text-white whitespace-nowrap">
                    {formatUah(c.result.costPriceUah)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                    {formatUah(c.result.sellingPriceUah)}
                  </td>
                  <td className="py-3 px-4 text-center whitespace-nowrap">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/app/calculations/${c.id}`)}
                    >
                      Деталі
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
