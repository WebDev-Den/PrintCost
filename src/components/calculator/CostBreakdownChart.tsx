import React, { useState } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import type { CalculationResult } from '../../domain/types.ts';
import { formatUah, formatNumberUk } from '../../domain/formatters.ts';
import { PieChart as PieIcon, BarChart3, Layers } from 'lucide-react';

interface CostBreakdownChartProps {
  result: CalculationResult;
  className?: string;
}

interface CategorySlice {
  name: string;
  value: number;
  color: string;
  percent: number;
  description: string;
}

export const CostBreakdownChart: React.FC<CostBreakdownChartProps> = ({
  result,
  className = '',
}) => {
  const [viewMode, setViewMode] = useState<'donut' | 'bar'>('donut');

  const materials = parseFloat(result.materialsCostUah || '0');
  const electricity = parseFloat(result.electricityCostUah || '0');
  const machine = parseFloat(result.machineCostUah || '0');
  const operatorAndOther =
    parseFloat(result.operatorCostUah || '0') +
    parseFloat(result.packagingCostUah || '0') +
    parseFloat(result.postProcessingCostUah || '0') +
    parseFloat(result.otherCostUah || '0');
  const scrapReserve = parseFloat(result.scrapReserveUah || '0');

  const totalCost = parseFloat(result.costPriceUah || '0') || 1; // avoid division by zero

  const data: CategorySlice[] = [
    {
      name: 'Матеріали',
      value: materials,
      color: '#10b981', // emerald-500
      percent: (materials / totalCost) * 100,
      description: 'Витрати на філамент за вагою нарізки',
    },
    {
      name: 'Машинний час',
      value: machine,
      color: '#3b82f6', // blue-500
      percent: (machine / totalCost) * 100,
      description: 'Амортизація принтера та знос сопла/механіки',
    },
    {
      name: 'Електроенергія',
      value: electricity,
      color: '#f59e0b', // amber-500
      percent: (electricity / totalCost) * 100,
      description: `${result.totalEnergyKwh} кВт·год за тарифом`,
    },
    {
      name: 'Оператор та супутні',
      value: operatorAndOther,
      color: '#8b5cf6', // purple-500
      percent: (operatorAndOther / totalCost) * 100,
      description: 'Робота майстра, упаковка, обробка',
    },
    {
      name: 'Резерв браку',
      value: scrapReserve,
      color: '#f43f5e', // rose-500
      percent: (scrapReserve / totalCost) * 100,
      description: 'Закладений технічний ризик та відходи',
    },
  ].filter((item) => item.value > 0);

  // Custom Tooltip component for Recharts
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const slice = payload[0].payload as CategorySlice;
      return (
        <div className="bg-neutral-900 text-white dark:bg-neutral-800 p-3 rounded-lg shadow-xl border border-neutral-700 text-xs space-y-1">
          <div className="flex items-center gap-2 font-semibold">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: slice.color }}
            />
            <span>{slice.name}</span>
          </div>
          <div className="font-mono tabular-nums text-emerald-400 font-bold text-sm">
            {formatUah(slice.value)}
          </div>
          <div className="text-[11px] text-neutral-400 font-mono">
            Частка в собівартості: {formatNumberUk(slice.percent, 1)}%
          </div>
          <div className="text-[10px] text-neutral-400 border-t border-neutral-700/60 pt-1 mt-1">
            {slice.description}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div
      className={`bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-5 space-y-4 shadow-2xs ${className}`}
    >
      {/* Header and View Mode toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Розподіл собівартості за категоріями</span>
          </h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            Структура витрат на 1 повний цикл друку виробу
          </p>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-1 p-0.5 bg-neutral-100 dark:bg-neutral-800 rounded-lg self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setViewMode('donut')}
            className={`p-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 ${
              viewMode === 'donut'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-semibold'
                : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
            }`}
            title="Кругова діаграма"
          >
            <PieIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Кругова</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('bar')}
            className={`p-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 ${
              viewMode === 'bar'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-semibold'
                : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
            }`}
            title="Стовпчикова діаграма"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Стовпчики</span>
          </button>
        </div>
      </div>

      {/* Main Chart Area */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
        {/* Visual Chart Canvas (7 cols on md) */}
        <div className="md:col-span-7 h-64 sm:h-72 w-full relative flex items-center justify-center">
          {data.length === 0 ? (
            <div className="text-center text-xs text-neutral-500">
              Немає даних для побудови графіку
            </div>
          ) : viewMode === 'donut' ? (
            <div className="w-full h-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 10 }} />
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={95}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="#ffffff"
                    strokeWidth={2}
                  >
                    {data.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>

              {/* Center Donut Label */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                <span className="text-[10px] uppercase font-semibold text-neutral-400">
                  Собівартість
                </span>
                <span className="text-base sm:text-lg font-bold font-mono tabular-nums text-neutral-900 dark:text-white">
                  {formatUah(result.costPriceUah)}
                </span>
                <span className="text-[10px] text-neutral-500 font-mono">100%</span>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 10, right: 20, left: 20, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.2} />
                <XAxis
                  type="number"
                  tickFormatter={(val) => `${val} грн`}
                  tick={{ fontSize: 10, fill: '#888' }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#888' }}
                  width={90}
                />
                <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 10 }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {data.map((entry, index) => (
                    <Cell key={`bar-cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Detailed Breakdown Legend (5 cols on md) */}
        <div className="md:col-span-5 space-y-2 text-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 pb-1 border-b border-neutral-100 dark:border-neutral-800">
            Частки категорій
          </div>

          <div className="space-y-2 pt-1">
            {data.map((slice, i) => (
              <div
                key={i}
                className="p-2 rounded-lg bg-neutral-50/70 dark:bg-neutral-800/40 border border-neutral-200/50 dark:border-neutral-700/50 flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-3 h-3 rounded-full shrink-0 shadow-2xs"
                    style={{ backgroundColor: slice.color }}
                  />
                  <div className="truncate">
                    <p className="font-semibold text-neutral-900 dark:text-white truncate">
                      {slice.name}
                    </p>
                    <p className="text-[10px] text-neutral-500 truncate">{slice.description}</p>
                  </div>
                </div>

                <div className="text-right shrink-0 font-mono tabular-nums">
                  <span className="font-bold text-neutral-900 dark:text-white block">
                    {formatUah(slice.value)}
                  </span>
                  <span className="text-[10px] text-neutral-500">
                    {formatNumberUk(slice.percent, 1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Quick takeaway summary */}
          <div className="pt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            💡 <strong>Аналітика:</strong> Основну частку витрат ({formatNumberUk(data[0]?.percent || 0, 1)}%) становить категорія{' '}
            <strong className="text-neutral-900 dark:text-white">{data[0]?.name || 'Матеріали'}</strong>.
          </div>
        </div>
      </div>
    </div>
  );
};
