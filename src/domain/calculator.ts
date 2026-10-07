import { Decimal } from 'decimal.js';
import type { CalculationInput, CalculationResult, RoundingMode } from './types.ts';

/**
 * Pure domain calculation engine for PrintCost.
 * Implements strict precision calculation via Decimal.js.
 */
export function calculatePrintCost(input: CalculationInput): CalculationResult {
  const incompleteReasons: string[] = [];

  // 1. Calculate duration and validate selected plates
  const selectedPlates = input.job.plates.filter((p) => p.selected);
  if (selectedPlates.length === 0) {
    incompleteReasons.push('Не вибрано жодної пластини для розрахунку');
  }

  let totalDurationSeconds = 0;
  let totalWeightGramsDec = new Decimal(0);

  // Map of plate index to repeat count
  const plateRepeats = new Map<number, number>();
  for (const plate of input.job.plates) {
    if (plate.selected) {
      const repeats = Math.max(1, plate.repeatsCount || 1);
      plateRepeats.set(plate.plateIndex, repeats);
      totalDurationSeconds += plate.predictionSeconds * repeats;
    }
  }

  // 2. Materials Cost
  let materialsCostDec = new Decimal(0);

  for (const f of input.filaments) {
    const repeats = plateRepeats.get(f.plateIndex);
    if (!repeats) continue; // Plate is not selected

    const weightDec = new Decimal(f.weightGrams || '0').mul(repeats);
    totalWeightGramsDec = totalWeightGramsDec.plus(weightDec);

    if (!f.pricePerKgUah || new Decimal(f.pricePerKgUah).isNaN() || new Decimal(f.pricePerKgUah).lte(0)) {
      incompleteReasons.push(`Не задано ціну для матеріалу "${f.typeFromFile}" (Пластина: ${f.plateName})`);
    } else {
      const pricePerKg = new Decimal(f.pricePerKgUah);
      // (weight in grams / 1000) * pricePerKg
      const itemCost = weightDec.div(1000).mul(pricePerKg);
      materialsCostDec = materialsCostDec.plus(itemCost);
    }
  }

  // 3. Electricity calculation
  const durationHoursDec = new Decimal(totalDurationSeconds).div(3600);
  const powerWattsDec = new Decimal(input.averagePowerWatts || '0');
  const powerKwDec = powerWattsDec.div(1000);
  const totalEnergyKwhDec = durationHoursDec.mul(powerKwDec);

  let electricityCostDec = new Decimal(0);
  if (
    !input.electricityTariffUahPerKwh ||
    new Decimal(input.electricityTariffUahPerKwh).isNaN() ||
    new Decimal(input.electricityTariffUahPerKwh).lte(0)
  ) {
    incompleteReasons.push('Не задано тариф на електроенергію (грн/кВт·год)');
  } else {
    const tariffDec = new Decimal(input.electricityTariffUahPerKwh);
    electricityCostDec = totalEnergyKwhDec.mul(tariffDec);
  }

  // 4. Machine time cost
  let machineCostDec = new Decimal(0);
  if (!input.machineHourlyRateUah || new Decimal(input.machineHourlyRateUah).isNaN()) {
    incompleteReasons.push('Не задано машинну ставку принтера (грн/год)');
  } else {
    const machineHourlyRateDec = new Decimal(input.machineHourlyRateUah);
    machineCostDec = durationHoursDec.mul(machineHourlyRateDec);
  }

  // 5. Additional fixed costs (applied ONCE per order)
  const operatorCostDec = new Decimal(input.operatorFeeUah || '0');
  const packagingCostDec = new Decimal(input.packagingFeeUah || '0');
  const postProcessingCostDec = new Decimal(input.postProcessingFeeUah || '0');
  const otherCostDec = new Decimal(input.otherFeeUah || '0');

  // Base cost subtotal
  const baseCostSubtotalDec = materialsCostDec
    .plus(electricityCostDec)
    .plus(machineCostDec)
    .plus(operatorCostDec)
    .plus(packagingCostDec)
    .plus(postProcessingCostDec)
    .plus(otherCostDec);

  // 6. Scrap & contingency reserve
  const reservePercentDec = new Decimal(input.scrapReservePercent || '0');
  const scrapReserveDec = baseCostSubtotalDec.mul(reservePercentDec.div(100));

  // Total cost price (собівартість)
  const costPriceDec = baseCostSubtotalDec.plus(scrapReserveDec);

  // 7. Pricing method
  let preRoundingPriceDec = new Decimal(0);
  const isTargetMargin = input.pricingMode === 'target_margin';

  if (isTargetMargin) {
    const marginPercentDec = new Decimal(input.marginPercent || '0');
    if (marginPercentDec.gte(100)) {
      incompleteReasons.push('Цільова маржа не може дорівнювати або перевищувати 100%');
    } else if (marginPercentDec.lt(0)) {
      incompleteReasons.push('Цільова маржа не може бути від’ємною');
    } else {
      const divisor = new Decimal(1).minus(marginPercentDec.div(100));
      preRoundingPriceDec = costPriceDec.div(divisor);
    }
  } else {
    // Markup mode
    const markupPercentDec = new Decimal(input.markupPercent || '0');
    preRoundingPriceDec = costPriceDec.mul(new Decimal(1).plus(markupPercentDec.div(100)));
  }

  // 8. Minimum order
  const minOrderPriceDec = new Decimal(input.minOrderPriceUah || '0');
  let minOrderApplied = false;
  let priceBeforeRounding = preRoundingPriceDec;

  if (priceBeforeRounding.lt(minOrderPriceDec)) {
    priceBeforeRounding = minOrderPriceDec;
    minOrderApplied = true;
  }

  // 9. Rounding
  const finalPriceDec = applyRounding(priceBeforeRounding, input.roundingMode);

  // 10. Profit & Margin calculation
  const profitDec = finalPriceDec.minus(costPriceDec);
  let marginPercentActualDec = new Decimal(0);
  if (finalPriceDec.gt(0)) {
    marginPercentActualDec = profitDec.div(finalPriceDec).mul(100);
  }

  let markupPercentActualDec = new Decimal(0);
  if (costPriceDec.gt(0)) {
    markupPercentActualDec = profitDec.div(costPriceDec).mul(100);
  }

  const isComplete = incompleteReasons.length === 0;

  return {
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
