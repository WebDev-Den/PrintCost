import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ParsedJob,
  FilamentUsage,
  CalculationInput,
  CalculationResult,
  PricingMode,
  RoundingMode,
  CalculationTemplate,
  FilamentMatchMethod,
} from '../../domain/types.ts';
import { DEMO_JOB_SECTION_9 } from '../../domain/defaultData.ts';
import { calculatePrintCost, CALCULATION_ALGORITHM_VERSION } from '../../domain/calculator.ts';
import { clearMaterialMapping, findMaterialMatch, getEffectiveMaterialType, isCompatibleMaterial, isKnownMaterialType, normalizeMaterialType } from '../../domain/materialMatching.ts';
import { applyCalculationTemplate, extractTemplateParameters } from '../../domain/calculationTemplates.ts';
import { useAppData } from '../../context/AppDataContext.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { Decimal } from 'decimal.js';
import { isValidDecimalString, normalizeDecimalInput } from '../../domain/formatters.ts';
import { FileDropzone } from '../../components/calculator/FileDropzone.tsx';
import { JobOverviewCard } from '../../components/calculator/JobOverviewCard.tsx';
import { PlatesSelector } from '../../components/calculator/PlatesSelector.tsx';
import { FilamentMappingTable } from '../../components/calculator/FilamentMappingTable.tsx';
import { QuickOverridesPanel, QuickOverrideKey } from '../../components/calculator/QuickOverridesPanel.tsx';
import { PricingSummaryCard } from '../../components/calculator/PricingSummaryCard.tsx';
import { ClientQuoteModal } from '../../components/calculator/ClientQuoteModal.tsx';
import { MaterialModal } from '../../components/materials/MaterialModal.tsx';
import { CostBreakdownChart } from '../../components/calculator/CostBreakdownChart.tsx';
import { TaxSettingsPanel } from '../../components/calculator/TaxSettingsPanel.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';
import { DEFAULT_TAX_SETTINGS, materialPriceForCost, normalizeTaxSettings, type MaterialVatMetadata, type TaxSettings } from '../../domain/taxes.ts';
import {
  Calculator as CalcIcon,
  PieChart as ChartIcon,
  Layers,
  Sparkles,
  BookOpen,
  ArrowRight,
  CheckCircle,
} from 'lucide-react';

const EMPTY_JOB: ParsedJob = { fileName: '', fileSizeBytes: 0, slicerSource: '', plates: [], totalPredictionSeconds: 0, totalWeightGrams: 0, warnings: [], parseStatus: 'empty' };
const filamentCost = (weight: string | number, price: string | null, vat: MaterialVatMetadata = {}, tax?: TaxSettings) => {
  if (!price || !isValidDecimalString(price) || !isValidDecimalString(String(weight))) return null;
  const reasons: string[] = [];
  const effectivePrice = materialPriceForCost(new Decimal(normalizeDecimalInput(price)), vat, tax, reasons);
  return reasons.length ? null : new Decimal(normalizeDecimalInput(String(weight))).div(1000).mul(effectivePrice).toFixed(2);
};

export const CalculatorPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDemoSession } = useAuth();
  const {
    materials,
    printers,
    settings,
    saveCalculation,
    updateSettings,
    saveFilamentMapping,
    addMaterial,
    templates,
    createTemplate,
    updateTemplate,
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
  const [newMaterialRowKey, setNewMaterialRowKey] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateMappings, setTemplateMappings] = useState<Record<string, string> | null>(null);
  const templateMappingsRef = useRef<Record<string, string> | null>(null);
  templateMappingsRef.current = templateMappings;
  const initialTemplateApplied = useRef(false);
  const [templateWarnings, setTemplateWarnings] = useState<string[]>([]);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templatePending, setTemplatePending] = useState(false);
  const templateBusy = useRef(false);

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
    return printers.find((p) => p.id === settings.defaultPrinterId) || printers.find((p) => p.isDefault) || printers[0] || null;
  }, [printers, settings.defaultPrinterId]);
  const [selectedPrinterId, setSelectedPrinterId] = useState<string | null>(() => defaultPrinter?.id || null);

  const [calcParams, setCalcParams] = useState({
    averagePowerWatts: defaultPrinter?.averagePowerWatts ?? '',
    electricityTariffUahPerKwh: settings.electricityTariffUahPerKwh ?? '',
    machineHourlyRateUah: defaultPrinter?.machineHourlyRateUah ?? '',
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
  const [taxSettings, setTaxSettings] = useState<TaxSettings>(() => ({ ...DEFAULT_TAX_SETTINGS, ...settings.tax }));
  const validTaxSettings = useMemo(() => {
    if (!taxSettings.enabled) return undefined;
    try { return normalizeTaxSettings(taxSettings); } catch { return undefined; }
  }, [taxSettings]);

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
          const matchResult = findMaterialMatch(layer.type, materials, templateMappingsRef.current ?? settings.filamentMappingPresets);

          let mappedMaterial = matchResult.material;
          let price = mappedMaterial?.pricePerKgUah || null;
          let mappedName = mappedMaterial ? mappedMaterial.name : undefined;
          let colorHex = layer.colorHex;
          let matchMethod: FilamentMatchMethod = matchResult.method;
          let priceVatMode = mappedMaterial?.priceVatMode || 'not_applicable';
          let vatRatePercent = mappedMaterial?.vatRatePercent || '20';
          let vatRecoverable = mappedMaterial?.vatRecoverable === true;

          if (preselectedInfo && isKnownMaterialType(layer.type) && normalizeMaterialType(layer.type) === normalizeMaterialType(preselectedInfo.type)
              && typeof preselectedInfo.pricePerKgUah === 'string' && isValidDecimalString(preselectedInfo.pricePerKgUah)) {
            mappedMaterial = null;
            price = preselectedInfo.pricePerKgUah;
            mappedName = preselectedInfo.name;
            if (preselectedInfo.colorHex) colorHex = preselectedInfo.colorHex;
            matchMethod = 'manual';
            priceVatMode = 'not_applicable'; vatRatePercent = '20'; vatRecoverable = false;
          }

          const cost = filamentCost(layer.weightGrams, price);

          rows.push({
            key,
            plateIndex: plate.plateIndex,
            plateName: plate.plateName,
            trayId: layer.trayId,
            colorHex,
            typeFromFile: layer.type,
            weightGrams: new Decimal(layer.weightGrams).toDecimalPlaces(6).toFixed(),
            lengthMeters: layer.lengthMeters ? new Decimal(layer.lengthMeters).toDecimalPlaces(6).toFixed() : null,
            mappedMaterialId: mappedMaterial ? mappedMaterial.id : null,
            mappedMaterialName: mappedName,
            pricePerKgUah: price,
            costUah: cost,
            matchMethod,
            priceVatMode, vatRatePercent, vatRecoverable,
          });
        });
      });

      setFilamentsUsage(rows);
    },
    [materials, settings.filamentMappingPresets]
  );

  useEffect(() => {
    if (isDemoSession) handleJobLoaded(structuredClone(DEMO_JOB_SECTION_9));
  }, [isDemoSession]);

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
        if (!isCompatibleMaterial(selectedMat, getEffectiveMaterialType(f))) return clearMaterialMapping(f);
        const price = selectedMat?.pricePerKgUah || null;
        const cost = filamentCost(f.weightGrams, price);
        return {
          ...f,
          mappedMaterialId: selectedMat ? selectedMat.id : null,
          mappedMaterialName: selectedMat?.name,
          pricePerKgUah: price,
          costUah: cost,
          matchMethod: selectedMat ? 'manual' : 'unmatched',
          priceVatMode: selectedMat?.priceVatMode || 'not_applicable',
          vatRatePercent: selectedMat?.vatRatePercent || '20',
          vatRecoverable: selectedMat?.vatRecoverable === true,
        };
      })
    );
  };

  const handleClarifyType = (filamentKey: string, type: string) => {
    setFilamentsUsage(previous => previous.map(filament => filament.key === filamentKey && !isKnownMaterialType(filament.typeFromFile)
      ? { ...clearMaterialMapping(filament), effectiveMaterialType: type } : filament));
  };

  useEffect(() => {
    setFilamentsUsage(previous => {
      let changed = false;
      const next = previous.map(filament => {
        if (!filament.mappedMaterialId || isCompatibleMaterial(materials.find(material => material.id === filament.mappedMaterialId), getEffectiveMaterialType(filament))) return filament;
        changed = true;
        return clearMaterialMapping(filament);
      });
      return changed ? next : previous;
    });
  }, [materials]);

  useEffect(() => {
    if (selectedPrinterId && !printers.some(printer => printer.id === selectedPrinterId)) {
      setSelectedPrinterId(null);
      setCalcParams(previous => ({ ...previous, averagePowerWatts: '', machineHourlyRateUah: '' }));
      setTemplateWarnings(previous => [...previous, 'Вибраний принтер видалено. Оберіть принтер або введіть його параметри вручну.']);
    }
  }, [printers, selectedPrinterId]);

  // Override price per kg manually
  const handlePriceOverride = (filamentKey: string, newPrice: string) => {
    newPrice = normalizeDecimalInput(newPrice);
    setFilamentsUsage((prev) =>
      prev.map((f) => {
        if (f.key !== filamentKey) return f;
        const cost = filamentCost(f.weightGrams, newPrice);
        return {
          ...f,
          pricePerKgUah: newPrice.trim() || null,
          costUah: cost,
        };
      })
    );
  };

  // Save filament preference
  const handleSavePreference = async (typeFromFile: string, materialId: string) => {
    try {
    if (!isKnownMaterialType(typeFromFile) || !isCompatibleMaterial(materials.find(material => material.id === materialId), typeFromFile)) throw new Error('Можна запам’ятати лише сумісний активний матеріал для відомого типу з файлу.');
    await saveFilamentMapping(typeFromFile, materialId);
    setSaveSuccessMsg(`Запам’ятовано: тип "${typeFromFile}" буде за замовчуванням зіставлятися з вибраним матеріалом.`);
    setTimeout(() => setSaveSuccessMsg(null), 3000);
    } catch (error) { setTemplateError(error instanceof Error ? error.message : 'Не вдалося запам’ятати матеріал.'); }
  };

  // Update quick inputs
  const handleChangeInput = (key: QuickOverrideKey, value: any) => {
    setCalcParams((prev) => ({ ...prev, [key]: value }));
  };

  // Save quick inputs as global defaults
  const handleSaveAsDefault = async () => {
    try {
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
      tax: taxSettings,
    });
    setSaveSuccessMsg('Поточні параметри збережено як типові налаштування кабінету.');
    setTimeout(() => setSaveSuccessMsg(null), 3000);
    } catch { /* AppDataContext displays the error. */ }
  };

  // Calculate live domain result via pure domain function
  const calculationInput: CalculationInput = useMemo(() => {
    return {
      job: currentJob || EMPTY_JOB,
      filaments: filamentsUsage.map(filament => {
        const safe = filament.mappedMaterialId && !isCompatibleMaterial(materials.find(material => material.id === filament.mappedMaterialId), getEffectiveMaterialType(filament)) ? clearMaterialMapping(filament) : filament;
        return { ...safe, costUah: filamentCost(safe.weightGrams, safe.pricePerKgUah, safe, validTaxSettings) };
      }),
      selectedPrinterId,
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
      tax: taxSettings.enabled ? taxSettings : undefined,
    };
  }, [currentJob, filamentsUsage, materials, selectedPrinterId, calcParams, taxSettings, validTaxSettings]);

  const applyTemplate = (template: CalculationTemplate) => {
    setTemplateError(null);
    try {
      const applied = applyCalculationTemplate(template, calculationInput, materials, printers);
      const { job: _job, filaments: _filaments, tax, selectedPrinterId: printerId, ...parameters } = applied.input;
      setCalcParams({ ...parameters, electricityTariffUahPerKwh: parameters.electricityTariffUahPerKwh ?? '' });
      setSelectedPrinterId(printerId);
      setTaxSettings({ ...DEFAULT_TAX_SETTINGS, ...tax });
      const mappings = { ...template.materialMappings };
      templateMappingsRef.current = mappings;
      setTemplateMappings(mappings);
      setFilamentsUsage(previous => applyCalculationTemplate(template, { ...calculationInput, filaments: previous }, materials, printers).input.filaments);
      setSelectedTemplateId(template.id); setTemplateName(template.name); setTemplateWarnings(applied.warnings);
      setSaveSuccessMsg(`Шаблон «${template.name}» застосовано. Файл і вибір пластин збережено.`);
    } catch (error) { setTemplateError(error instanceof Error ? error.message : 'Не вдалося застосувати шаблон.'); }
  };

  useEffect(() => {
    if (initialTemplateApplied.current) return;
    initialTemplateApplied.current = true;
    const requestedId = (location.state as { templateId?: string } | null)?.templateId || settings.defaultTemplateId;
    if (!requestedId) return;
    const requested = templates.find(template => template.id === requestedId);
    if (requested) applyTemplate(requested);
    else setTemplateWarnings(['Типовий або вибраний шаблон більше не існує. Використовуються типові налаштування.']);
  }, [templates, settings.defaultTemplateId, location.state]);

  const captureTemplateMappings = () => {
    const mappings: Record<string, string> = {};
    for (const [type, id] of Object.entries(templateMappings ?? settings.filamentMappingPresets)) {
      if (isKnownMaterialType(type) && isCompatibleMaterial(materials.find(material => material.id === id), type)) mappings[normalizeMaterialType(type)] = id;
    }
    for (const filament of filamentsUsage) {
      if (isKnownMaterialType(filament.typeFromFile) && filament.mappedMaterialId && isCompatibleMaterial(materials.find(material => material.id === filament.mappedMaterialId), filament.typeFromFile)) mappings[normalizeMaterialType(filament.typeFromFile)] = filament.mappedMaterialId;
    }
    return mappings;
  };

  const handleSaveTemplate = async (overwrite: boolean) => {
    if (templateBusy.current) return;
    templateBusy.current = true; setTemplatePending(true); setTemplateError(null);
    try {
      const input = { name: templateName.trim(), parameters: extractTemplateParameters(calculationInput), materialMappings: captureTemplateMappings() };
      const selected = templates.find(template => template.id === selectedTemplateId);
      if (overwrite && !selected) throw new Error('Шаблон видалено. Створіть новий.');
      const saved = overwrite && selected ? await updateTemplate(selected.id, selected.version, input) : await createTemplate(input);
      setSelectedTemplateId(saved.id); setTemplateName(saved.name); setSaveSuccessMsg(`Шаблон «${saved.name}» збережено.`);
    } catch (error) { setTemplateError(error instanceof Error ? error.message : 'Не вдалося зберегти шаблон.'); }
    finally { templateBusy.current = false; setTemplatePending(false); }
  };

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

  const activeFilaments = calculationInput.filaments.filter((f) => currentJob?.plates.some((p) => p.selected && p.plateIndex === f.plateIndex));
  const displayedFilaments = activeFilaments.map((f) => {
    const repeats = currentJob?.plates.find((p) => p.plateIndex === f.plateIndex)?.repeatsCount || 1;
    const weightGrams = new Decimal(f.weightGrams).mul(repeats).toFixed(2);
    return { ...f, weightGrams, costUah: filamentCost(weightGrams, f.pricePerKgUah, f, validTaxSettings) };
  });

  // Save calculation snapshot
  const handleSaveCalculation = async () => {
    if (!currentJob || currentJob.parseStatus !== 'success') return;
    setIsSaving(true);
    try {
      await saveCalculation({
        title: currentJob.fileName.replace(/\.gcode\.3mf$/i, '').replace(/\.3mf$/i, ''),
        status: calculationResult.status,
        input: calculationInput,
        result: calculationResult,
        fileName: currentJob.fileName,
        algorithmVersion: CALCULATION_ALGORITHM_VERSION,
      });
      setSaveSuccessMsg('Розрахунок успішно збережено в історію замовлень.');
      setTimeout(() => setSaveSuccessMsg(null), 3000);
    } catch {
      setSaveSuccessMsg(null);
    } finally {
      setIsSaving(false);
    }
  };

  // Export JSON
  const handleExportJson = () => {
    const dataStr = JSON.stringify(
          {
            snapshotDate: new Date().toISOString(),
            job: currentJob,
            input: calculationInput,
            result: calculationResult,
          },
          null,
          2
        );
    const objectUrl = URL.createObjectURL(new Blob([dataStr], { type: 'application/json;charset=utf-8' }));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', objectUrl);
    downloadAnchor.setAttribute('download', `${currentJob?.fileName || 'print'}_calc.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
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
    if (calculationResult.tax) {
      const tax = calculationResult.tax;
      const fixedMonthly = tax.regime === 'fop1' || tax.regime === 'fop2';
      rows.push(['Податковий режим', tax.regime, ''], ['Сценарій податкової оцінки', tax.scenario, ''],
        ['Ціна без ПДВ', tax.netRevenueUah, 'грн'], ['ПДВ продажу (не сплата до бюджету)', tax.vatUah, 'грн'],
        [fixedMonthly ? 'ЄП: частка місячного платежу' : 'ЄП / податок від виручки без ПДВ', tax.unifiedTaxUah, 'грн'],
        [fixedMonthly ? 'Військовий збір: частка місячного платежу' : tax.regime === 'fop3' ? 'Військовий збір від виручки без ПДВ' : 'Військовий збір від заданої бази', tax.militaryTaxUah, 'грн'], ['ПДФО від заданої бази', tax.incomeTaxUah, 'грн'],
        ['У складі ЄП: частка місячного платежу', tax.allocatedUnifiedTaxUah, 'грн'], ['У складі військового збору: частка місячного платежу', tax.allocatedMilitaryTaxUah, 'грн'],
        ['Частка місячного ЄСВ', tax.allocatedEsvUah, 'грн'], ['Частка інших місячних платежів', tax.allocatedOtherUah, 'грн'],
        ['Враховані податки без ПДВ продажу', tax.totalTaxesUah, 'грн'], ['Усі враховані платежі', tax.totalPaymentsUah, 'грн'],
        ['Прибуток до врахованих платежів', tax.profitBeforeTaxUah, 'грн'], ['Прибуток після врахованих платежів', tax.profitAfterTaxUah, 'грн'],
        ['Маржа після платежів', tax.marginAfterTaxPercent, '%'], ['Версія податкового пресета', tax.presetVersion, ''],
        ['Дата дії пресета', tax.presetEffectiveDate, ''], ['Джерела ставок', tax.sourceUrls.join(' '), '']);
      if (tax.netTaxableIncomeUah !== null) rows.push(['Явно задана оподатковувана база', tax.netTaxableIncomeUah, 'грн']);
    }

    const csvContent = [headers.join(','), ...rows.map((e) => e.map((val) => `"${String(val).replace(/^\s*[=+@-]/, "'$&").replace(/"/g, '""')}"`).join(','))].join('\n');
    const csvUrl = URL.createObjectURL(new Blob(['\uFEFF', csvContent], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.setAttribute('href', csvUrl);
    link.setAttribute('download', `${currentJob.fileName}_cost_breakdown.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(csvUrl), 0);
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
            Аналіз підтримуваних файлів нарізки <code className="text-emerald-600 dark:text-emerald-400 font-bold">.gcode.3mf</code> / <code className="text-emerald-600 dark:text-emerald-400 font-bold">.gcode</code> з автоматичним зіставленням матеріалів.
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

      <section className="p-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl space-y-3">
        <div className="flex flex-wrap justify-between gap-2"><h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Шаблон та принтер розрахунку</h2><button type="button" onClick={() => navigate('/app/templates')} className="text-xs text-emerald-600 underline">Керувати шаблонами</button></div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs space-y-1"><span>Шаблон параметрів</span><select aria-label="Шаблон параметрів" value={selectedTemplateId} onChange={event => { setSelectedTemplateId(event.target.value); const selected = templates.find(template => template.id === event.target.value); setTemplateName(selected?.name || ''); }} disabled={templatePending} className="w-full p-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white"><option value="">Без вибраного шаблону</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}{settings.defaultTemplateId === template.id ? ' (типовий)' : ''}</option>)}</select></label>
          <label className="text-xs space-y-1"><span>Принтер цього розрахунку</span><select aria-label="Принтер цього розрахунку" value={selectedPrinterId || ''} onChange={event => { const printer = printers.find(item => item.id === event.target.value); setSelectedPrinterId(printer?.id || null); setCalcParams(previous => ({ ...previous, averagePowerWatts: printer?.averagePowerWatts ?? '', machineHourlyRateUah: printer?.machineHourlyRateUah ?? '' })); }} className="w-full p-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white"><option value="">Без принтера — параметри вручну</option>{printers.map(printer => <option key={printer.id} value={printer.id}>{printer.name}</option>)}</select></label>
        </div>
        <Button size="sm" variant="outline" disabled={templatePending || !templates.some(template => template.id === selectedTemplateId)} onClick={() => { const selected = templates.find(template => template.id === selectedTemplateId); if (selected) applyTemplate(selected); }}>Застосувати вибраний шаблон</Button>
        <Input label="Назва шаблону для збереження" value={templateName} onChange={event => setTemplateName(event.target.value)} maxLength={100} disabled={templatePending} />
        <div className="flex flex-wrap gap-2"><Button size="sm" disabled={templatePending || !templateName.trim()} onClick={() => { void handleSaveTemplate(false); }}>Створити з поточних параметрів</Button><Button size="sm" variant="outline" disabled={templatePending || !templateName.trim() || !templates.some(template => template.id === selectedTemplateId)} onClick={() => { void handleSaveTemplate(true); }}>Оновити вибраний шаблон поточними параметрами</Button></div>
        <p className="text-[11px] text-neutral-500">Застосування змінює тарифи, податки та сумісні правила матеріалів. Файл, пластини й кількість повторів зберігаються. Невідомі типи з файлу не утворюють автоматичних правил.</p>
        {templateError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{templateError}</p>}
        {templateWarnings.length > 0 && <ul className="list-disc pl-4 text-xs text-amber-700 dark:text-amber-400 space-y-1">{templateWarnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>}
      </section>

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
                    filaments={displayedFilaments}
                    availableMaterials={materials}
                    onMapMaterial={handleMapMaterial}
                    onPriceOverride={handlePriceOverride}
                    onSavePreference={handleSavePreference}
                    onClarifyType={handleClarifyType}
                    onAddNewMaterialClick={key => { setNewMaterialRowKey(key || null); setIsNewMaterialModalOpen(true); }}
                  />

                </>
              )}
            </>
          )}
          {activeTab === 'workflow' && <>
            <QuickOverridesPanel input={calculationInput} onChangeInput={handleChangeInput} onSaveAsDefault={handleSaveAsDefault} />
            {activeFilaments.some(filament => filament.priceVatMode && filament.priceVatMode !== 'not_applicable') && <div className="p-3 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-xs text-neutral-600 dark:text-neutral-400 space-y-1">
              <p>Ціна за кг зберігається у режимі ПДВ вибраного матеріалу. Вартість рядка враховує цей режим:</p>
              {activeFilaments.filter(filament => filament.priceVatMode && filament.priceVatMode !== 'not_applicable').map(filament => <p key={filament.key}>{filament.mappedMaterialName || filament.typeFromFile}: {filament.priceVatMode === 'included' ? 'ПДВ включено' : 'ціна без ПДВ'}, {filament.vatRatePercent}%; {validTaxSettings?.vatPayer && filament.vatRecoverable ? 'підтверджений вхідний ПДВ виключено із витрат' : 'вхідний ПДВ залишається у витратах'}.</p>)}
            </div>}
            <TaxSettingsPanel value={taxSettings} onChange={setTaxSettings} />
            {currentJob?.parseStatus === 'success' && <CostBreakdownChart result={calculationResult} />}
          </>}
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
            tax: calculationResult.tax ? { netRevenueUah: calculationResult.tax.netRevenueUah, vatUah: calculationResult.tax.vatUah, grossPriceUah: calculationResult.tax.grossPriceUah, vatPayer: calculationInput.tax?.vatPayer === true } : undefined,
            filaments: activeFilaments,
          }}
        />
      )}

      {/* Quick Add Material Modal */}
      <MaterialModal
        isOpen={isNewMaterialModalOpen}
        onClose={() => { setIsNewMaterialModalOpen(false); setNewMaterialRowKey(null); }}
        seededType={newMaterialRowKey ? getEffectiveMaterialType(filamentsUsage.find(filament => filament.key === newMaterialRowKey) || { typeFromFile: '' }) || undefined : undefined}
        onSave={async (newMat) => {
          const created = await addMaterial(newMat);
          if (newMaterialRowKey) setFilamentsUsage(previous => previous.map(filament => filament.key === newMaterialRowKey && isCompatibleMaterial(created, getEffectiveMaterialType(filament)) ? {
            ...filament, mappedMaterialId: created.id, mappedMaterialName: created.name, pricePerKgUah: created.pricePerKgUah, matchMethod: 'manual',
            priceVatMode: created.priceVatMode || 'not_applicable', vatRatePercent: created.vatRatePercent || '20', vatRecoverable: created.vatRecoverable === true,
            costUah: filamentCost(filament.weightGrams, created.pricePerKgUah, created, validTaxSettings),
          } : filament));
        }}
      />


    </div>
  );
};
