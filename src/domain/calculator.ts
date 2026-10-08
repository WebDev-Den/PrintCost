import { Decimal } from 'decimal.js';
import type { CalculationInput, CalculationResult, RoundingMode } from './types.ts';
import { isValidDecimalString, normalizeDecimalInput } from './formatters.ts';
import { calculateTaxPrice, materialPriceForCost, normalizeTaxSettings, type TaxResult, type TaxSettings } from './taxes.ts';
import { getEffectiveMaterialType, isKnownMaterialType, normalizeMaterialType } from './materialMatching.ts';
export { CALCULATION_ALGORITHM_VERSION } from './calculationTemplates.ts';

/**
 * Pure domain calculation engine for PrintCost.
 * Implements strict precision calculation via Decimal.js.
 */
export function calculatePrintCost(input: CalculationInput): CalculationResult {
  const incompleteReasons: string[] = [];
  let taxSettings: TaxSettings | undefined;
  if (input.tax && typeof input.tax.enabled !== 'boolean') incompleteReasons.push('Увімкнення податків має бути логічною позначкою.');
  else if (input.tax?.enabled) {
    try { taxSettings = normalizeTaxSettings(input.tax); }
    catch (error) { incompleteReasons.push(error instanceof Error ? error.message : 'Некоректні податкові параметри.'); }
  }
  const readDecimal = (value: string | null | undefined, label: string, optional = false): Decimal => {
    const normalized = normalizeDecimalInput(value || (optional ? '0' : ''));
    if (!isValidDecimalString(normalized)) {
      incompleteReasons.push(`${label}: введіть невід’ємне число`);
      return new Decimal(0);
    }
    return new Decimal(normalized);
  };
  if (input.job.parseStatus !== 'success') incompleteReasons.push('Завантажте файл із даними нарізки');

  // 1. Calculate duration and validate selected plates
  const selectedPlates = input.job.plates.filter((p) => p.selected);
  if (new Set(selectedPlates.map((p) => p.plateIndex)).size !== selectedPlates.length) incompleteReasons.push('Індекси пластин мають бути унікальними');
  if (selectedPlates.length === 0) {
    incompleteReasons.push('Не вибрано жодної пластини для розрахунку');
  }

  let totalDurationSeconds = 0;
  let totalWeightGramsDec = new Decimal(0);

  // Map of plate index to repeat count
  const plateRepeats = new Map<number, number>();
  for (const plate of selectedPlates) {
      const repeats = Number.isSafeInteger(plate.repeatsCount) && plate.repeatsCount > 0 ? plate.repeatsCount : 1;
      if (repeats !== plate.repeatsCount) incompleteReasons.push(`Пластина ${plate.plateName}: кількість повторів має бути цілим числом від 1`);
      plateRepeats.set(plate.plateIndex, repeats);
      if (!Number.isFinite(plate.predictionSeconds) || plate.predictionSeconds <= 0 || !Number.isSafeInteger(Math.ceil(plate.predictionSeconds * repeats))) {
        incompleteReasons.push(`Пластина ${plate.plateName}: немає коректного часу друку`);
      } else totalDurationSeconds += plate.predictionSeconds * repeats;
      const rows = input.filaments.filter((f) => f.plateIndex === plate.plateIndex);
      const weight = rows.reduce((sum, f) => sum + (isValidDecimalString(f.weightGrams) ? Number(normalizeDecimalInput(f.weightGrams)) : 0), 0);
      if (!plate.filaments.length || rows.length !== plate.filaments.length || new Set(rows.map((f) => f.trayId)).size !== rows.length || plate.filaments.some((f) => !rows.some((row) => row.trayId === f.trayId)) || !Number.isFinite(plate.totalWeightGrams) || plate.totalWeightGrams <= 0 || Math.abs(weight - plate.totalWeightGrams) > 0.1) {
        incompleteReasons.push(`Пластина ${plate.plateName}: неповні дані витрат матеріалів`);
      }
  }

  // 2. Materials Cost
  let materialsCostDec = new Decimal(0);

  for (const f of input.filaments) {
    const repeats = plateRepeats.get(f.plateIndex);
    if (!repeats) continue; // Plate is not selected

    if (!getEffectiveMaterialType(f)) incompleteReasons.push(`Уточніть невідомий тип матеріалу (Пластина: ${f.plateName}).`);
    if (isKnownMaterialType(f.typeFromFile) && f.effectiveMaterialType !== undefined) incompleteReasons.push(`Тип ${f.typeFromFile} визначено у файлі й не можна перевизначити.`);
    const source = selectedPlates.find(plate => plate.plateIndex === f.plateIndex)?.filaments.find(layer => layer.trayId === f.trayId);
    if (source && normalizeMaterialType(source.type) !== normalizeMaterialType(f.typeFromFile)) incompleteReasons.push(`Тип матеріалу не збігається з даними файлу (Пластина: ${f.plateName}).`);

    const weightDec = readDecimal(f.weightGrams, `Маса ${f.typeFromFile}`).mul(repeats);
    totalWeightGramsDec = totalWeightGramsDec.plus(weightDec);

    const pricePerKg = readDecimal(f.pricePerKgUah, `Ціна ${f.typeFromFile}`);
    if (pricePerKg.lte(0)) {
      incompleteReasons.push(`Не задано ціну для матеріалу "${f.typeFromFile}" (Пластина: ${f.plateName})`);
    } else {
      // (weight in grams / 1000) * pricePerKg
      const itemCost = weightDec.div(1000).mul(materialPriceForCost(pricePerKg, f, taxSettings, incompleteReasons));
      materialsCostDec = materialsCostDec.plus(itemCost);
    }
  }

  // 3. Electricity calculation
  const durationHoursDec = new Decimal(totalDurationSeconds).div(3600);
  const powerWattsDec = readDecimal(input.averagePowerWatts, 'Потужність принтера');
  const powerKwDec = powerWattsDec.div(1000);
  const totalEnergyKwhDec = durationHoursDec.mul(powerKwDec);

  const tariffDec = readDecimal(input.electricityTariffUahPerKwh, 'Тариф на електроенергію');
  const electricityCostDec = totalEnergyKwhDec.mul(tariffDec);

  // 4. Machine time cost
  const machineHourlyRateDec = readDecimal(input.machineHourlyRateUah, 'Машинна ставка');
  const machineCostDec = durationHoursDec.mul(machineHourlyRateDec);

  // 5. Additional fixed costs (applied ONCE per order)
  const operatorCostDec = readDecimal(input.operatorFeeUah, 'Робота оператора', true);
  const packagingCostDec = readDecimal(input.packagingFeeUah, 'Пакування', true);
  const postProcessingCostDec = readDecimal(input.postProcessingFeeUah, 'Постобробка', true);
  const otherCostDec = readDecimal(input.otherFeeUah, 'Інші витрати', true);

  // Base cost subtotal
  const baseCostSubtotalDec = materialsCostDec
    .plus(electricityCostDec)
    .plus(machineCostDec)
    .plus(operatorCostDec)
    .plus(packagingCostDec)
    .plus(postProcessingCostDec)
    .plus(otherCostDec);

  // 6. Scrap & contingency reserve
  const reservePercentDec = readDecimal(input.scrapReservePercent, 'Резерв', true);
  const scrapReserveDec = baseCostSubtotalDec.mul(reservePercentDec.div(100));

  // Total cost price (собівартість)
  const costPriceDec = baseCostSubtotalDec.plus(scrapReserveDec);

  // 7. Pricing method
  let preRoundingPriceDec = new Decimal(0);
  let minOrderApplied = false;
  let finalPriceDec = new Decimal(0);
  let taxResult: TaxResult | undefined;
  if (!['target_margin', 'markup'].includes(input.pricingMode)) incompleteReasons.push('Невідомий спосіб ціноутворення');
  if (taxSettings) {
    const taxPricing = calculateTaxPrice({ settings: taxSettings, cost: costPriceDec, durationHours: durationHoursDec,
      pricingMode: input.pricingMode, markupPercent: input.markupPercent, marginPercent: input.marginPercent,
      minimumGross: input.minOrderPriceUah, roundGross: value => applyRounding(value, input.roundingMode), reasons: incompleteReasons });
    preRoundingPriceDec = taxPricing.preRoundingPrice;
    finalPriceDec = taxPricing.finalPrice;
    minOrderApplied = taxPricing.minOrderApplied;
    taxResult = taxPricing.tax;
  } else {
  const isTargetMargin = input.pricingMode === 'target_margin';

  if (isTargetMargin) {
    const marginPercentDec = readDecimal(input.marginPercent, 'Маржа', true);
    if (marginPercentDec.gte(100)) {
      incompleteReasons.push('Цільова маржа не може дорівнювати або перевищувати 100%');
    } else if (marginPercentDec.lt(0)) {
      incompleteReasons.push('Цільова маржа не може бути від’ємною');
    } else {
      const divisor = new Decimal(1).minus(marginPercentDec.div(100));
      if (divisor.lte(0)) incompleteReasons.push('Маржа надто близька до 100%');
      else preRoundingPriceDec = costPriceDec.div(divisor);
    }
  } else {
    // Markup mode
    const markupPercentDec = readDecimal(input.markupPercent, 'Націнка', true);
    preRoundingPriceDec = costPriceDec.mul(new Decimal(1).plus(markupPercentDec.div(100)));
  }

  // 8. Minimum order
  const minOrderPriceDec = readDecimal(input.minOrderPriceUah, 'Мінімальна ціна', true);
  let priceBeforeRounding = preRoundingPriceDec;

  if (priceBeforeRounding.lt(minOrderPriceDec)) {
    priceBeforeRounding = minOrderPriceDec;
    minOrderApplied = true;
  }

  // 9. Rounding
  finalPriceDec = applyRounding(priceBeforeRounding, input.roundingMode);
  }
  if (!Number.isFinite(finalPriceDec.toNumber())) {
    incompleteReasons.push('Ціна перевищує допустимий діапазон');
    finalPriceDec = new Decimal(0);
  }
  if (!['none', 'up_1', 'up_5', 'up_10', 'up_50', 'up_100'].includes(input.roundingMode)) incompleteReasons.push('Невідоме правило округлення');
  if (!Number.isSafeInteger(Math.ceil(totalDurationSeconds))) incompleteReasons.push('Завелика сумарна тривалість друку');

  // 10. Profit & Margin calculation
  const profitDec = taxResult ? new Decimal(taxResult.profitAfterTaxUah) : finalPriceDec.minus(costPriceDec);
  let marginPercentActualDec = new Decimal(0);
  if (taxResult) marginPercentActualDec = new Decimal(taxResult.marginAfterTaxPercent);
  else if (finalPriceDec.gt(0)) {
    marginPercentActualDec = profitDec.div(finalPriceDec).mul(100);
  }

  let markupPercentActualDec = new Decimal(0);
  if (costPriceDec.gt(0)) {
    markupPercentActualDec = profitDec.div(costPriceDec).mul(100);
  }

  const isComplete = incompleteReasons.length === 0;

  return {
    ...(taxResult ? { tax: taxResult } : {}),
    status: isComplete ? 'complete' : 'incomplete',
    incompleteReasons,
    totalWeightGrams: totalWeightGramsDec.toFixed(2),
    totalDurationSeconds,
    totalEnergyKwh: totalEnergyKwhDec.toFixed(3),
    materialsCostUah: materialsCostDec.toFixed(2),
    electricityCostUah: electricityCostDec.toFixed(2),
    machineCostUah: machineCostDec.toFixed(2),
    operatorCostUah: operatorCostDec.toFixed(2),
    packagingCostUah: packagingCostDec.toFixed(2),
    postProcessingCostUah: postProcessingCostDec.toFixed(2),
    otherCostUah: otherCostDec.toFixed(2),
    baseCostSubtotalUah: baseCostSubtotalDec.toFixed(2),
    scrapReserveUah: scrapReserveDec.toFixed(2),
    costPriceUah: costPriceDec.toFixed(2),
    preRoundingPriceUah: preRoundingPriceDec.toFixed(2),
    minOrderApplied,
    sellingPriceUah: finalPriceDec.toFixed(2),
    profitUah: profitDec.toFixed(2),
    marginPercent: marginPercentActualDec.toFixed(2),
    markupPercentActual: markupPercentActualDec.toFixed(2),
  };
}

function applyRounding(val: Decimal, mode: RoundingMode): Decimal {
  if (mode === 'none') {
    return val.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }

  let step = 1;
  switch (mode) {
    case 'up_1':
      step = 1;
      break;
    case 'up_5':
      step = 5;
      break;
    case 'up_10':
      step = 10;
      break;
    case 'up_50':
      step = 50;
      break;
    case 'up_100':
      step = 100;
      break;
  }

  // ceil(val / step) * step
  const divided = val.div(step);
  const ceiled = divided.ceil();
  return ceiled.mul(step).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
