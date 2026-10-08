import React from 'react';
import { Clock, Weight, Printer, Layers, AlertCircle, FileText } from 'lucide-react';
import type { ParsedJob } from '../../domain/types.ts';
import { formatDurationUk, formatWeightUk } from '../../domain/formatters.ts';

interface JobOverviewCardProps {
  job: ParsedJob;
  activePlatesDurationSeconds: number;
  activePlatesWeightGrams: number;
}

export const JobOverviewCard: React.FC<JobOverviewCardProps> = ({
  job,
  activePlatesDurationSeconds,
  activePlatesWeightGrams,
}) => {
  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 space-y-4 shadow-2xs">
      {/* File Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 bg-neutral-100 dark:bg-neutral-800 rounded-lg text-neutral-700 dark:text-neutral-300 shrink-0">
            <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="truncate">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
              {job.fileName}
            </h2>
            <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              <span>{job.slicerSource}</span>
              {job.printerModelName && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{job.printerModelName}</span>
                </>
              )}
              {job.nozzleDiameterMm && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Сопло {job.nozzleDiameterMm} мм</span>
                </>
              )}
            </div>
          </div>
        </div>

        {job.isDemoJob && (
          <span className="self-start sm:self-center text-xs text-emerald-800 dark:text-emerald-300 font-medium px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/40 rounded border border-emerald-200 dark:border-emerald-800 shrink-0">
            Демонстраційний приклад
          </span>
        )}
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg border border-neutral-200/60 dark:border-neutral-800">
          <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <Clock className="w-3.5 h-3.5" />
            <span>Час друку</span>
          </div>
          <p className="text-sm font-semibold font-mono tabular-nums text-neutral-900 dark:text-white mt-1">
            {formatDurationUk(activePlatesDurationSeconds)}
          </p>
        </div>

        <div className="p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg border border-neutral-200/60 dark:border-neutral-800">
          <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <Weight className="w-3.5 h-3.5" />
            <span>Загальна маса</span>
          </div>
          <p className="text-sm font-semibold font-mono tabular-nums text-neutral-900 dark:text-white mt-1">
            {formatWeightUk(activePlatesWeightGrams)}
          </p>
        </div>

        <div className="p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg border border-neutral-200/60 dark:border-neutral-800">
          <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <Layers className="w-3.5 h-3.5" />
            <span>Пластини</span>
          </div>
          <p className="text-sm font-semibold font-mono tabular-nums text-neutral-900 dark:text-white mt-1">
            {job.plates.filter((p) => p.selected).length} з {job.plates.length} вибр.
          </p>
        </div>

        <div className="p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg border border-neutral-200/60 dark:border-neutral-800">
          <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <Printer className="w-3.5 h-3.5" />
            <span>Формат</span>
          </div>
          <p className="text-sm font-semibold text-neutral-900 dark:text-white mt-1 truncate">
            {job.fileName.toLowerCase().endsWith('.gcode') ? 'G-code' : '3MF'}
          </p>
        </div>
      </div>

      {/* Warnings from Slicer if any */}
      {job.warnings && job.warnings.length > 0 && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-lg text-xs space-y-1 text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Попередження зі слайсера:</span>
          </div>
          <ul className="list-disc list-inside space-y-0.5 text-amber-800 dark:text-amber-300 pl-1">
            {job.warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
