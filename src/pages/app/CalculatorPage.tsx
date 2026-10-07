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

  // Modals
  const [isClientQuoteOpen, setIsClientQuoteOpen] = useState(false);
  const [isNewMaterialModalOpen, setIsNewMaterialModalOpen] = useState(false);

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

      const rows: FilamentUsage[] = [];
      job.plates.forEach((plate) => {
        plate.filaments.forEach((layer) => {
          const key = `p${plate.plateIndex}_t${layer.trayId}_${layer.type}`;
          const matchResult = findBestMaterialMatch(layer.type);

          const mappedMaterial = matchResult.material;
          const price = mappedMaterial?.pricePerKgUah || null;

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
            colorHex: layer.colorHex,
            typeFromFile: layer.type,
            weightGrams: String(layer.weightGrams),
            lengthMeters: layer.lengthMeters ? String(layer.lengthMeters) : null,
            mappedMaterialId: mappedMaterial ? mappedMaterial.id : null,
            mappedMaterialName: mappedMaterial ? mappedMaterial.name : undefined,
            pricePerKgUah: price,
            costUah: cost,
            matchMethod: matchResult.method,
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
      alert('Помилка збереження');
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
      {/* Toast Feedback Banner */}
      {saveSuccessMsg && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-xl text-xs text-emerald-900 dark:text-emerald-200 font-medium">
          {saveSuccessMsg}
        </div>
      )}

      {/* 2-Column Responsive Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: File, Plates, Filaments, Overrides (8 cols on lg) */}
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
