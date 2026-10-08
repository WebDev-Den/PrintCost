import React, { useRef, useState } from 'react';
import { UploadCloud, Sparkles, CheckCircle, AlertTriangle, Cpu } from 'lucide-react';
import { Button } from '../common/Button.tsx';
import type { ParsedJob } from '../../domain/types.ts';
import { fileAnalysisService } from '../../services/fileAnalysisService.ts';

interface FileDropzoneProps {
  onJobLoaded: (job: ParsedJob) => void;
  isLoading: boolean;
  setIsLoading: (val: boolean) => void;
  currentJob: ParsedJob | null;
}

export const FileDropzone: React.FC<FileDropzoneProps> = ({
  onJobLoaded,
  isLoading,
  setIsLoading,
  currentJob,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSelectDemo = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const demo = await fileAnalysisService.getDemoJob();
      onJobLoaded(demo);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectPreset = async (presetKey: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const preset = await fileAnalysisService.loadPresetJob(presetKey);
      if (preset.errorMessage) {
        setErrorMessage(preset.errorMessage);
      }
      onJobLoaded(preset);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileProcess = async (file: File) => {
    if (isLoading) return;
    setIsLoading(true);
    setErrorMessage(null);
    onJobLoaded({ fileName: file.name, fileSizeBytes: file.size, slicerSource: '', plates: [], totalPredictionSeconds: 0, totalWeightGrams: 0, warnings: [], parseStatus: 'reading' });
    try {
      const parsed = await fileAnalysisService.analyzeUploadedFile(file);
      if (parsed.parseStatus !== 'success' && parsed.errorMessage) {
        setErrorMessage(parsed.errorMessage);
      }
      onJobLoaded(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не вдалося прочитати файл. Спробуйте інший .gcode.3mf або .gcode.';
      setErrorMessage(message);
      onJobLoaded({ fileName: file.name, fileSizeBytes: file.size, slicerSource: 'Невідомо', plates: [], totalPredictionSeconds: 0, totalWeightGrams: 0, warnings: [], parseStatus: 'error', errorMessage: message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileProcess(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="space-y-3">
      {/* Drop Area */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => { if (!isLoading) fileInputRef.current?.click(); }}
        className={`border-2 border-dashed rounded-2xl p-6 sm:p-7 text-center cursor-pointer transition-all ${
          isDragOver
            ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30 shadow-md'
            : currentJob && currentJob.parseStatus === 'success'
            ? 'border-emerald-500/40 dark:border-emerald-700/50 bg-white dark:bg-neutral-900/80 hover:border-emerald-500 shadow-2xs'
            : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:border-neutral-400 dark:hover:border-neutral-600 shadow-2xs'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".3mf,.gcode"
          disabled={isLoading}
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              handleFileProcess(e.target.files[0]);
            }
            e.target.value = '';
          }}
        />

        <div className="flex flex-col items-center justify-center space-y-3">
          <div
            className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${
              currentJob && currentJob.parseStatus === 'success'
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-4 ring-emerald-500/10'
                : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
            }`}
          >
            {isLoading ? (
              <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
            ) : currentJob && currentJob.parseStatus === 'success' ? (
              <CheckCircle className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <UploadCloud className="w-7 h-7" />
            )}
          </div>

          <div>
            <p className="text-base font-bold text-neutral-900 dark:text-neutral-100">
              {currentJob && currentJob.parseStatus === 'success'
                ? `Завантажено: ${currentJob.fileName}`
                : 'Перетягніть .gcode.3mf або виберіть файл нарізки'}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-lg mx-auto leading-relaxed">
              Нарізані <strong className="text-neutral-800 dark:text-neutral-200">.3mf / .gcode.3mf</strong> Bambu Studio та OrcaSlicer, текстовий <strong className="text-neutral-800 dark:text-neutral-200">.gcode</strong> PrusaSlicer, OrcaSlicer та Bambu Studio з підтримуваними даними часу друку й витрат кожного філаменту. До 50 MiB. Файл обробляється у браузері. Проєкти без нарізки та binary .bgcode не підтримуються.
            </p>
          </div>

          <div className="flex items-center gap-2.5 pt-1" onClick={(e) => e.stopPropagation()}>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
            >
              Вибрати файл
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<Sparkles className="w-3.5 h-3.5 text-emerald-600" />}
              onClick={handleSelectDemo}
              disabled={isLoading}
            >
              Завантажити демо-приклад
            </Button>
          </div>
        </div>
      </div>

      {/* Error / Warning Alert Banner */}
      {errorMessage && (
        <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-xl text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">Повідомлення парсера файлів:</p>
            <p className="text-amber-800 dark:text-amber-300 leading-relaxed">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Preset switcher for testing */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-neutral-500 dark:text-neutral-400 px-1 gap-2">
        <span className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-neutral-400" />
          <span>Демонстраційні сценарії:</span>
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => handleSelectPreset('multi_plate')}
            disabled={isLoading}
            className="hover:text-emerald-600 dark:hover:text-emerald-400 underline cursor-pointer text-xs"
          >
            2 пластини
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => handleSelectPreset('unknown_material')}
            disabled={isLoading}
            className="hover:text-emerald-600 dark:hover:text-emerald-400 underline cursor-pointer text-xs"
          >
            Невідомий філамент
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => handleSelectPreset('no_slicing')}
            disabled={isLoading}
            className="hover:text-emerald-600 dark:hover:text-emerald-400 underline cursor-pointer text-xs"
          >
            Без нарізки
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => handleSelectPreset('corrupted')}
            disabled={isLoading}
            className="hover:text-emerald-600 dark:hover:text-emerald-400 underline cursor-pointer text-xs"
          >
            Пошкоджений
          </button>
        </div>
      </div>
    </div>
  );
};
