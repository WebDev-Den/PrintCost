/**
 * Domain types for PrintCost
 * 3D printing cost & pricing estimation platform.
 */

export type RoundingMode = 'none' | 'up_1' | 'up_5' | 'up_10' | 'up_50' | 'up_100';
export type PricingMode = 'markup' | 'target_margin';
export type CalculationStatus = 'complete' | 'incomplete';
export type MachineCostMode = 'manual_rate' | 'depreciation';
export type FilamentMatchMethod = 'exact_preset' | 'type_match' | 'manual' | 'unmatched';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  workshopName: string;
  createdAt: string;
  isDemoUser: boolean;
  emailVerified?: boolean;
  isAdmin?: boolean;
}

export interface MaterialProfile {
  id: string;
  name: string;
  type: string; // e.g. "PETG", "PLA", "ABS", "ASA", "TPU", "PA-CF"
  family: string; // e.g. "Стандартні", "Інженерні", "Гнучкі", "Композитні", "Підтримки"
  brand: string; // e.g. "Bambu Lab", "eSUN", "Devil Design", "Sunlu"
  colorHex?: string;
  colorName?: string;
  pricePerKgUah: string | null; // e.g. "650.00" or null if unconfigured
  spoolWeightGrams?: string; // e.g. "1000"
  spoolPriceUah?: string; // e.g. "650"
  spoolsInStock?: number; // e.g. 1, 2, 3 котушки на складі
  isArchived: boolean;
  createdAt: string;
  notes?: string;
}

export interface PrinterProfile {
  id: string;
  name: string;
  modelId?: string; // e.g. "Bambu Lab X1-Carbon", "Bambu Lab P1S", "A1 mini"
  averagePowerWatts: string; // e.g. "100" (User-defined average printing power)
  costCalculationMode: MachineCostMode;
  machineHourlyRateUah: string; // e.g. "10.00"
  printerPurchasePriceUah?: string | null;
  lifespanHours?: string | null;
  maintenanceHourlyRateUah?: string | null;
  isDefault: boolean;
  createdAt: string;
}

export interface PricingSettings {
  electricityTariffUahPerKwh: string | null; // e.g. "5.00"
  pricingMode: PricingMode;
  defaultMarkupPercent: string; // e.g. "100"
  defaultMarginPercent: string; // e.g. "50"
  scrapReservePercent: string; // e.g. "10"
  minOrderPriceUah: string; // e.g. "200"
  roundingMode: RoundingMode;
  defaultOperatorFeeUah: string; // e.g. "20"
  defaultPackagingFeeUah: string; // e.g. "0"
  defaultPostProcessingFeeUah: string; // e.g. "0"
  defaultOtherFeeUah: string; // e.g. "0"
  defaultPrinterId: string | null;
  filamentMappingPresets: Record<string, string>; // e.g. { "PETG": "mat_petg_bambu" }
  theme: 'light' | 'dark' | 'system';
  timezone: string;
  folderAutoImportPath?: string;
}

export interface ParsedFilamentLayer {
  trayId: number;
  type: string; // e.g. "PETG", "PLA", "PLA-CF"
  colorHex: string;
  colorName?: string;
  weightGrams: number;
  lengthMeters?: number;
}

export interface ParsedPlate {
  plateIndex: number;
  plateName: string;
  predictionSeconds: number; // Duration for this plate in seconds
  totalWeightGrams: number;
  filaments: ParsedFilamentLayer[];
  selected: boolean;
  repeatsCount: number; // default 1 (repeating the sliced plate)
}

export interface ParsedJob {
  fileName: string;
  fileSizeBytes: number;
  slicerSource: string; // e.g. "Bambu Studio 1.9.3.50"
  printerModelName?: string;
  nozzleDiameterMm?: string;
  plates: ParsedPlate[];
  totalPredictionSeconds: number;
  totalWeightGrams: number;
  warnings: string[];
  isDemoJob?: boolean;
  parseStatus: 'empty' | 'reading' | 'success' | 'no_slicing_data' | 'corrupted' | 'file_limit_exceeded' | 'error';
  errorMessage?: string;
}

export interface FilamentUsage {
  key: string; // unique identifier e.g. `plate_0_tray_1`
  plateIndex: number;
  plateName: string;
  trayId: number;
  colorHex: string;
  typeFromFile: string;
  weightGrams: string;
  lengthMeters: string | null;
  mappedMaterialId: string | null;
  mappedMaterialName?: string;
  pricePerKgUah: string | null;
  costUah: string | null;
  matchMethod: FilamentMatchMethod;
}

export interface CalculationInput {
  job: ParsedJob;
  filaments: FilamentUsage[];
  selectedPrinterId: string | null;
  averagePowerWatts: string;
  electricityTariffUahPerKwh: string | null;
  machineHourlyRateUah: string;
  operatorFeeUah: string;
  packagingFeeUah: string;
  postProcessingFeeUah: string;
  otherFeeUah: string;
  scrapReservePercent: string;
  pricingMode: PricingMode;
  markupPercent: string;
  marginPercent: string;
  minOrderPriceUah: string;
  roundingMode: RoundingMode;
}

export interface CalculationResult {
  status: CalculationStatus;
  incompleteReasons: string[];
  totalWeightGrams: string;
  totalDurationSeconds: number;
  totalEnergyKwh: string;
  materialsCostUah: string;
  electricityCostUah: string;
  machineCostUah: string;
  operatorCostUah: string;
  packagingCostUah: string;
  postProcessingCostUah: string;
  otherCostUah: string;
  baseCostSubtotalUah: string;
  scrapReserveUah: string;
  costPriceUah: string; // Собівартість
  preRoundingPriceUah: string;
  minOrderApplied: boolean;
  sellingPriceUah: string; // Продажна ціна клієнту
  profitUah: string; // Розрахунковий прибуток до податків
  marginPercent: string; // Маржинальність %
  markupPercentActual: string; // Фактична націнка %
}

export interface CalculationSnapshot {
  id: string;
  title: string;
  createdAt: string;
  status: CalculationStatus;
  input: CalculationInput;
  result: CalculationResult;
  fileName: string;
  clientName?: string;
  notes?: string;
}

export interface ImportIssue {
  severity: 'warning' | 'error' | 'info';
  code: string;
  message: string;
}
