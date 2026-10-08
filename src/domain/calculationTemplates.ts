import { Decimal } from 'decimal.js';
import { normalizeDecimalInput } from './formatters.ts';
import { clearMaterialMapping, getEffectiveMaterialType, isCompatibleMaterial, isKnownMaterialType, normalizeMaterialType } from './materialMatching.ts';
import { normalizeTaxSettings } from './taxes.ts';
import type { CalculationInput, CalculationTemplate, MaterialProfile, PrinterProfile } from './types.ts';

export const CALCULATION_ALGORITHM_VERSION = 'kilog-2026-10-v2';
export type { CalculationTemplate } from './types.ts';
export const TEMPLATE_PARAMETER_FIELDS = ['selectedPrinterId', 'averagePowerWatts', 'electricityTariffUahPerKwh', 'machineHourlyRateUah',
  'operatorFeeUah', 'packagingFeeUah', 'postProcessingFeeUah', 'otherFeeUah', 'scrapReservePercent', 'pricingMode',
  'markupPercent', 'marginPercent', 'minOrderPriceUah', 'roundingMode'] as const;

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 180 || value.includes('/') || ['.', '..'].includes(value)) throw new Error('Некоректний ідентифікатор у шаблоні.');
  return value;
}
function amount(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalizeDecimalInput(value))) throw new Error('Параметри шаблону мають містити невід’ємні числа.');
  const canonical = new Decimal(normalizeDecimalInput(value)).toFixed();
  if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(canonical)) throw new Error('Число у шаблоні має не більше 12 цифр перед крапкою та 6 після неї.');
  return canonical;
}
export function normalizeMaterialMappings(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 100) throw new Error('Шаблон може містити до 100 відповідностей матеріалів.');
  const normalized: Record<string, string> = {};
  for (const [key, id] of Object.entries(value)) {
    const type = normalizeMaterialType(key);
    if (!isKnownMaterialType(type) || Object.hasOwn(normalized, type)) throw new Error('Відповідності мають містити унікальні визначені типи матеріалів.');
    normalized[type] = identifier(id);
  }
  return normalized;
}
export function extractTemplateParameters(input: CalculationInput): CalculationTemplate['parameters'] {
  const { job: _job, filaments: _filaments, ...parameters } = input;
  return structuredClone(parameters);
}
export function validateCalculationTemplate(value: unknown): CalculationTemplate {
  const keys = ['id', 'name', 'parameters', 'materialMappings', 'version', 'createdAt', 'updatedAt'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      Object.keys(value).some(key => !keys.includes(key))) throw new Error('Некоректна структура шаблону.');
  const template = value as CalculationTemplate;
  const id = identifier(template.id);
  if (typeof template.name !== 'string' || !template.name.trim() || template.name.length > 120) throw new Error('Назва шаблону має містити від 1 до 120 символів.');
  if (!Number.isSafeInteger(template.version) || template.version < 1) throw new Error('Некоректна версія шаблону.');
  for (const key of ['createdAt', 'updatedAt'] as const) {
    if (typeof template[key] !== 'string' || template[key].length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(template[key]) || !Number.isFinite(Date.parse(template[key]))) throw new Error('Некоректна дата шаблону.');
  }
  const parameters = template.parameters;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters) ||
      TEMPLATE_PARAMETER_FIELDS.some(key => !Object.hasOwn(parameters, key)) ||
      Object.keys(parameters).some(key => ![...TEMPLATE_PARAMETER_FIELDS, 'tax'].includes(key as typeof TEMPLATE_PARAMETER_FIELDS[number]))) throw new Error('Шаблон має містити лише параметри розрахунку без даних файлу.');
  const normalized = structuredClone(parameters);
  if (parameters.selectedPrinterId !== null) normalized.selectedPrinterId = identifier(parameters.selectedPrinterId);
  for (const key of TEMPLATE_PARAMETER_FIELDS) {
    if (['selectedPrinterId', 'electricityTariffUahPerKwh', 'pricingMode', 'roundingMode'].includes(key)) continue;
    (normalized as unknown as Record<string, unknown>)[key] = amount(parameters[key]);
  }
  normalized.electricityTariffUahPerKwh = parameters.electricityTariffUahPerKwh === null || parameters.electricityTariffUahPerKwh === '' ? null : amount(parameters.electricityTariffUahPerKwh);
  if (!['markup', 'target_margin'].includes(parameters.pricingMode) || !['none', 'up_1', 'up_5', 'up_10', 'up_50', 'up_100'].includes(parameters.roundingMode) ||
      new Decimal(normalized.marginPercent).gte(100)) throw new Error('Некоректний спосіб ціноутворення або маржа у шаблоні.');
  if (parameters.tax !== undefined) normalized.tax = normalizeTaxSettings(parameters.tax);
  return { ...template, id, name: template.name.trim(), parameters: normalized, materialMappings: normalizeMaterialMappings(template.materialMappings) };
}

export function applyCalculationTemplate(template: CalculationTemplate, current: CalculationInput, materials: MaterialProfile[], printers: PrinterProfile[]): { input: CalculationInput; warnings: string[] } {
  const validated = validateCalculationTemplate(template);
  const input = { ...structuredClone(current), ...structuredClone(validated.parameters) };
  // Absence of tax in an older template restores the original tax-free behavior.
  if (validated.parameters.tax === undefined) delete input.tax;
  const warnings: string[] = [];
  if (input.selectedPrinterId && !printers.some(printer => printer.id === input.selectedPrinterId)) {
    input.selectedPrinterId = null;
    input.averagePowerWatts = '';
    input.machineHourlyRateUah = '';
    warnings.push('Принтер із шаблону видалено. Виберіть принтер повторно.');
  }
  input.filaments = current.filaments.map(filament => {
    const type = getEffectiveMaterialType(filament);
    if (!type) { warnings.push(`Уточніть тип матеріалу для ${filament.plateName}.`); return clearMaterialMapping(structuredClone(filament)); }
    const id = validated.materialMappings[type];
    const currentMaterial = materials.find(material => material.id === filament.mappedMaterialId);
    if (!id) {
      if (filament.mappedMaterialId && !isCompatibleMaterial(currentMaterial, type)) {
        warnings.push(`Матеріал ${type} видалено, архівовано або він змінив тип. Виберіть його повторно.`);
        return clearMaterialMapping(structuredClone(filament));
      }
      return structuredClone(filament);
    }
    const material = materials.find(item => item.id === id);
    if (!isCompatibleMaterial(material, type)) {
      warnings.push(`Відповідність ${type} із шаблону недоступна або має інший тип. Виберіть матеріал повторно.`);
      return clearMaterialMapping(structuredClone(filament));
    }
    const mapped = clearMaterialMapping(structuredClone(filament));
    return { ...mapped, mappedMaterialId: material!.id, mappedMaterialName: material!.name, pricePerKgUah: material!.pricePerKgUah,
      ...(material!.priceVatMode !== undefined ? { priceVatMode: material!.priceVatMode } : {}),
      ...(material!.vatRatePercent !== undefined ? { vatRatePercent: material!.vatRatePercent } : {}),
      ...(material!.vatRecoverable !== undefined ? { vatRecoverable: material!.vatRecoverable } : {}), matchMethod: 'exact_preset' as const };
  });
  return { input, warnings: [...new Set(warnings)] };
}
