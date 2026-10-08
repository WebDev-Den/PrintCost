import type { FilamentMatchMethod, FilamentUsage, MaterialProfile } from './types.ts';

const UNKNOWN_TYPES = new Set(['', 'UNKNOWN', 'UNDEFINED', 'NULL', 'NONE', 'N/A', 'NA', 'UNSPECIFIED', 'NOT SPECIFIED',
  'НЕВІДОМО', 'НЕВІДОМИЙ', 'НЕВІДОМА', 'НЕВИЗНАЧЕНО', 'НЕВИЗНАЧЕНИЙ', 'НЕ ВИЗНАЧЕНО', '-', '?']);

export function normalizeMaterialType(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}
export function isKnownMaterialType(value: unknown): boolean {
  const type = normalizeMaterialType(value);
  return type.length <= 80 && !UNKNOWN_TYPES.has(type);
}
export function getEffectiveMaterialType(filament: Pick<FilamentUsage, 'typeFromFile' | 'effectiveMaterialType'>): string {
  if (isKnownMaterialType(filament.typeFromFile)) return normalizeMaterialType(filament.typeFromFile);
  return isKnownMaterialType(filament.effectiveMaterialType) ? normalizeMaterialType(filament.effectiveMaterialType) : '';
}
export function isCompatibleMaterial(material: MaterialProfile | null | undefined, type: unknown): boolean {
  return !!material && material.isArchived === false && isKnownMaterialType(type) && isKnownMaterialType(material.type) &&
    normalizeMaterialType(material.type) === normalizeMaterialType(type);
}
export function findMaterialMatch(type: unknown, materials: MaterialProfile[], presets: Record<string, string> = {}): { material: MaterialProfile | null; method: Exclude<FilamentMatchMethod, 'manual'> } {
  if (!isKnownMaterialType(type)) return { material: null, method: 'unmatched' };
  const normalized = normalizeMaterialType(type);
  const presetId = Object.entries(presets).find(([key]) => normalizeMaterialType(key) === normalized)?.[1];
  const preferred = presetId ? materials.find(material => material.id === presetId) : undefined;
  if (isCompatibleMaterial(preferred, normalized)) return { material: preferred!, method: 'exact_preset' };
  const matched = materials.find(material => isCompatibleMaterial(material, normalized)) || null;
  return { material: matched, method: matched ? 'type_match' : 'unmatched' };
}
export function clearMaterialMapping(filament: FilamentUsage): FilamentUsage {
  const { mappedMaterialName: _name, priceVatMode: _mode, vatRatePercent: _rate, vatRecoverable: _recoverable, ...rest } = filament;
  return { ...rest, mappedMaterialId: null, pricePerKgUah: null, costUah: null, matchMethod: 'unmatched' };
}
