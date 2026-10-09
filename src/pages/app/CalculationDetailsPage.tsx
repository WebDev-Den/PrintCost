import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  RotateCcw,
  Copy,
  FileText,
  Share2,
  Calendar,
  Layers,
  Printer,
  Zap,
} from 'lucide-react';
import { useAppData } from '../../context/AppDataContext.tsx';
import { calculationRepository } from '../../services/calculationRepository.ts';
import { Decimal } from 'decimal.js';
import type { CalculationSnapshot } from '../../domain/types.ts';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';
import { Modal } from '../../components/common/Modal.tsx';
import { StatusBadge } from '../../components/common/StatusBadge.tsx';
import { ClientQuoteModal } from '../../components/calculator/ClientQuoteModal.tsx';
import { CostBreakdownChart } from '../../components/calculator/CostBreakdownChart.tsx';
import { TaxBreakdown } from '../../components/calculator/TaxBreakdown.tsx';
import { DEFAULT_TAX_SETTINGS, materialPriceForCost, normalizeTaxSettings, type TaxSettings } from '../../domain/taxes.ts';
import { formatUah, formatDurationUk, formatWeightUk, formatNumberUk } from '../../domain/formatters.ts';
import { clearMaterialMapping, getEffectiveMaterialType, isCompatibleMaterial } from '../../domain/materialMatching.ts';
import { CALCULATION_ALGORITHM_VERSION } from '../../domain/calculator.ts';
import { getRecalculationTitle } from '../../domain/calculationPersistence.ts';

export const CalculationDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { calculations, settings, printers, materials, saveCalculation, updateCalculationMetadata } = useAppData();

  const [snapshot, setSnapshot] = useState<CalculationSnapshot | null>(null);
  const [isClientQuoteOpen, setIsClientQuoteOpen] = useState(false);
  const [copiedPrice, setCopiedPrice] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMetadataOpen, setIsMetadataOpen] = useState(false);
  const [metadata, setMetadata] = useState({ title: '', clientName: '', notes: '' });
  const [metadataPending, setMetadataPending] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSnapshot(null); setError(null); setIsLoading(true);
    const found = calculations.find((c) => c.id === id);
    if (found) { setSnapshot(found); setIsLoading(false); }
    else if (id) {
      calculationRepository.getById(id).then((value) => { if (!cancelled) setSnapshot(value); })
        .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Не вдалося завантажити розрахунок.'); })
        .finally(() => { if (!cancelled) setIsLoading(false); });
    } else setIsLoading(false);
    return () => { cancelled = true; };
  }, [id, calculations]);

  if (!snapshot || snapshot.id !== id) {
    return (
      <div className="p-8 text-center space-y-3">
        <p role={error ? 'alert' : 'status'} className="text-sm text-neutral-500">{error || (isLoading ? 'Завантаження розрахунку…' : 'Розрахунок не знайдено або він був видалений.')}</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/app/calculations')}>
          Повернутися до історії
        </Button>
      </div>
    );
  }

  const { input, result } = snapshot;
  const storedTax = (() => {
    if (!input.tax?.enabled) return undefined;
    try { return normalizeTaxSettings(input.tax); } catch { return undefined; }
  })();

  /**
   * Section 11 requirement:
   * «Дія "Перерахувати за поточними тарифами" створює нову версію, а не непомітно змінює стару.»
   */
  const handleRecalculateWithCurrentTariffs = async () => {
    setIsRecalculating(true);
    try {
      const activePrinter = printers.find((p) => p.id === settings.defaultPrinterId) || printers.find(printer => printer.isDefault);
      const currentTax = { ...DEFAULT_TAX_SETTINGS, ...settings.tax };
      let validTax: TaxSettings | undefined;
      try { if (currentTax.enabled) validTax = normalizeTaxSettings(currentTax); } catch { /* The calculator reports invalid tax parameters. */ }

      // Update filament prices from current master catalog
      const updatedFilaments = input.filaments.map((f) => {
        const catalogMat = materials.find((m) => m.id === f.mappedMaterialId);
        if (!getEffectiveMaterialType(f) || (f.mappedMaterialId && !isCompatibleMaterial(catalogMat, getEffectiveMaterialType(f)))) return clearMaterialMapping(f);
        const currentPrice = f.mappedMaterialId ? catalogMat!.pricePerKgUah : f.pricePerKgUah;
        let updatedCost = null;
        if (currentPrice && parseFloat(f.weightGrams) > 0) {
          updatedCost = new Decimal(f.weightGrams).div(1000).mul(materialPriceForCost(new Decimal(currentPrice), catalogMat || f, validTax, [])).toFixed(2);
        }
        return {
          ...f,
          pricePerKgUah: currentPrice,
          costUah: updatedCost,
          priceVatMode: catalogMat?.priceVatMode || (f.mappedMaterialId ? 'not_applicable' : f.priceVatMode || 'not_applicable'),
          vatRatePercent: catalogMat?.vatRatePercent || (f.mappedMaterialId ? '20' : f.vatRatePercent || '20'),
          vatRecoverable: catalogMat ? catalogMat.vatRecoverable === true : !f.mappedMaterialId && f.vatRecoverable === true,
        };
      });

      const updatedInput = {
        ...input,
        filaments: updatedFilaments,
        selectedPrinterId: activePrinter?.id || null,
        averagePowerWatts: activePrinter?.averagePowerWatts ?? '',
        electricityTariffUahPerKwh: settings.electricityTariffUahPerKwh,
        machineHourlyRateUah: activePrinter?.machineHourlyRateUah ?? '',
        operatorFeeUah: settings.defaultOperatorFeeUah || input.operatorFeeUah,
        packagingFeeUah: settings.defaultPackagingFeeUah || input.packagingFeeUah,
        postProcessingFeeUah: settings.defaultPostProcessingFeeUah,
        otherFeeUah: settings.defaultOtherFeeUah,
        scrapReservePercent: settings.scrapReservePercent || input.scrapReservePercent,
        pricingMode: settings.pricingMode || input.pricingMode,
        markupPercent: settings.defaultMarkupPercent || input.markupPercent,
        marginPercent: settings.defaultMarginPercent || input.marginPercent,
        minOrderPriceUah: settings.minOrderPriceUah || input.minOrderPriceUah,
        roundingMode: settings.roundingMode || input.roundingMode,
        tax: currentTax,
      };

      // Import calculator dynamically or call calculation engine
      const { calculatePrintCost } = await import('../../domain/calculator.ts');
      const newResult = calculatePrintCost(updatedInput);

      // Save as a NEW separate version
      const newSnapshot = await saveCalculation({
        title: getRecalculationTitle(snapshot.title),
        status: newResult.status,
        input: updatedInput,
        result: newResult,
        fileName: snapshot.fileName,
        clientName: snapshot.clientName,
        notes: `Створено як нову версію на основі розрахунку #${snapshot.id}`,
        algorithmVersion: CALCULATION_ALGORITHM_VERSION,
        sourceCalculationId: snapshot.id,
      });

      navigate(`/app/calculations/${newSnapshot.id}`);
    } catch { /* AppDataContext displays the error. */ }
    finally {
      setIsRecalculating(false);
    }
  };

  const handleCopyPrice = () => {
    navigator.clipboard.writeText(result.sellingPriceUah);
    setCopiedPrice(true);
    setTimeout(() => setCopiedPrice(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-200 dark:border-neutral-800 pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/app/calculations')}
            className="p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-white rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Назад до списку"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-neutral-900 dark:text-white">
                {snapshot.title}
              </h2>
              <StatusBadge status={snapshot.status} />
            </div>
            <p className="text-xs text-neutral-500 font-mono mt-0.5">
              Файл: {snapshot.fileName} · Збережено: {new Date(snapshot.createdAt).toLocaleString('uk-UA')}
            </p>
            <p className="mt-1 text-[11px] text-neutral-500">Алгоритм: {snapshot.algorithmVersion || 'Попередня версія'}{snapshot.sourceCalculationId && <> · На основі <button type="button" onClick={() => navigate(`/app/calculations/${snapshot.sourceCalculationId}`)} className="underline text-emerald-600">попереднього розрахунку</button></>}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={metadataPending || isRecalculating} onClick={() => { setMetadata({ title: snapshot.title, clientName: snapshot.clientName || '', notes: snapshot.notes || '' }); setMetadataError(null); setIsMetadataOpen(true); }}>Редагувати опис</Button>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={handleRecalculateWithCurrentTariffs}
            isLoading={isRecalculating}
            disabled={metadataPending}
            title="Створює окремий новий розрахунок із поточними тарифами з налаштувань"
          >
            Перерахувати за поточними тарифами
          </Button>

          <Button
            variant="primary"
            size="sm"
            leftIcon={<Share2 className="w-3.5 h-3.5" />}
            onClick={() => setIsClientQuoteOpen(true)}
            disabled={result.status !== 'complete'}
          >
            Пропозиція для клієнта
          </Button>
        </div>
      </div>

      {(snapshot.clientName || snapshot.notes) && <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 text-sm text-neutral-600 dark:text-neutral-400 space-y-1">{snapshot.clientName && <p>Клієнт: {snapshot.clientName}</p>}{snapshot.notes && <p className="whitespace-pre-wrap">{snapshot.notes}</p>}</div>}

      {/* Grid: Tariffs Locked at Calculation Time vs Results */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Sliced Filaments & Locked Tariffs */}
        <div className="lg:col-span-2 space-y-6">
          {/* Visual Cost Distribution Chart using Recharts */}
          <CostBreakdownChart result={result} />

          {/* Filaments snapshot table */}
          <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-2xs">
            <div className="p-4 border-b border-neutral-200 dark:border-neutral-800">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-600" />
                <span>Матеріали та вартість у цьому розрахунку</span>
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-50 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 font-semibold border-b border-neutral-200 dark:border-neutral-800">
                  <tr>
                    <th className="py-2.5 px-3">Пластина</th>
                    <th className="py-2.5 px-3">Філамент</th>
                    <th className="py-2.5 px-3">Матеріал</th>
                    <th className="py-2.5 px-3 text-right">Витрата</th>
                    <th className="py-2.5 px-3 text-right">Ціна за кг</th>
                    <th className="py-2.5 px-3 text-right">Сума</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {input.filaments.filter((f) => input.job.plates.some((p) => p.selected && p.plateIndex === f.plateIndex)).map((f, i) => (
                    <tr key={i} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                      <td className="py-2.5 px-3 font-medium">{f.plateName}</td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono">{f.typeFromFile}</span>
                        {f.effectiveMaterialType && <span className="block text-[11px] text-neutral-500">Уточнено: {getEffectiveMaterialType(f)}</span>}
                      </td>
                      <td className="py-2.5 px-3 text-neutral-600 dark:text-neutral-400">
                        {f.mappedMaterialName || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatWeightUk(new Decimal(f.weightGrams).mul(input.job.plates.find((p) => p.plateIndex === f.plateIndex)?.repeatsCount || 1).toFixed(2))}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatUah(f.pricePerKgUah)}/кг
                        {f.priceVatMode && f.priceVatMode !== 'not_applicable' && <p className="text-[10px] text-neutral-500">{f.priceVatMode === 'included' ? 'З ПДВ' : 'Без ПДВ'} {f.vatRatePercent}%</p>}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                        {formatUah(f.pricePerKgUah === null ? null : new Decimal(f.weightGrams).div(1000).mul(materialPriceForCost(new Decimal(f.pricePerKgUah), f, storedTax, [])).mul(input.job.plates.find((p) => p.plateIndex === f.plateIndex)?.repeatsCount || 1).toFixed(2))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Locked Tariffs Card */}
          <div className="bg-white dark:bg-neutral-900 p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-3 shadow-2xs">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              <span>Зафіксовані тарифи на момент цього розрахунку</span>
            </h3>
            <p className="text-xs text-neutral-500">
              Ці значення збережені у знімку розрахунку і залишаються незмінними навіть після коригування глобальних налаштувань.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs pt-1">
              <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
                <span className="text-neutral-500 block text-[11px]">Тариф електроенергії:</span>
                <span className="font-mono font-semibold text-neutral-900 dark:text-white">
                  {formatUah(input.electricityTariffUahPerKwh)}/кВт·год
                </span>
              </div>

              <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
                <span className="text-neutral-500 block text-[11px]">Машинна ставка принтера:</span>
                <span className="font-mono font-semibold text-neutral-900 dark:text-white">
                  {formatUah(input.machineHourlyRateUah)}/год
                </span>
              </div>

              <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
                <span className="text-neutral-500 block text-[11px]">Потужність принтера:</span>
                <span className="font-mono font-semibold text-neutral-900 dark:text-white">
                  {input.averagePowerWatts} Вт
                </span>
              </div>

              <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
                <span className="text-neutral-500 block text-[11px]">Робота оператора:</span>
                <span className="font-mono font-semibold text-neutral-900 dark:text-white">
                  {formatUah(input.operatorFeeUah)}
                </span>
              </div>

              <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
                <span className="text-neutral-500 block text-[11px]">Резерв браку:</span>
                <span className="font-mono font-semibold text-neutral-900 dark:text-white">
                  {input.scrapReservePercent}%
                </span>
              </div>

              <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
                <span className="text-neutral-500 block text-[11px]">
                  {input.pricingMode === 'markup' ? 'Націнка:' : 'Цільова маржа:'}
                </span>
                <span className="font-mono font-semibold text-neutral-900 dark:text-white">
                  {input.pricingMode === 'markup' ? `${input.markupPercent}%` : `${input.marginPercent}%`}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: Cost Price Breakdown Summary */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-neutral-900 p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-4 shadow-2xs">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
              Структура собівартості
            </h3>

            <div className="space-y-2 text-xs divide-y divide-neutral-100 dark:divide-neutral-800">
              <div className="pt-1.5 flex justify-between">
                <span className="text-neutral-600 dark:text-neutral-400">Матеріали:</span>
                <span className="font-mono tabular-nums font-semibold">
                  {formatUah(result.materialsCostUah)}
                </span>
              </div>

              <div className="pt-1.5 flex justify-between">
                <span className="text-neutral-600 dark:text-neutral-400">
                  Електроенергія ({result.totalEnergyKwh} кВт·год):
                </span>
                <span className="font-mono tabular-nums font-semibold">
                  {formatUah(result.electricityCostUah)}
                </span>
              </div>

              <div className="pt-1.5 flex justify-between">
                <span className="text-neutral-600 dark:text-neutral-400">Машинний час:</span>
                <span className="font-mono tabular-nums font-semibold">
                  {formatUah(result.machineCostUah)}
                </span>
              </div>

              <div className="pt-1.5 flex justify-between">
                <span className="text-neutral-600 dark:text-neutral-400">Оператор:</span>
                <span className="font-mono tabular-nums font-semibold">
                  {formatUah(result.operatorCostUah)}
                </span>
              </div>

              <div className="pt-1.5 flex justify-between">
                <span className="text-neutral-600 dark:text-neutral-400">
                  Резерв браку ({input.scrapReservePercent}%):
                </span>
                <span className="font-mono tabular-nums font-semibold">
                  {formatUah(result.scrapReserveUah)}
                </span>
              </div>

              <div className="pt-2 flex justify-between bg-neutral-50 dark:bg-neutral-800 p-2 rounded font-semibold">
                <span>Собівартість:</span>
                <span className="font-mono text-neutral-900 dark:text-white">
                  {formatUah(result.costPriceUah)}
                </span>
              </div>
            </div>

            {/* Client Final Price Block */}
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-center space-y-2">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-emerald-800 dark:text-emerald-300">
                Зафіксована ціна клієнту
              </span>
              <div className="text-3xl font-extrabold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                {formatUah(result.sellingPriceUah)}
              </div>
              <div className="flex justify-around text-xs font-mono pt-2 border-t border-emerald-500/20">
                <div>
                  <span className="text-neutral-500 text-[10px] block">{result.tax ? 'Прибуток після платежів:' : 'Прибуток без податкової оцінки:'}</span>
                  <span className="font-bold">{formatUah(result.tax?.profitAfterTaxUah || result.profitUah)}</span>
                </div>
                <div>
                  <span className="text-neutral-500 text-[10px] block">{result.tax ? 'Маржа після платежів:' : 'Маржа:'}</span>
                  <span className="font-bold text-emerald-600">{result.tax?.marginAfterTaxPercent || result.marginPercent}%</span>
                </div>
              </div>
            </div>

            {result.tax && <TaxBreakdown tax={result.tax} />}
            {result.status !== 'complete' && <div role="status" className="p-3 text-xs text-amber-700 dark:text-amber-300"><p>Розрахунок неповний:</p><ul className="list-disc list-inside">{result.incompleteReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>}

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              leftIcon={<Copy className="w-3.5 h-3.5" />}
              onClick={handleCopyPrice}
              disabled={result.status !== 'complete'}
            >
              {copiedPrice ? 'Ціну скопійовано' : 'Копіювати ціну'}
            </Button>
          </div>
        </div>
      </div>

      <Modal isOpen={isMetadataOpen} onClose={() => { if (!metadataPending) setIsMetadataOpen(false); }} title="Опис збереженого розрахунку" description="Назва, клієнт і нотатки можуть змінюватись. Параметри та суми цього розрахунку залишаються зафіксованими." footer={<><Button size="sm" variant="outline" disabled={metadataPending} onClick={() => setIsMetadataOpen(false)}>Скасувати</Button><Button size="sm" isLoading={metadataPending} disabled={!metadata.title.trim()} onClick={async () => { if (metadataPending) return; setMetadataPending(true); setMetadataError(null); try { const updated = await updateCalculationMetadata(snapshot.id, { title: metadata.title.trim(), clientName: metadata.clientName, notes: metadata.notes }); setSnapshot(updated); setIsMetadataOpen(false); } catch (error) { setMetadataError(error instanceof Error ? error.message : 'Не вдалося зберегти опис.'); } finally { setMetadataPending(false); } }}>Зберегти опис</Button></>}>
        <div className="space-y-3"><Input label="Назва розрахунку" value={metadata.title} onChange={event => setMetadata({ ...metadata, title: event.target.value })} maxLength={300} disabled={metadataPending} /><Input label="Клієнт" value={metadata.clientName} onChange={event => setMetadata({ ...metadata, clientName: event.target.value })} maxLength={200} disabled={metadataPending} /><label className="block text-xs space-y-1"><span>Нотатки</span><textarea aria-label="Нотатки розрахунку" value={metadata.notes} onChange={event => setMetadata({ ...metadata, notes: event.target.value })} maxLength={10000} rows={4} disabled={metadataPending} className="w-full p-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900" /></label>{metadataError && <p role="alert" className="text-sm text-red-600">{metadataError}</p>}</div>
      </Modal>

      {/* Client Quote Modal */}
      <ClientQuoteModal
        isOpen={isClientQuoteOpen}
        onClose={() => setIsClientQuoteOpen(false)}
        calcSnapshot={{
          fileName: snapshot.fileName,
          sellingPriceUah: result.sellingPriceUah,
          totalWeightGrams: result.totalWeightGrams,
          totalDurationSeconds: result.totalDurationSeconds,
          tax: result.tax ? { netRevenueUah: result.tax.netRevenueUah, vatUah: result.tax.vatUah, grossPriceUah: result.tax.grossPriceUah, vatPayer: input.tax?.vatPayer === true } : undefined,
          filaments: input.filaments.filter((f) => input.job.plates.some((p) => p.selected && p.plateIndex === f.plateIndex)),
        }}
      />
    </div>
  );
};
