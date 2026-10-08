import assert from 'node:assert/strict';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { calculatePrintCost } from '../src/domain/calculator.ts';
import { createTaxPreset, DEFAULT_TAX_SETTINGS, materialPriceForCost, MAX_TAX_MONEY, normalizeTaxSettings,
  TAX_PRESET_VERSION, validateMaterialVat, validateTaxResult, type TaxSettings } from '../src/domain/taxes.ts';
import type { CalculationInput } from '../src/domain/types.ts';

function fixture(tax?: TaxSettings): CalculationInput {
  return {
    job: { fileName: 'tax-fixture.gcode', fileSizeBytes: 100, slicerSource: 'test', parseStatus: 'success', warnings: [], totalWeightGrams: 1000, totalPredictionSeconds: 3600,
      plates: [{ plateIndex: 1, plateName: 'Plate 1', predictionSeconds: 3600, totalWeightGrams: 1000, selected: true, repeatsCount: 1,
        filaments: [{ trayId: 1, type: 'PLA', colorHex: '#ffffff', weightGrams: 1000 }] }] },
    filaments: [{ key: '1_1', plateIndex: 1, plateName: 'Plate 1', trayId: 1, typeFromFile: 'PLA', colorHex: '#ffffff', weightGrams: '1000', lengthMeters: null,
      mappedMaterialId: null, matchMethod: 'manual', pricePerKgUah: '1000', costUah: '1000' }],
    selectedPrinterId: null, averagePowerWatts: '0', electricityTariffUahPerKwh: '0', machineHourlyRateUah: '0', operatorFeeUah: '0', packagingFeeUah: '0',
    postProcessingFeeUah: '0', otherFeeUah: '0', scrapReservePercent: '0', pricingMode: 'markup', markupPercent: '20', marginPercent: '20',
    minOrderPriceUah: '0', roundingMode: 'none', ...(tax ? { tax } : {}),
  };
}
function preset(regime: TaxSettings['regime'] = 'fop3', vatPayer = false): TaxSettings {
  return { ...createTaxPreset(regime, vatPayer), monthlyEsvUah: '0' };
}

test('tax missing and disabled preserve every legacy arithmetic result and do not add tax output', () => {
  const legacy = calculatePrintCost(fixture());
  assert.deepEqual(calculatePrintCost(fixture({ ...DEFAULT_TAX_SETTINGS, enabled: false })), legacy);
  assert.equal(legacy.tax, undefined);
  assert.equal(legacy.sellingPriceUah, '1200.00');
  assert.equal(legacy.profitUah, '200.00');
});

test('cover fixture solves revenue taxes before VAT while preserving desired production markup profit', () => {
  const result = calculatePrintCost(fixture(preset('fop3', true)));
  assert.equal(result.status, 'complete');
  assert.equal(result.sellingPriceUah, '1500.00');
  assert.equal(result.profitUah, '200.00');
  assert.equal(result.marginPercent, '16.00');
  assert.equal(result.tax?.netRevenueUah, '1250.00');
  assert.equal(result.tax?.unifiedTaxUah, '37.50');
  assert.equal(result.tax?.militaryTaxUah, '12.50');
  assert.equal(result.tax?.totalTaxesUah, '50.00');
  assert.equal(result.tax?.vatUah, '250.00');
  assert.equal(result.tax?.profitBeforeTaxUah, '250.00');
  assert.equal(result.tax?.presetVersion, TAX_PRESET_VERSION);
  assert.doesNotThrow(() => validateTaxResult(result.tax));
});

test('general and manual income-based taxes use explicit net taxable income and clamp negative bases', () => {
  for (const regime of ['general', 'manual'] as const) {
    const tax = { ...preset(regime), incomeTaxPercent: '18', militaryTaxPercent: '5', netTaxableIncomeUah: '500' };
    const result = calculatePrintCost(fixture(tax));
    assert.equal(result.status, 'complete');
    assert.equal(result.tax?.incomeTaxUah, '90.00');
    assert.equal(result.tax?.militaryTaxUah, '25.00');
    assert.equal(result.tax?.netTaxableIncomeUah, '500');
    assert.equal(result.sellingPriceUah, '1315.00');
    assert.equal(result.profitUah, '200.00');
    for (const netTaxableIncomeUah of ['0', '-500']) {
      const zero = calculatePrintCost(fixture({ ...tax, netTaxableIncomeUah }));
      assert.equal(zero.status, 'complete');
      assert.equal(zero.tax?.incomeTaxUah, '0.00');
      assert.equal(zero.tax?.militaryTaxUah, '0.00');
      assert.equal(zero.tax?.netTaxableIncomeUah, '0');
    }
    const missing = calculatePrintCost(fixture({ ...tax, netTaxableIncomeUah: null }));
    assert.equal(missing.status, 'incomplete');
    assert.ok(missing.incompleteReasons.some(reason => reason.includes('оподатковуваний дохід')));
  }
});

test('fixed monthly payments allocate once per order or across the actual repeated printing hours', () => {
  const tax = { ...preset('fop2'), monthlyUnifiedTaxUah: '100', monthlyMilitaryTaxUah: '40', monthlyEsvUah: '60', monthlyOtherUah: '20', monthlyOrders: '10' };
  const input = fixture(tax);
  input.job.plates[0].repeatsCount = 3;
  const order = calculatePrintCost(input);
  assert.equal(order.totalDurationSeconds, 10800);
  assert.equal(order.tax?.allocatedUnifiedTaxUah, '10.00');
  assert.equal(order.tax?.allocatedMilitaryTaxUah, '4.00');
  assert.equal(order.tax?.allocatedEsvUah, '6.00');
  assert.equal(order.tax?.allocatedOtherUah, '2.00');
  assert.equal(order.tax?.totalPaymentsUah, '22.00');
  assert.equal(order.sellingPriceUah, '3622.00');
  assert.equal(order.profitUah, '600.00');
  input.tax = { ...tax, allocationMode: 'hours', monthlyBillableHours: '10' };
  const hours = calculatePrintCost(input);
  assert.equal(hours.tax?.totalPaymentsUah, '66.00');
  assert.equal(hours.tax?.allocatedEsvUah, '18.00');
  input.tax.monthlyBillableHours = '0';
  assert.equal(calculatePrintCost(input).status, 'incomplete');
  input.tax = { ...preset('fop3'), monthlyOrders: '0' };
  assert.equal(calculatePrintCost(input).status, 'complete');
});

test('after-tax target margin uses net revenue and final gross minimum/rounding recomputes every tax row', () => {
  const input = fixture(preset('fop3', true));
  input.pricingMode = 'target_margin';
  const target = calculatePrintCost(input);
  assert.equal(target.status, 'complete');
  assert.equal(target.sellingPriceUah, '1578.95');
  assert.equal(target.tax?.netRevenueUah, '1315.79');
  assert.equal(target.profitUah, '263.16');
  assert.equal(target.marginPercent, '20.00');
  input.pricingMode = 'markup';
  input.minOrderPriceUah = '1501';
  input.roundingMode = 'up_100';
  const rounded = calculatePrintCost(input);
  assert.equal(rounded.sellingPriceUah, '1600.00');
  assert.equal(rounded.minOrderApplied, true);
  assert.equal(rounded.tax?.netRevenueUah, '1333.33');
  assert.equal(rounded.tax?.vatUah, '266.67');
  assert.equal(rounded.tax?.totalTaxesUah, '53.33');
  assert.equal(rounded.profitUah, '280.00');
  input.pricingMode = 'target_margin'; input.marginPercent = '96';
  const impossible = calculatePrintCost(input);
  assert.equal(impossible.status, 'incomplete');
  assert.ok(impossible.incompleteReasons.some(reason => reason.includes('не залишають')));
});

test('estimate uses the explicit customer gross price and ignores automatic price changes', () => {
  const input = fixture({ ...preset('fop3', true), scenario: 'estimate', customerPriceUah: '1500' });
  input.minOrderPriceUah = '9000'; input.roundingMode = 'up_100'; input.markupPercent = '500';
  const result = calculatePrintCost(input);
  assert.equal(result.sellingPriceUah, '1500.00');
  assert.equal(result.minOrderApplied, false);
  assert.equal(result.profitUah, '200.00');
  assert.equal(result.tax?.scenario, 'estimate');
  input.tax!.customerPriceUah = null;
  assert.equal(calculatePrintCost(input).status, 'incomplete');
});

test('material VAT only recovers explicitly documented VAT for an enabled VAT payer', () => {
  const input = fixture(preset('fop3', true));
  input.filaments[0].pricePerKgUah = '1200';
  input.filaments[0].priceVatMode = 'included';
  input.filaments[0].vatRatePercent = '20';
  assert.equal(calculatePrintCost(input).costPriceUah, '1200.00');
  input.filaments[0].vatRecoverable = true;
  assert.equal(calculatePrintCost(input).costPriceUah, '1000.00');
  input.tax = { ...preset('fop3'), enabled: true };
  assert.equal(calculatePrintCost(input).costPriceUah, '1200.00');
  input.tax = { ...DEFAULT_TAX_SETTINGS, vatPayer: true, enabled: false };
  assert.equal(calculatePrintCost(input).costPriceUah, '1200.00');
  input.filaments[0].priceVatMode = 'excluded'; input.filaments[0].pricePerKgUah = '1000';
  assert.equal(calculatePrintCost(input).costPriceUah, '1200.00');
  input.tax = preset('fop3', true);
  assert.equal(calculatePrintCost(input).costPriceUah, '1000.00');
  input.filaments[0].vatRecoverable = false;
  assert.equal(calculatePrintCost(input).costPriceUah, '1200.00');
  assert.equal(materialPriceForCost(new Decimal(1000), {}, input.tax, []).toFixed(), '1000');
});

test('presets reject incompatible VAT/rates while malformed amounts and metadata remain incomplete', () => {
  for (const tax of [{ ...preset('fop3', true), unifiedTaxPercent: '5' }, { ...preset('fop3'), unifiedTaxPercent: '3' },
    { ...preset('fop1'), vatPayer: true }, { ...preset('general'), incomeTaxPercent: '17' }]) {
    assert.throws(() => normalizeTaxSettings(tax));
    assert.equal(calculatePrintCost(fixture(tax)).status, 'incomplete');
  }
  assert.equal(normalizeTaxSettings({ ...preset('manual'), monthlyEsvUah: '12,50', netTaxableIncomeUah: '-.5' }).monthlyEsvUah, '12.5');
  assert.equal(normalizeTaxSettings({ ...preset('manual'), monthlyEsvUah: MAX_TAX_MONEY }).monthlyEsvUah, MAX_TAX_MONEY);
  for (const change of [{ monthlyEsvUah: '1000000000000' }, { monthlyEsvUah: '-1' }, { unifiedTaxPercent: '101' },
    { monthlyEsvUah: '1.1234567' }, { monthlyOrders: '1.5' }, { monthlyBillableHours: 'Infinity' }, { enabled: 'true' }]) {
    assert.throws(() => normalizeTaxSettings({ ...preset('manual'), ...change } as TaxSettings));
  }
  for (const metadata of [{ priceVatMode: 'included', vatRatePercent: '200' }, { priceVatMode: 'other' },
    { priceVatMode: 'excluded', vatRatePercent: '20', vatRecoverable: 'true' }, { vatRatePercent: '20' }]) {
    assert.throws(() => validateMaterialVat(metadata));
    const input = fixture(preset()); Object.assign(input.filaments[0], metadata);
    assert.equal(calculatePrintCost(input).status, 'incomplete');
  }
});

test('persisted tax results reject nested privileges, wrong source URLs and negative tax rows', () => {
  const tax = calculatePrintCost(fixture(preset('fop3', true))).tax!;
  assert.doesNotThrow(() => validateTaxResult(tax));
  for (const change of [{ admin: true }, { vatUah: '-1' }, { militaryTaxUah: 'Infinity' }, { sourceUrls: ['https://attacker.test'] },
    { profitAfterTaxUah: 200 }, { netTaxableIncomeUah: '-1' }, { presetVersion: '' }]) {
    assert.throws(() => validateTaxResult({ ...tax, ...change }));
  }
  assert.doesNotThrow(() => validateTaxResult({ ...tax, profitAfterTaxUah: '-200', marginAfterTaxPercent: '-16' }));
});

test('extreme allocations report incomplete results and never expose unpersistable tax amounts', () => {
  const extreme = calculatePrintCost(fixture({ ...preset('manual'), monthlyEsvUah: MAX_TAX_MONEY,
    allocationMode: 'hours', monthlyBillableHours: '0.000001' }));
  assert.equal(extreme.status, 'incomplete');
  assert.equal(extreme.tax, undefined);
  assert.ok(extreme.incompleteReasons.some(reason => reason.includes('діапазон')));
  assert.equal(Number.isFinite(Number(extreme.sellingPriceUah)), true);
  const maximumBase = calculatePrintCost(fixture({ ...preset('general'), netTaxableIncomeUah: MAX_TAX_MONEY }));
  assert.equal(maximumBase.status, 'complete');
  assert.equal(maximumBase.tax?.netTaxableIncomeUah, MAX_TAX_MONEY);
  assert.doesNotThrow(() => validateTaxResult(maximumBase.tax));
});
