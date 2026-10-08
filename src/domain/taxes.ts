import { Decimal } from 'decimal.js';
import { isValidDecimalString, normalizeDecimalInput } from './formatters.ts';
import type { PricingMode } from './types.ts';

export type TaxRegime = 'fop1' | 'fop2' | 'fop3' | 'general' | 'manual';
export type MaterialPriceVatMode = 'included' | 'excluded' | 'not_applicable';
export interface MaterialVatMetadata {
  priceVatMode?: MaterialPriceVatMode;
  vatRatePercent?: string;
  vatRecoverable?: boolean;
}
export interface TaxSettings {
  enabled: boolean;
  regime: TaxRegime;
  scenario: 'cover' | 'estimate';
  vatPayer: boolean;
  vatRatePercent: string;
  unifiedTaxPercent: string;
  incomeTaxPercent: string;
  militaryTaxPercent: string;
  monthlyUnifiedTaxUah: string;
  monthlyMilitaryTaxUah: string;
  monthlyEsvUah: string;
  monthlyOtherUah: string;
  allocationMode: 'orders' | 'hours';
  monthlyOrders: string;
  monthlyBillableHours: string;
  netTaxableIncomeUah: string | null;
  customerPriceUah: string | null;
  presetVersion: string;
  presetEffectiveDate: string;
}
export interface TaxResult {
  regime: TaxRegime;
  scenario: TaxSettings['scenario'];
  unifiedTaxUah: string;
  militaryTaxUah: string;
  incomeTaxUah: string;
  allocatedUnifiedTaxUah: string;
  allocatedMilitaryTaxUah: string;
  allocatedEsvUah: string;
  allocatedOtherUah: string;
  totalTaxesUah: string;
  totalPaymentsUah: string;
  netRevenueUah: string;
  vatUah: string;
  grossPriceUah: string;
  profitBeforeTaxUah: string;
  profitAfterTaxUah: string;
  marginAfterTaxPercent: string;
  netTaxableIncomeUah: string | null;
  presetVersion: string;
  presetEffectiveDate: string;
  sourceUrls: string[];
}

export const TAX_PRESET_VERSION = 'ua-2026-v1';
export const TAX_PRESET_EFFECTIVE_DATE = '2026-01-01';
export const TAX_PRESET_RESEARCHED_DATE = '2026-10-08';
export const MAX_TAX_MONEY = '999999999999.999999';
export const TAX_SOURCE_URLS = [
  'https://sumy.tax.gov.ua/media-ark/news-ark/print-975635.html',
  'https://mk.tax.gov.ua/media-ark/news-ark/976670.html',
];

export function createTaxPreset(regime: TaxRegime = 'fop3', vatPayer = false): TaxSettings {
  return {
    enabled: true, regime, scenario: 'cover', vatPayer: ['fop1', 'fop2'].includes(regime) ? false : vatPayer,
    vatRatePercent: '20', unifiedTaxPercent: regime === 'fop3' ? (vatPayer ? '3' : '5') : '0',
    incomeTaxPercent: regime === 'general' ? '18' : '0',
    militaryTaxPercent: regime === 'fop3' ? '1' : regime === 'general' ? '5' : '0',
    monthlyUnifiedTaxUah: regime === 'fop1' ? '332.8' : regime === 'fop2' ? '1729.4' : '0',
    monthlyMilitaryTaxUah: ['fop1', 'fop2'].includes(regime) ? '864.7' : '0',
    monthlyEsvUah: '1902.34', monthlyOtherUah: '0', allocationMode: 'orders',
    monthlyOrders: '20', monthlyBillableHours: '160', netTaxableIncomeUah: null, customerPriceUah: null,
    presetVersion: regime === 'manual' ? 'manual' : TAX_PRESET_VERSION, presetEffectiveDate: TAX_PRESET_EFFECTIVE_DATE,
  };
}
export const DEFAULT_TAX_SETTINGS: TaxSettings = { ...createTaxPreset(), enabled: false };
export const TAX_SETTING_FIELDS = Object.keys(DEFAULT_TAX_SETTINGS) as (keyof TaxSettings)[];

function decimal(value: unknown, label: string, max: Decimal.Value, signed = false): Decimal {
  if (typeof value !== 'string') throw new Error(`${label}: введіть число.`);
  const normalized = normalizeDecimalInput(value);
  const pattern = signed ? /^-?(?:\d+(?:\.\d*)?|\.\d+)$/ : /^(?:\d+(?:\.\d*)?|\.\d+)$/;
  if (!pattern.test(normalized)) throw new Error(`${label}: некоректне число.`);
  const number = new Decimal(normalized);
  if (!number.isFinite() || number.abs().gt(max) || number.decimalPlaces() > 6) throw new Error(`${label}: число поза допустимим діапазоном або більше 6 знаків після коми.`);
  return number;
}

export function normalizeTaxSettings(input: TaxSettings): TaxSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !TAX_SETTING_FIELDS.includes(key as keyof TaxSettings))) throw new Error('Податкові параметри містять невідомі поля.');
  if (typeof input.enabled !== 'boolean' || typeof input.vatPayer !== 'boolean' ||
      !['fop1', 'fop2', 'fop3', 'general', 'manual'].includes(input.regime) ||
      !['cover', 'estimate'].includes(input.scenario) || !['orders', 'hours'].includes(input.allocationMode)) throw new Error('Некоректний податковий режим або сценарій.');
  if (typeof input.presetVersion !== 'string' || !input.presetVersion.trim() || input.presetVersion.length > 64 ||
      typeof input.presetEffectiveDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.presetEffectiveDate)) throw new Error('Вкажіть версію й дату податкових параметрів.');
  const normalized = { ...input, presetVersion: input.presetVersion.trim() };
  for (const key of ['vatRatePercent', 'unifiedTaxPercent', 'incomeTaxPercent', 'militaryTaxPercent'] as const) normalized[key] = decimal(input[key], key, 100).toFixed();
  for (const key of ['monthlyUnifiedTaxUah', 'monthlyMilitaryTaxUah', 'monthlyEsvUah', 'monthlyOtherUah'] as const) normalized[key] = decimal(input[key], key, MAX_TAX_MONEY).toFixed();
  const orders = decimal(input.monthlyOrders, 'Кількість замовлень на місяць', 1e9);
  if (!orders.isInteger()) throw new Error('Кількість замовлень має бути цілим числом.');
  normalized.monthlyOrders = orders.toFixed();
  normalized.monthlyBillableHours = decimal(input.monthlyBillableHours, 'Оплачувані години на місяць', 1e9).toFixed();
  normalized.netTaxableIncomeUah = input.netTaxableIncomeUah === null || input.netTaxableIncomeUah === '' ? null : decimal(input.netTaxableIncomeUah, 'Чистий оподатковуваний дохід', MAX_TAX_MONEY, true).toFixed();
  normalized.customerPriceUah = input.customerPriceUah === null || input.customerPriceUah === '' ? null : decimal(input.customerPriceUah, 'Ціна клієнту', MAX_TAX_MONEY).toFixed();
  const nonzero = (...keys: (keyof TaxSettings)[]) => keys.some(key => new Decimal(normalized[key] as string).gt(0));
  if (['fop1', 'fop2'].includes(normalized.regime) && (normalized.vatPayer || nonzero('unifiedTaxPercent', 'incomeTaxPercent', 'militaryTaxPercent'))) {
    throw new Error('Пресет ФОП 1/2 використовує фіксовані платежі без ПДВ; для інших ставок виберіть ручний режим.');
  }
  if (normalized.regime === 'fop3' && (normalized.unifiedTaxPercent !== (normalized.vatPayer ? '3' : '5') || normalized.militaryTaxPercent !== '1' ||
      nonzero('incomeTaxPercent', 'monthlyUnifiedTaxUah', 'monthlyMilitaryTaxUah'))) throw new Error('ФОП 3: ЄП 3% із ПДВ або 5% без ПДВ та ВЗ 1%; інші ставки задайте в ручному режимі.');
  if (normalized.regime === 'general' && (normalized.incomeTaxPercent !== '18' || normalized.militaryTaxPercent !== '5' ||
      nonzero('unifiedTaxPercent', 'monthlyUnifiedTaxUah', 'monthlyMilitaryTaxUah'))) throw new Error('Загальна система: ПДФО 18% та ВЗ 5%; інші ставки задайте в ручному режимі.');
  return normalized;
}
export const validateTaxSettings = normalizeTaxSettings;

export function validateMaterialVat(value: unknown): MaterialVatMetadata {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Матеріал: некоректні параметри ПДВ.');
  const metadata = value as MaterialVatMetadata;
  const result: MaterialVatMetadata = {};
  if (metadata.priceVatMode !== undefined) {
    if (!['included', 'excluded', 'not_applicable'].includes(metadata.priceVatMode)) throw new Error('Матеріал: невідомий спосіб врахування ПДВ.');
    result.priceVatMode = metadata.priceVatMode;
  }
  if (metadata.vatRatePercent !== undefined) result.vatRatePercent = decimal(metadata.vatRatePercent, 'ПДВ матеріалу', 100).toFixed();
  if (metadata.vatRecoverable !== undefined) {
    if (typeof metadata.vatRecoverable !== 'boolean') throw new Error('Матеріал: податковий кредит має бути явною логічною позначкою.');
    result.vatRecoverable = metadata.vatRecoverable;
  }
  if (!result.priceVatMode && (result.vatRatePercent !== undefined || result.vatRecoverable !== undefined)) throw new Error('Матеріал: виберіть спосіб врахування ПДВ.');
  if (['included', 'excluded'].includes(result.priceVatMode || '') && result.vatRatePercent === undefined) throw new Error('Матеріал: вкажіть ставку ПДВ.');
  return result;
}

export const TAX_RESULT_FIELDS: (keyof TaxResult)[] = ['regime', 'scenario', 'unifiedTaxUah', 'militaryTaxUah', 'incomeTaxUah',
  'allocatedUnifiedTaxUah', 'allocatedMilitaryTaxUah', 'allocatedEsvUah', 'allocatedOtherUah', 'totalTaxesUah', 'totalPaymentsUah',
  'netRevenueUah', 'vatUah', 'grossPriceUah', 'profitBeforeTaxUah', 'profitAfterTaxUah', 'marginAfterTaxPercent',
  'netTaxableIncomeUah', 'presetVersion', 'presetEffectiveDate', 'sourceUrls'];
export function validateTaxResult(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== TAX_RESULT_FIELDS.length ||
      Object.keys(value).some(key => !TAX_RESULT_FIELDS.includes(key as keyof TaxResult))) throw new Error('Некоректна структура податкового результату.');
  const result = value as TaxResult;
  if (!['fop1', 'fop2', 'fop3', 'general', 'manual'].includes(result.regime) || !['cover', 'estimate'].includes(result.scenario) ||
      typeof result.presetVersion !== 'string' || !result.presetVersion.trim() || result.presetVersion.length > 64 ||
      typeof result.presetEffectiveDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(result.presetEffectiveDate)) throw new Error('Некоректний режим або версія податкового результату.');
  const signedFields = ['profitBeforeTaxUah', 'profitAfterTaxUah', 'marginAfterTaxPercent'];
  for (const key of TAX_RESULT_FIELDS) {
    if (key.endsWith('Uah') || key === 'marginAfterTaxPercent') {
      if (key === 'netTaxableIncomeUah' && result[key] === null) continue;
      const signed = signedFields.includes(key);
      if (typeof result[key] !== 'string' || !(signed ? /^-?\d{1,12}(?:\.\d{1,6})?$/ : /^\d{1,12}(?:\.\d{1,6})?$/).test(result[key] as string)) {
        throw new Error('Некоректне число податкового результату.');
      }
      decimal(result[key], key, MAX_TAX_MONEY, signed);
    }
  }
  if (!Array.isArray(result.sourceUrls) || result.sourceUrls.length > 2 ||
      result.sourceUrls.some(url => typeof url !== 'string' || !TAX_SOURCE_URLS.includes(url))) throw new Error('Некоректні джерела податкового пресета.');
}

/** Recovery is explicit; VAT payer status alone never removes VAT from material costs. */
export function materialPriceForCost(price: Decimal, material: MaterialVatMetadata, tax: TaxSettings | undefined, reasons: string[]): Decimal {
  let metadata: MaterialVatMetadata;
  try { metadata = validateMaterialVat(material); }
  catch (error) { reasons.push(error instanceof Error ? error.message : 'Матеріал: некоректна ставка ПДВ.'); return price; }
  const mode = metadata.priceVatMode;
  if (mode === undefined || mode === 'not_applicable') return price;
  const rate = new Decimal(metadata.vatRatePercent!).div(100);
  const recoverable = tax?.enabled === true && tax.vatPayer && metadata.vatRecoverable === true;
  const factor = new Decimal(1).plus(rate);
  return mode === 'included' ? (recoverable ? price.div(factor) : price) : (recoverable ? price : price.mul(factor));
}

interface TaxPricingInput {
  settings: TaxSettings;
  cost: Decimal;
  durationHours: Decimal;
  pricingMode: PricingMode;
  markupPercent: string;
  marginPercent: string;
  minimumGross: string;
  roundGross: (value: Decimal) => Decimal;
  reasons: string[];
}
export function calculateTaxPrice(input: TaxPricingInput): { preRoundingPrice: Decimal; finalPrice: Decimal; minOrderApplied: boolean; tax?: TaxResult } {
  const { settings: tax, cost, durationHours, reasons } = input;
  const cents = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const monthly = ['monthlyUnifiedTaxUah', 'monthlyMilitaryTaxUah', 'monthlyEsvUah', 'monthlyOtherUah'].map(key => new Decimal(tax[key as keyof TaxSettings] as string));
  const monthlyTotal = monthly.reduce((sum, value) => sum.plus(value), new Decimal(0));
  const denominator = new Decimal(tax.allocationMode === 'orders' ? tax.monthlyOrders : tax.monthlyBillableHours);
  let allocationFactor = new Decimal(0);
  if (monthlyTotal.gt(0)) {
    if (denominator.lte(0)) reasons.push('Для розподілу щомісячних платежів задайте додатну кількість замовлень або годин.');
    else allocationFactor = (tax.allocationMode === 'orders' ? new Decimal(1) : durationHours).div(denominator);
  }
  const [allocatedUnified, allocatedMilitary, allocatedEsv, allocatedOther] = monthly.map(value => cents(value.mul(allocationFactor)));
  const incomeRate = new Decimal(tax.incomeTaxPercent).div(100);
  const militaryRate = new Decimal(tax.militaryTaxPercent).div(100);
  const unifiedRate = new Decimal(tax.unifiedTaxPercent).div(100);
  const militaryOnRevenue = tax.regime === 'fop3';
  const baseRequired = incomeRate.gt(0) || (!militaryOnRevenue && militaryRate.gt(0));
  const taxableBase: Decimal | null = tax.netTaxableIncomeUah === null ? null : Decimal.max(0, new Decimal(tax.netTaxableIncomeUah));
  if (baseRequired && taxableBase === null) reasons.push('Вкажіть чистий оподатковуваний дохід окремо; виробнича собівартість не є податковою базою.');
  const income = cents((taxableBase || new Decimal(0)).mul(incomeRate));
  const baseMilitary = cents((taxableBase || new Decimal(0)).mul(militaryOnRevenue ? 0 : militaryRate));
  const knownPayments = allocatedUnified.plus(allocatedMilitary).plus(allocatedEsv).plus(allocatedOther).plus(income).plus(baseMilitary);
  const revenueRate = unifiedRate.plus(militaryOnRevenue ? militaryRate : 0);
  const vatFactor = new Decimal(1).plus(tax.vatPayer ? new Decimal(tax.vatRatePercent).div(100) : 0);
  let preRoundingPrice = new Decimal(0);
  let finalPrice = new Decimal(0);
  let minOrderApplied = false;
  const pricingNumber = (value: string, label: string): Decimal => {
    if (!isValidDecimalString(value)) { reasons.push(`${label}: введіть невід’ємне число.`); return new Decimal(0); }
    return new Decimal(normalizeDecimalInput(value));
  };
  if (tax.scenario === 'estimate') {
    if (tax.customerPriceUah === null) reasons.push('Для оцінки податків вкажіть остаточну ціну клієнту з ПДВ, якщо він застосовується.');
    else finalPrice = cents(new Decimal(tax.customerPriceUah));
    preRoundingPrice = finalPrice;
  } else {
    let divisor = new Decimal(1).minus(revenueRate);
    let numerator = cost.plus(knownPayments);
    if (input.pricingMode === 'target_margin') divisor = divisor.minus(pricingNumber(input.marginPercent, 'Маржа').div(100));
    else if (input.pricingMode === 'markup') numerator = numerator.plus(cost.mul(pricingNumber(input.markupPercent, 'Націнка').div(100)));
    else reasons.push('Невідомий спосіб ціноутворення.');
    if (divisor.lte(0)) reasons.push('Податки від виручки та цільова маржа не залишають коштів для покриття витрат.');
    else preRoundingPrice = numerator.div(divisor).mul(vatFactor);
    const minimum = pricingNumber(input.minimumGross || '0', 'Мінімальна ціна');
    minOrderApplied = preRoundingPrice.lt(minimum);
    finalPrice = input.roundGross(Decimal.max(preRoundingPrice, minimum));
  }
  if (!finalPrice.isFinite() || finalPrice.gt(MAX_TAX_MONEY) || finalPrice.lt(0)) { reasons.push('Ціна перевищує допустимий діапазон.'); finalPrice = new Decimal(0); }
  if (!preRoundingPrice.isFinite() || preRoundingPrice.gt(MAX_TAX_MONEY)) preRoundingPrice = new Decimal(0);
  const net = cents(finalPrice.div(vatFactor));
  const vat = finalPrice.minus(net);
  const unified = cents(net.mul(unifiedRate)).plus(allocatedUnified);
  const military = cents(net.mul(militaryOnRevenue ? militaryRate : 0)).plus(baseMilitary).plus(allocatedMilitary);
  const totalTaxes = unified.plus(military).plus(income);
  const totalPayments = totalTaxes.plus(allocatedEsv).plus(allocatedOther);
  const profitBefore = net.minus(cents(cost));
  const profitAfter = profitBefore.minus(totalPayments);
  const marginAfter = net.gt(0) ? profitAfter.div(net).mul(100) : new Decimal(0);
  const result: TaxResult = {
    regime: tax.regime, scenario: tax.scenario, unifiedTaxUah: unified.toFixed(2), militaryTaxUah: military.toFixed(2), incomeTaxUah: income.toFixed(2),
    allocatedUnifiedTaxUah: allocatedUnified.toFixed(2), allocatedMilitaryTaxUah: allocatedMilitary.toFixed(2), allocatedEsvUah: allocatedEsv.toFixed(2),
    allocatedOtherUah: allocatedOther.toFixed(2), totalTaxesUah: totalTaxes.toFixed(2), totalPaymentsUah: totalPayments.toFixed(2),
    netRevenueUah: net.toFixed(2), vatUah: vat.toFixed(2), grossPriceUah: finalPrice.toFixed(2), profitBeforeTaxUah: profitBefore.toFixed(2),
    profitAfterTaxUah: profitAfter.toFixed(2), marginAfterTaxPercent: marginAfter.toFixed(2), netTaxableIncomeUah: taxableBase?.toFixed() ?? null,
    presetVersion: tax.presetVersion, presetEffectiveDate: tax.presetEffectiveDate, sourceUrls: tax.regime === 'manual' ? [] : [...TAX_SOURCE_URLS],
  };
  try { validateTaxResult(result); }
  catch { reasons.push('Розраховані податки, платежі або маржа перевищують допустимий діапазон.'); return { preRoundingPrice, finalPrice, minOrderApplied }; }
  return { preRoundingPrice, finalPrice, minOrderApplied, tax: result };
}
