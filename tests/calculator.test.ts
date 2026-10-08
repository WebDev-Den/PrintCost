import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrintCost } from '../src/domain/calculator.ts';
import { isValidDecimalString } from '../src/domain/formatters.ts';
import type { CalculationInput } from '../src/domain/types.ts';

const fixture = (): CalculationInput => ({
  job: { fileName: 'fixture.gcode', fileSizeBytes: 100, slicerSource: 'test', parseStatus: 'success', warnings: [], totalWeightGrams: 100, totalPredictionSeconds: 3600,
    plates: [{ plateIndex: 1, plateName: 'Plate 1', predictionSeconds: 3600, totalWeightGrams: 100, selected: true, repeatsCount: 1, filaments: [{ trayId: 1, type: 'PLA', colorHex: '#ffffff', weightGrams: 100 }] }] },
  filaments: [{ key: '1_1', plateIndex: 1, plateName: 'Plate 1', trayId: 1, typeFromFile: 'PLA', colorHex: '#ffffff', weightGrams: '100', lengthMeters: null, mappedMaterialId: null, matchMethod: 'manual', pricePerKgUah: '1000', costUah: '100' }],
  selectedPrinterId: null, averagePowerWatts: '100', electricityTariffUahPerKwh: '5', machineHourlyRateUah: '10', operatorFeeUah: '20', packagingFeeUah: '0', postProcessingFeeUah: '0', otherFeeUah: '0', scrapReservePercent: '10', pricingMode: 'markup', markupPercent: '100', marginPercent: '50', minOrderPriceUah: '0', roundingMode: 'up_10',
});

test('money uses decimal arithmetic; repeats multiply printing costs and apply fixed fees once', () => {
  const input = fixture();
  assert.equal(calculatePrintCost(input).costPriceUah, '143.55');
  assert.equal(calculatePrintCost(input).sellingPriceUah, '290.00');
  input.job.plates[0].repeatsCount = 2;
  const result = calculatePrintCost(input);
  assert.equal(result.status, 'complete');
  assert.equal(result.totalWeightGrams, '200.00');
  assert.equal(result.totalDurationSeconds, 7200);
  assert.equal(result.costPriceUah, '265.10');
  assert.equal(result.operatorCostUah, '20.00');
  input.pricingMode = 'target_margin';
  input.marginPercent = '25';
  input.roundingMode = 'none';
  assert.equal(calculatePrintCost(input).sellingPriceUah, '353.47');
});

test('comma decimals work; invalid, nonfinite and negative inputs never crash or look complete', () => {
  const input = fixture();
  input.filaments[0].pricePerKgUah = '650,50';
  assert.equal(calculatePrintCost(input).materialsCostUah, '65.05');
  for (const invalid of ['abc', '-', 'NaN', 'Infinity', '12abc', '-1']) {
    assert.equal(isValidDecimalString(invalid), false);
    const bad = fixture();
    bad.filaments[0].pricePerKgUah = invalid;
    bad.machineHourlyRateUah = invalid;
    bad.operatorFeeUah = invalid;
    bad.scrapReservePercent = invalid;
    const result = calculatePrintCost(bad);
    assert.equal(result.status, 'incomplete');
    assert.equal(Number.isFinite(Number(result.sellingPriceUah)), true);
  }
  input.marginPercent = '100';
  input.pricingMode = 'target_margin';
  assert.equal(calculatePrintCost(input).status, 'incomplete');
  input.marginPercent = '99.9999999999999999999999';
  assert.equal(calculatePrintCost(input).status, 'incomplete');
  assert.equal(Number.isFinite(Number(calculatePrintCost(input).sellingPriceUah)), true);
});

test('unsliced jobs, missing material rows, bad repeats and missing duration cannot be quoted', () => {
  for (const change of [
    (input: CalculationInput) => { input.job.parseStatus = 'no_slicing_data'; },
    (input: CalculationInput) => { input.filaments = []; },
    (input: CalculationInput) => { input.filaments[0].weightGrams = '1'; },
    (input: CalculationInput) => { input.job.plates[0].repeatsCount = 0; },
    (input: CalculationInput) => { input.job.plates[0].repeatsCount = 1.5; },
    (input: CalculationInput) => { input.job.plates[0].predictionSeconds = Infinity; },
    (input: CalculationInput) => { input.job.plates.push(structuredClone(input.job.plates[0])); },
  ]) {
    const input = fixture(); change(input);
    assert.equal(calculatePrintCost(input).status, 'incomplete');
  }
  const input = fixture();
  input.job.plates.push({ ...structuredClone(input.job.plates[0]), plateIndex: 2, selected: false });
  input.filaments.push({ ...input.filaments[0], key: '2_1', plateIndex: 2, pricePerKgUah: null });
  assert.equal(calculatePrintCost(input).status, 'complete');
  assert.equal(calculatePrintCost(input).materialsCostUah, '100.00');
});
