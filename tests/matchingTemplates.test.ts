import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePrintCost } from '../src/domain/calculator.ts';
import { applyCalculationTemplate, CALCULATION_ALGORITHM_VERSION, extractTemplateParameters, normalizeMaterialMappings,
  validateCalculationTemplate } from '../src/domain/calculationTemplates.ts';
import { clearMaterialMapping, findMaterialMatch, getEffectiveMaterialType, isCompatibleMaterial, isKnownMaterialType,
  normalizeMaterialType } from '../src/domain/materialMatching.ts';
import { createTaxPreset } from '../src/domain/taxes.ts';
import type { CalculationInput, CalculationTemplate, FilamentUsage, MaterialProfile, PrinterProfile } from '../src/domain/types.ts';

const date = '2026-10-08T12:00:00.000Z';
function material(id: string, type = 'PLA', isArchived = false): MaterialProfile {
  return { id, type, name: `${type} ${id}`, family: 'Стандартні', brand: 'Own brand', pricePerKgUah: '650', isArchived, createdAt: date, spoolsInStock: 0 };
}
function fixture(): CalculationInput {
  return { job: { fileName: 'actual.gcode', fileSizeBytes: 100, slicerSource: 'test', parseStatus: 'success', warnings: [], totalWeightGrams: 100, totalPredictionSeconds: 3600,
    plates: [{ plateIndex: 1, plateName: 'Plate 1', predictionSeconds: 3600, totalWeightGrams: 100, selected: true, repeatsCount: 2,
      filaments: [{ trayId: 1, type: 'PLA', colorHex: '#ffffff', weightGrams: 100 }] }] },
    filaments: [{ key: '1_1', plateIndex: 1, plateName: 'Plate 1', trayId: 1, typeFromFile: 'PLA', colorHex: '#ffffff', weightGrams: '100', lengthMeters: null,
      mappedMaterialId: null, matchMethod: 'manual', pricePerKgUah: '1000', costUah: '100' }],
    selectedPrinterId: 'printer-a', averagePowerWatts: '100', electricityTariffUahPerKwh: '5', machineHourlyRateUah: '10', operatorFeeUah: '20', packagingFeeUah: '0',
    postProcessingFeeUah: '0', otherFeeUah: '0', scrapReservePercent: '10', pricingMode: 'markup', markupPercent: '100', marginPercent: '50', minOrderPriceUah: '0', roundingMode: 'up_10' };
}
const printer: PrinterProfile = { id: 'printer-a', name: 'Printer A', averagePowerWatts: '100', costCalculationMode: 'manual_rate', machineHourlyRateUah: '10', isDefault: false, createdAt: date };
function template(): CalculationTemplate {
  return { id: 'template-a', name: 'Production', parameters: extractTemplateParameters(fixture()), materialMappings: { PLA: 'pla-a' }, version: 1, createdAt: date, updatedAt: date };
}

test('material types normalize case and edges without collapsing PLA variants or guessing unknown types', () => {
  assert.equal(normalizeMaterialType('  pla-cf  '), 'PLA-CF');
  for (const type of ['', 'UNKNOWN', ' undefined ', 'Невідомий', 'Невідомо', 'N/A', 'Не визначено', null]) assert.equal(isKnownMaterialType(type), false);
  assert.equal(isKnownMaterialType('Own Polymer'), true);
  assert.equal(isCompatibleMaterial(material('pla-a', ' pla '), ' PLA '), true);
  assert.equal(isCompatibleMaterial(material('pla-cf', 'PLA-CF'), 'PLA'), false);
  assert.equal(isCompatibleMaterial(material('petg', 'PETG'), 'PLA'), false);
  assert.equal(isCompatibleMaterial(material('archived', 'PLA', true), 'PLA'), false);
  assert.equal(isCompatibleMaterial(material('zero-stock'), 'PLA'), true);
  assert.equal(getEffectiveMaterialType({ typeFromFile: 'PLA', effectiveMaterialType: 'PETG' }), 'PLA');
  assert.equal(getEffectiveMaterialType({ typeFromFile: 'Невідомий', effectiveMaterialType: ' pla ' }), 'PLA');
});

test('preset lookup never uses deleted, archived or incompatible material and fallback remains exact', () => {
  const pla = material('pla-a');
  const items = [material('petg', 'PETG'), material('archived', 'PLA', true), material('pla-cf', 'PLA-CF'), pla];
  assert.deepEqual(findMaterialMatch('pla', items, { ' PLA ': 'pla-a' }), { material: pla, method: 'exact_preset' });
  for (const id of ['deleted', 'petg', 'archived', 'pla-cf']) assert.deepEqual(findMaterialMatch('PLA', items, { PLA: id }), { material: pla, method: 'type_match' });
  assert.deepEqual(findMaterialMatch('PLA', items.slice(0, 3), { PLA: 'deleted' }), { material: null, method: 'unmatched' });
  assert.deepEqual(findMaterialMatch('Невідомий', items, { Невідомий: 'pla-a' }), { material: null, method: 'unmatched' });
});

test('clearing a mapping removes all old identity, price and VAT while retaining slice data and explicit clarification', () => {
  const filament: FilamentUsage = { ...fixture().filaments[0], typeFromFile: 'Невідомий', effectiveMaterialType: 'PLA', mappedMaterialId: 'old', mappedMaterialName: 'Old brand',
    priceVatMode: 'included', vatRatePercent: '20', vatRecoverable: true };
  const cleared = clearMaterialMapping(filament);
  assert.equal(cleared.mappedMaterialId, null); assert.equal(cleared.pricePerKgUah, null); assert.equal(cleared.costUah, null);
  assert.equal(cleared.matchMethod, 'unmatched'); assert.equal(cleared.effectiveMaterialType, 'PLA');
  for (const field of ['mappedMaterialName', 'priceVatMode', 'vatRatePercent', 'vatRecoverable']) assert.equal(Object.hasOwn(cleared, field), false);
  assert.equal(cleared.weightGrams, filament.weightGrams); assert.equal(cleared.trayId, filament.trayId);
  assert.equal(filament.mappedMaterialId, 'old');
});

test('new calculations require unknown-type clarification and cannot override the original known file type', () => {
  const input = fixture();
  input.job.plates[0].filaments[0].type = 'Невідомий'; input.filaments[0].typeFromFile = 'Невідомий';
  assert.equal(calculatePrintCost(input).status, 'incomplete');
  input.filaments[0].effectiveMaterialType = ' pla ';
  assert.equal(calculatePrintCost(input).status, 'complete');
  const known = fixture(); known.filaments[0].effectiveMaterialType = 'PETG';
  assert.equal(calculatePrintCost(known).status, 'incomplete');
  known.filaments[0].effectiveMaterialType = 'PLA';
  assert.equal(calculatePrintCost(known).status, 'incomplete');
  delete known.filaments[0].effectiveMaterialType; known.filaments[0].typeFromFile = 'PETG';
  assert.equal(calculatePrintCost(known).status, 'incomplete');
});

test('template validation bounds every map entry and parameter, rejects slice data and canonicalizes safe decimals', () => {
  const input = template(); input.parameters.machineHourlyRateUah = '.5'; input.parameters.electricityTariffUahPerKwh = '12,50'; input.materialMappings = { ' pla ': 'pla-a' };
  const validated = validateCalculationTemplate(input);
  assert.equal(validated.parameters.machineHourlyRateUah, '0.5'); assert.equal(validated.parameters.electricityTariffUahPerKwh, '12.5');
  assert.deepEqual(validated.materialMappings, { PLA: 'pla-a' }); assert.equal(input.parameters.machineHourlyRateUah, '.5');
  for (const change of [{ name: 'n'.repeat(121) }, { id: '..' }, { version: 0 }, { updatedAt: 'not-a-date' }, { createdAt: '2026-10-08' },
    { materialMappings: { PLA: 'a/b' } }, { materialMappings: { PLA: 123 } }, { materialMappings: { Невідомий: 'pla-a' } },
    { materialMappings: { PLA: 'pla-a', ' pla ': 'other' } }, { materialMappings: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`TYPE${index}`, 'pla-a'])) },
    { job: fixture().job }]) assert.throws(() => validateCalculationTemplate({ ...template(), ...change }));
  for (const parameters of [{ ...template().parameters, job: fixture().job }, { ...template().parameters, filaments: fixture().filaments },
    { ...template().parameters, averagePowerWatts: '-1' }, { ...template().parameters, marginPercent: '100' },
    { ...template().parameters, machineHourlyRateUah: '1.1234567' }, { ...template().parameters, roundingMode: 'nearest' },
    { ...template().parameters, tax: { ...createTaxPreset('fop3', true), unifiedTaxPercent: '5' } }]) assert.throws(() => validateCalculationTemplate({ ...template(), parameters }));
  const missing = template(); delete (missing.parameters as Partial<CalculationTemplate['parameters']>).averagePowerWatts;
  assert.throws(() => validateCalculationTemplate(missing));
  assert.throws(() => normalizeMaterialMappings({ PLA: '.' }));
});

test('applying a template preserves actual file mass, duration, plates and types and copies parameter values independently', () => {
  const current = fixture(); const source = template();
  source.parameters.operatorFeeUah = '80'; source.parameters.tax = createTaxPreset('fop3', true);
  const pla = { ...material('pla-a'), priceVatMode: 'included' as const, vatRatePercent: '20', vatRecoverable: true };
  const applied = applyCalculationTemplate(source, current, [pla], [printer]);
  assert.deepEqual(applied.input.job, current.job); assert.notEqual(applied.input.job, current.job);
  assert.equal(applied.input.filaments[0].weightGrams, '100'); assert.equal(applied.input.filaments[0].typeFromFile, 'PLA');
  assert.equal(applied.input.filaments[0].mappedMaterialId, 'pla-a'); assert.equal(applied.input.filaments[0].mappedMaterialName, pla.name);
  assert.equal(applied.input.filaments[0].pricePerKgUah, '650'); assert.equal(applied.input.filaments[0].vatRecoverable, true);
  assert.equal(applied.input.operatorFeeUah, '80'); assert.equal(applied.warnings.length, 0);
  applied.input.tax!.monthlyEsvUah = '0'; applied.input.job.plates[0].repeatsCount = 5;
  assert.equal(source.parameters.tax.monthlyEsvUah, '1902.34'); assert.equal(current.job.plates[0].repeatsCount, 2);
  assert.equal(CALCULATION_ALGORITHM_VERSION, 'kilog-2026-10-v2');
  const oldTemplate = template(); oldTemplate.materialMappings = {};
  current.tax = createTaxPreset();
  const old = applyCalculationTemplate(oldTemplate, current, [], [printer]);
  assert.equal(old.input.tax, undefined); assert.equal(old.input.filaments[0].pricePerKgUah, '1000');
});

test('deleted printer and stale template/current material mappings require reselection rather than leaving old hidden values', () => {
  const current = fixture(); Object.assign(current.filaments[0], { mappedMaterialId: 'old', mappedMaterialName: 'Old name', priceVatMode: 'included', vatRatePercent: '20', vatRecoverable: true });
  for (const items of [[], [material('pla-a', 'PETG')], [material('pla-a', 'PLA', true)]]) {
    const applied = applyCalculationTemplate(template(), current, items, [printer]);
    assert.equal(applied.input.filaments[0].mappedMaterialId, null); assert.equal(applied.input.filaments[0].pricePerKgUah, null);
    assert.equal(applied.input.filaments[0].mappedMaterialName, undefined); assert.equal(applied.input.filaments[0].vatRecoverable, undefined);
    assert.equal(applied.warnings.length, 1);
  }
  const noMappings = template(); noMappings.materialMappings = {};
  assert.equal(applyCalculationTemplate(noMappings, current, [], [printer]).input.filaments[0].mappedMaterialId, null);
  const missingPrinter = applyCalculationTemplate(template(), fixture(), [material('pla-a')], []);
  assert.equal(missingPrinter.input.selectedPrinterId, null); assert.equal(missingPrinter.input.averagePowerWatts, ''); assert.equal(missingPrinter.input.machineHourlyRateUah, '');
  assert.equal(calculatePrintCost(missingPrinter.input).status, 'incomplete'); assert.ok(missingPrinter.warnings.some(warning => warning.includes('Принтер')));
});
