import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ParsedJob,
  FilamentUsage,
  CalculationInput,
  CalculationResult,
  PricingMode,
  RoundingMode,
} from '../../domain/types.ts';
import { DEMO_JOB_SECTION_9 } from '../../domain/defaultData.ts';
import { calculatePrintCost } from '../../domain/calculator.ts';
import { useAppData } from '../../context/AppDataContext.tsx';
import { FileDropzone } from '../../components/calculator/FileDropzone.tsx';
import { JobOverviewCard } from '../../components/calculator/JobOverviewCard.tsx';
import { PlatesSelector } from '../../components/calculator/PlatesSelector.tsx';
import { FilamentMappingTable } from '../../components/calculator/FilamentMappingTable.tsx';
import { QuickOverridesPanel, QuickOverrideKey } from '../../components/calculator/QuickOverridesPanel.tsx';
import { PricingSummaryCard } from '../../components/calculator/PricingSummaryCard.tsx';
import { ClientQuoteModal } from '../../components/calculator/ClientQuoteModal.tsx';
import { MaterialModal } from '../../components/materials/MaterialModal.tsx';
import { CostBreakdownChart } from '../../components/calculator/CostBreakdownChart.tsx';
import {
  Calculator as CalcIcon,
  PieChart as ChartIcon,
  Layers,
  Sparkles,
  BookOpen,
  ArrowRight,
  CheckCircle,
} from 'lucide-react';

export const CalculatorPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    materials,
    printers,
    settings,
    saveCalculation,
    updateSettings,
    findBestMaterialMatch,
    saveFilamentMapping,
    addMaterial,
  } = useAppData();

  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [currentJob, setCurrentJob] = useState<ParsedJob | null>(null);
  const [filamentsUsage, setFilamentsUsage] = useState<FilamentUsage[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Tab switch for secondary view (table / visual charts)
  const [activeTab, setActiveTab] = useState<'workflow' | 'visual_charts'>('workflow');

  // Modals
  const [isClientQuoteOpen, setIsClientQuoteOpen] = useState(false);
  const [isNewMaterialModalOpen, setIsNewMaterialModalOpen] = useState(false);

  // Preselected filament from catalog
  const [preselectedFilament, setPreselectedFilament] = useState<{
    filamentId?: string;
    name: string;
    type: string;
    brand?: string;
    colorHex?: string;
    colorName?: string;
    pricePerKgUah: string;
    spoolWeightGrams?: string;
    spoolPriceUah?: string;
  } | null>(null);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('kilog_preselect_material');
      if (stored) {
        setPreselectedFilament(JSON.parse(stored));
      }
    } catch (e) {
      console.warn('Failed parsing kilog_preselect_material', e);
    }
  }, []);

  // Calculation parameters (initialized from global settings or active printer)
  const defaultPrinter = useMemo(() => {
    return printers.find((p) => p.isDefault) || printers[0] || null;
  }, [printers]);

  const [calcParams, setCalcParams] = useState({
    averagePowerWatts: defaultPrinter?.averagePowerWatts || '100',
    electricityTariffUahPerKwh: settings.electricityTariffUahPerKwh || '5.00',
    machineHourlyRateUah: defaultPrinter?.machineHourlyRateUah || '10.00',
    operatorFeeUah: settings.defaultOperatorFeeUah || '20',
    packagingFeeUah: settings.defaultPackagingFeeUah || '0',
    postProcessingFeeUah: settings.defaultPostProcessingFeeUah || '0',
    otherFeeUah: settings.defaultOtherFeeUah || '0',
    scrapReservePercent: settings.scrapReservePercent || '10',
    pricingMode: (settings.pricingMode || 'markup') as PricingMode,
    markupPercent: settings.defaultMarkupPercent || '100',
    marginPercent: settings.defaultMarginPercent || '50',
    minOrderPriceUah: settings.minOrderPriceUah || '200',
    roundingMode: (settings.roundingMode || 'up_10') as RoundingMode,
  });

  // Sync default parameters when settings/printers finish loading
  useEffect(() => {
    if (settings.electricityTariffUahPerKwh !== undefined) {
      setCalcParams((prev) => ({
        ...prev,
        electricityTariffUahPerKwh: settings.electricityTariffUahPerKwh || '5.00',
        pricingMode: settings.pricingMode || prev.pricingMode,
        markupPercent: settings.defaultMarkupPercent || prev.markupPercent,
        marginPercent: settings.defaultMarginPercent || prev.marginPercent,
        scrapReservePercent: settings.scrapReservePercent || prev.scrapReservePercent,
        minOrderPriceUah: settings.minOrderPriceUah || prev.minOrderPriceUah,
        roundingMode: settings.roundingMode || prev.roundingMode,
        operatorFeeUah: settings.defaultOperatorFeeUah || prev.operatorFeeUah,
        packagingFeeUah: settings.defaultPackagingFeeUah || prev.packagingFeeUah,
      }));
    }
  }, [settings]);

  // Load agreed demo job by default on first mount
  useEffect(() => {
    if (!currentJob) {
      handleJobLoaded(JSON.parse(JSON.stringify(DEMO_JOB_SECTION_9)));
    }
  }, []);

  // When a job is loaded or changed, construct initial filament usage rows
  const handleJobLoaded = useCallback(
    (job: ParsedJob) => {
      setCurrentJob(job);
      if (job.parseStatus !== 'success' || !job.plates) {
        setFilamentsUsage([]);
        return;
      }

      let preselectedInfo: any = null;
      try {
        const stored = sessionStorage.getItem('kilog_preselect_material');
        if (stored) preselectedInfo = JSON.parse(stored);
      } catch {}

      const rows: FilamentUsage[] = [];
      job.plates.forEach((plate) => {
        plate.filaments.forEach((layer) => {
          const key = `p${plate.plateIndex}_t${layer.trayId}_${layer.type}`;
          const matchResult = findBestMaterialMatch(layer.type);

          let mappedMaterial = matchResult.material;
          let price = mappedMaterial?.pricePerKgUah || null;
          let mappedName = mappedMaterial ? mappedMaterial.name : undefined;
          let colorHex = layer.colorHex;
          let matchMethod = matchResult.method;

          // If preselected filament exists and matches type (or first row)
          if (preselectedInfo && (layer.type.toUpperCase().includes(preselectedInfo.type.toUpperCase()) || rows.length === 0)) {
            price = preselectedInfo.pricePerKgUah;
            mappedName = preselectedInfo.name;
            if (preselectedInfo.colorHex) colorHex = preselectedInfo.colorHex;
            matchMethod = 'exact_preset';
          }

          let cost: string | null = null;
          if (price && layer.weightGrams > 0) {
            const grams = layer.weightGrams;
            cost = ((grams / 1000) * parseFloat(price)).toFixed(2);
          }

          rows.push({
            key,
            plateIndex: plate.plateIndex,
            plateName: plate.plateName,
            trayId: layer.trayId,
            colorHex,
            typeFromFile: layer.type,
            weightGrams: String(layer.weightGrams),
            lengthMeters: layer.lengthMeters ? String(layer.lengthMeters) : null,
            mappedMaterialId: mappedMaterial ? mappedMaterial.id : null,
            mappedMaterialName: mappedName,
            pricePerKgUah: price,
            costUah: cost,
            matchMethod,
          });
        });
      });

      setFilamentsUsage(rows);
    },
    [findBestMaterialMatch]
  );

  // Toggle plate selection
  const handleTogglePlate = (plateIndex: number) => {
    if (!currentJob) return;
    const updatedPlates = currentJob.plates.map((p) =>
      p.plateIndex === plateIndex ? { ...p, selected: !p.selected } : p
    );
    setCurrentJob({ ...currentJob, plates: updatedPlates });
  };

  // Change repeats count for a plate
  const handleChangeRepeats = (plateIndex: number, count: number) => {
    if (!currentJob) return;
    const updatedPlates = currentJob.plates.map((p) =>
      p.plateIndex === plateIndex ? { ...p, repeatsCount: count } : p
    );
    setCurrentJob({ ...currentJob, plates: updatedPlates });
  };

  // Map user catalog material to filament layer
  const handleMapMaterial = (filamentKey: string, materialId: string) => {
    const selectedMat = materials.find((m) => m.id === materialId);
    setFilamentsUsage((prev) =>
      prev.map((f) => {
        if (f.key !== filamentKey) return f;
        const price = selectedMat?.pricePerKgUah || null;
        let cost: string | null = null;
        if (price && parseFloat(f.weightGrams) > 0) {
          cost = ((parseFloat(f.weightGrams) / 1000) * parseFloat(price)).toFixed(2);
        }
        return {
          ...f,
          mappedMaterialId: selectedMat ? selectedMat.id : null,
          mappedMaterialName: selectedMat?.name,
          pricePerKgUah: price,
          costUah: cost,
          matchMethod: selectedMat ? 'manual' : 'unmatched',
        };
      })
    );
  };

  // Override price per kg manually
  const handlePriceOverride = (filamentKey: string, newPrice: string) => {
    setFilamentsUsage((prev) =>
      prev.map((f) => {
        if (f.key !== filamentKey) return f;
        let cost: string | null = null;
        const numPrice = parseFloat(newPrice);
        if (!isNaN(numPrice) && numPrice > 0 && parseFloat(f.weightGrams) > 0) {
          cost = ((parseFloat(f.weightGrams) / 1000) * numPrice).toFixed(2);
        }
        return {
          ...f,
          pricePerKgUah: newPrice,
          costUah: cost,
        };
      })
    );
  };

  // Save filament preference
  const handleSavePreference = async (typeFromFile: string, materialId: string) => {
    await saveFilamentMapping(typeFromFile, materialId);
    setSaveSuccessMsg(`Запам’ятовано: тип "${typeFromFile}" буде за замовчуванням зіставлятися з вибраним матеріалом.`);
    setTimeout(() => setSaveSuccessMsg(null), 3000);
  };

  // Update quick inputs
  const handleChangeInput = (key: QuickOverrideKey, value: any) => {
    setCalcParams((prev) => ({ ...prev, [key]: value }));
  };

  // Save quick inputs as global defaults
  const handleSaveAsDefault = async () => {
    await updateSettings({
      electricityTariffUahPerKwh: calcParams.electricityTariffUahPerKwh,
      pricingMode: calcParams.pricingMode,
      defaultMarkupPercent: calcParams.markupPercent,
      defaultMarginPercent: calcParams.marginPercent,
      scrapReservePercent: calcParams.scrapReservePercent,
      minOrderPriceUah: calcParams.minOrderPriceUah,
      roundingMode: calcParams.roundingMode,
      defaultOperatorFeeUah: calcParams.operatorFeeUah,
      defaultPackagingFeeUah: calcParams.packagingFeeUah,
      defaultPostProcessingFeeUah: calcParams.postProcessingFeeUah,
      defaultOtherFeeUah: calcParams.otherFeeUah,
    });
    setSaveSuccessMsg('Поточні параметри збережено як типові налаштування кабінету.');
    setTimeout(() => setSaveSuccessMsg(null), 3000);
  };

  // Calculate live domain result via pure domain function
  const calculationInput: CalculationInput = useMemo(() => {
    return {
      job: currentJob || DEMO_JOB_SECTION_9,
      filaments: filamentsUsage,
      selectedPrinterId: defaultPrinter?.id || null,
      averagePowerWatts: calcParams.averagePowerWatts,
      electricityTariffUahPerKwh: calcParams.electricityTariffUahPerKwh,
      machineHourlyRateUah: calcParams.machineHourlyRateUah,
      operatorFeeUah: calcParams.operatorFeeUah,
      packagingFeeUah: calcParams.packagingFeeUah,
      postProcessingFeeUah: calcParams.postProcessingFeeUah,
      otherFeeUah: calcParams.otherFeeUah,
      scrapReservePercent: calcParams.scrapReservePercent,
      pricingMode: calcParams.pricingMode,
      markupPercent: calcParams.markupPercent,
      marginPercent: calcParams.marginPercent,
      minOrderPriceUah: calcParams.minOrderPriceUah,
      roundingMode: calcParams.roundingMode,
    };
  }, [currentJob, filamentsUsage, defaultPrinter, calcParams]);

  const calculationResult: CalculationResult = useMemo(() => {
    return calculatePrintCost(calculationInput);
  }, [calculationInput]);

  // Aggregate stats for active plates
  const activePlatesDuration = useMemo(() => {
    if (!currentJob) return 0;
    return currentJob.plates
      .filter((p) => p.selected)
      .reduce((sum, p) => sum + p.predictionSeconds * (p.repeatsCount || 1), 0);
  }, [currentJob]);

  const activePlatesWeight = useMemo(() => {
    if (!currentJob) return 0;
    return currentJob.plates
      .filter((p) => p.selected)
      .reduce((sum, p) => sum + p.totalWeightGrams * (p.repeatsCount || 1), 0);
  }, [currentJob]);

  // Save calculation snapshot
  const handleSaveCalculation = async () => {
    if (!currentJob) return;
    setIsSaving(true);
    try {
      await saveCalculation({
        title: currentJob.fileName.replace(/\.gcode\.3mf$/i, '').replace(/\.3mf$/i, ''),
        status: calculationResult.status,
        input: calculationInput,
        result: calculationResult,
        fileName: currentJob.fileName,
      });
      setSaveSuccessMsg('Розрахунок успішно збережено в історію замовлень.');
      setTimeout(() => setSaveSuccessMsg(null), 3000);
    } catch {
      setSaveSuccessMsg('Помилка при збереженні розрахунку в історію');
      setTimeout(() => setSaveSuccessMsg(null), 4000);
    } finally {
      setIsSaving(false);
    }
  };

  // Export JSON
  const handleExportJson = () => {
    const dataStr =
      'data:text/json;charset=utf-8,' +
      encodeURIComponent(
        JSON.stringify(
          {
            snapshotDate: new Date().toISOString(),
            job: currentJob,
            input: calculationInput,
            result: calculationResult,
          },
          null,
          2
        )
      );
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `${currentJob?.fileName || 'print'}_calc.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Export CSV
  const handleExportCsv = () => {
    if (!currentJob) return;
    const headers = ['Параметр', 'Значення', 'Одиниця'];
    const rows = [
      ['Файл', currentJob.fileName, ''],
      ['Статус розрахунку', calculationResult.status, ''],
      ['Загальна тривалість', calculationResult.totalDurationSeconds, 'сек'],
      ['Загальна маса', calculationResult.totalWeightGrams, 'г'],
      ['Витрата енергії', calculationResult.totalEnergyKwh, 'кВт·год'],
      ['Вартість матеріалів', calculationResult.materialsCostUah, 'грн'],
      ['Вартість електроенергії', calculationResult.electricityCostUah, 'грн'],
      ['Машинний час', calculationResult.machineCostUah, 'грн'],
      ['Оператор', calculationResult.operatorCostUah, 'грн'],
      ['Пакування', calculationResult.packagingCostUah, 'грн'],
      ['Постобробка', calculationResult.postProcessingCostUah, 'грн'],
      ['Резерв браку', calculationResult.scrapReserveUah, 'грн'],
      ['Собівартість (cost price)', calculationResult.costPriceUah, 'грн'],
      ['Кінцева ціна клієнту', calculationResult.sellingPriceUah, 'грн'],
      ['Прибуток', calculationResult.profitUah, 'грн'],
      ['Маржинальність', calculationResult.marginPercent, '%'],
    ];

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.map((val) => `"${val}"`).join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${currentJob.fileName}_cost_breakdown.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="space-y-6">
      {/* Top Header Bar with Context & Quick Links */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-neutral-900 p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-2xs">
        <div>
          <h1 className="text-xl font-black text-neutral-900 dark:text-white flex items-center gap-2">
            <CalcIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <span>Калькулятор собівартості FDM 3D-друку</span>
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            Аналіз будь-яких файлів нарізки <code className="text-emerald-600 dark:text-emerald-400 font-bold">.gcode.3mf</code> / <code className="text-emerald-600 dark:text-emerald-400 font-bold">.gcode</code> з автоматичним зіставленням матеріалів.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* View mode toggle */}
          <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('workflow')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'workflow'
                  ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-bold'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Параметри & Шари</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('visual_charts')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'visual_charts'
                  ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-bold'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
              }`}
            >
              <ChartIcon className="w-3.5 h-3.5 text-emerald-600" />
              <span>Діаграма собівартості</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => navigate('/filaments')}
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-xs font-semibold text-neutral-700 dark:text-neutral-200 transition-colors"
            title="Перейти у відкритий каталог пластиків KILO·G"
          >
            <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
            <span>Каталог пластиків</span>
          </button>
        </div>
      </div>

      {/* Preselected Filament from Catalog Banner */}
      {preselectedFilament && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-xl text-xs flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <span
              className="w-4 h-4 rounded-full border border-neutral-300 dark:border-neutral-600 shrink-0 shadow-2xs"
              style={{ backgroundColor: preselectedFilament.colorHex || '#1e293b' }}
            />
            <div className="text-emerald-950 dark:text-emerald-100 font-medium">
              <span>Вибраний матеріал з каталогу: </span>
              <strong className="font-bold text-emerald-900 dark:text-emerald-200">{preselectedFilament.name}</strong>
              <span className="text-emerald-700 dark:text-emerald-300 ml-1.5 font-semibold">({preselectedFilament.type})</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              sessionStorage.removeItem('kilog_preselect_material');
              setPreselectedFilament(null);
              if (currentJob) handleJobLoaded(currentJob);
            }}
            className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 underline cursor-pointer"
            title="Очистити вибір та повернути стандартний збіг матеріалів"
          >
            Очистити
          </button>
        </div>
      )}

      {/* Toast Feedback Banner */}
      {saveSuccessMsg && (
        <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-xl text-xs text-emerald-900 dark:text-emerald-200 font-semibold flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {/* 2-Column Responsive Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: File, Plates, Filaments, Overrides or Charts (8 cols on lg) */}
        <div className="lg:col-span-8 space-y-6 min-w-0">
          {/* File Picker & Dropzone */}
          <FileDropzone
            onJobLoaded={handleJobLoaded}
            isLoading={isLoadingFile}
            setIsLoading={setIsLoadingFile}
            currentJob={currentJob}
          />

          {/* Sliced Job Overview Card */}
          {currentJob && currentJob.parseStatus === 'success' && (
            <>
              <JobOverviewCard
                job={currentJob}
                activePlatesDurationSeconds={activePlatesDuration}
                activePlatesWeightGrams={activePlatesWeight}
              />

              {/* View Switch: Workflow vs Visual Charts */}
              {activeTab === 'visual_charts' ? (
                <div className="space-y-6">
                  {/* Recharts Cost Breakdown Chart component */}
                  <CostBreakdownChart result={calculationResult} />

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setActiveTab('workflow')}
                      className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                    >
                      <span>Повернутися до редагування параметрів та шарів</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Plates Selector & Repeats */}
                  <PlatesSelector
                    plates={currentJob.plates}
                    onTogglePlate={handleTogglePlate}
                    onChangeRepeats={handleChangeRepeats}
                  />

                  {/* Filament Mapping Table */}
                  <FilamentMappingTable
                    filaments={filamentsUsage}
                    availableMaterials={materials}
                    onMapMaterial={handleMapMaterial}
                    onPriceOverride={handlePriceOverride}
                    onSavePreference={handleSavePreference}
                    onAddNewMaterialClick={() => setIsNewMaterialModalOpen(true)}
                  />

                  {/* Quick Overrides Panel */}
                  <QuickOverridesPanel
                    input={calculationInput}
                    onChangeInput={handleChangeInput}
                    onSaveAsDefault={handleSaveAsDefault}
                  />

                  {/* Embedded Cost Breakdown Chart preview */}
                  <CostBreakdownChart result={calculationResult} />
                </>
              )}
            </>
          )}
        </div>

        {/* Right Column: Sticky Summary & Pricing Breakdown (4 cols on lg) */}
        <div className="lg:col-span-4 min-w-0">
          <PricingSummaryCard
            input={calculationInput}
            result={calculationResult}
            onSave={handleSaveCalculation}
            onOpenClientQuote={() => setIsClientQuoteOpen(true)}
            onExportJson={handleExportJson}
            onExportCsv={handleExportCsv}
            isSaving={isSaving}
          />
        </div>
      </div>

      {/* Client Quote Modal */}
      {currentJob && (
        <ClientQuoteModal
          isOpen={isClientQuoteOpen}
          onClose={() => setIsClientQuoteOpen(false)}
          calcSnapshot={{
            fileName: currentJob.fileName,
            sellingPriceUah: calculationResult.sellingPriceUah,
            totalWeightGrams: calculationResult.totalWeightGrams,
            totalDurationSeconds: calculationResult.totalDurationSeconds,
            filaments: filamentsUsage,
          }}
        />
      )}

      {/* Quick Add Material Modal */}
      <MaterialModal
        isOpen={isNewMaterialModalOpen}
        onClose={() => setIsNewMaterialModalOpen(false)}
        onSave={async (newMat) => {
          await addMaterial(newMat);
        }}
      />


    </div>
  );
};
