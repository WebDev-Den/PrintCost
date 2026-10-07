import React, { useRef, useState } from 'react';
import { UploadCloud, FileText, AlertTriangle, Sparkles, CheckCircle } from 'lucide-react';
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
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const parsed = await fileAnalysisService.analyzeUploadedFile(file);
      if (parsed.parseStatus !== 'success' && parsed.errorMessage) {
        setErrorMessage(parsed.errorMessage);
      }
      onJobLoaded(parsed);
    } catch {
      setErrorMessage('Не вдалося прочитати файл. Спробуйте інший .gcode.3mf.');
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
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-6 sm:p-8 text-center cursor-pointer transition-all ${
          isDragOver
            ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20'
            : currentJob && currentJob.parseStatus === 'success'
            ? 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900/60 hover:border-emerald-500/50'
            : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:border-neutral-400 dark:hover:border-neutral-600'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".3mf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              handleFileProcess(e.target.files[0]);
            }
          }}
        />

        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
            ) : currentJob && currentJob.parseStatus === 'success' ? (
              <CheckCircle className="w-6 h-6 text-emerald-600" />
            ) : (
              <UploadCloud className="w-6 h-6" />
            )}
          </div>

          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {currentJob && currentJob.parseStatus === 'success'
                ? `Завантажено: ${currentJob.fileName}`
                : 'Перетягніть .gcode.3mf або виберіть файл'}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-md mx-auto">
              Файл аналізується у вашому браузері. До акаунта зберігаються параметри та розрахунок, а не сама модель.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
            >
              Вибрати з диска
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              leftIcon={<Sparkles className="w-3.5 h-3.5" />}
              onClick={handleSelectDemo}
              disabled={isLoading}
            >
              Відкрити демонстраційний приклад
            </Button>
          </div>
        </div>
      </div>

      {/* Error / Warning Alert Banner */}
      {errorMessage && (
        <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-lg text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium">Зверніть увагу щодо аналізу файлу:</p>
            <p className="text-amber-800 dark:text-amber-300 leading-relaxed">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Preset switcher for comprehensive testing */}
      <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400 px-1 pt-1">
        <span>Тестові сценарії Bambu Studio:</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleSelectPreset('multi_plate')}
            className="hover:text-emerald-600 dark:hover:text-emerald-400 underline cursor-pointer"
          >
            2 пластини
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => handleSelectPreset('unknown_material')}
            className="hover:text-emerald-600 dark:hover:text-emerald-400 underline cursor-pointer"
          >
            Невідомий філамент
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => handleSelectPreset('no_slicing')}
            className="hover:text-emerald-600 dark:hover:text-emerald-400 underline cursor-pointer"
          >
            Без нарізки
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => handleSelectPreset('corrupted')}
            className="hover:text-emerald-600 dark:hover:text-emerald-400 underline cursor-pointer"
          >
            Пошкоджений
          </button>
        </div>
      </div>
    </div>
  );
};
