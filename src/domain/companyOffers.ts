import { Decimal } from 'decimal.js';
import {
  STANDARD_TEMPERATURE_PROFILES, type ColorTone, type ConcreteFilamentSku,
  type PackagingType, type PublicFilamentItem, type TemperatureProfile,
} from './filamentsDirectory.ts';
import type { AccessState, Company } from './organizations.ts';

export type CompanyOfferStatus = 'published' | 'hidden' | 'blocked';
export const MAX_COMPANY_OFFER_BULK_ITEMS = 100;
export interface CompanyOfferInput {
  name: string; brand: string; type: string; family: PublicFilamentItem['family'];
  colorName: string; colorHex: string; colorTone: ColorTone; packagingType: PackagingType;
  spoolWeightGrams: number; priceUah: number; diameterMm: number; description: string;
  productUrl: string; inStock: boolean; status: CompanyOfferStatus;
}
export interface CompanyOffer extends CompanyOfferInput {
  id: string; companyId: string; createdBy: string; updatedBy: string;
  version: number; createdAt: string; updatedAt: string;
}
export type SaveCompanyOfferInput = CompanyOfferInput & { companyId: string; id?: string; version?: number };
export const OFFER_FAMILIES: PublicFilamentItem['family'][] = ['Стандартні', 'Інженерні', 'Гнучкі', 'Композитні', 'Підтримки'];
export const OFFER_COLOR_TONES: ColorTone[] = ['black', 'white', 'grey', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'multicolor', 'special'];
export const OFFER_STATUSES: CompanyOfferStatus[] = ['published', 'hidden', 'blocked'];
export const OFFER_INPUT_FIELDS = ['name', 'brand', 'type', 'family', 'colorName', 'colorHex', 'colorTone', 'packagingType',
  'spoolWeightGrams', 'priceUah', 'diameterMm', 'description', 'productUrl', 'inStock', 'status'] as const;

function text(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}: не більше ${max} символів.`);
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`${label}: заповніть поле.`);
  return normalized;
}

export function normalizeOfferProductUrl(value: unknown): string {
  const raw = text(value, 'Посилання на товар', 2000);
  const authority = /^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(raw)?.[1];
  // Inspect the input authority before URL removes an explicit default :443 port.
  if (!authority || !/^[a-z0-9.-]+$/i.test(authority) || /[\u0000-\u0020\u007f]/.test(raw)) {
    throw new Error('Посилання має бути HTTPS-адресою без облікових даних і порту.');
  }
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Вкажіть коректне посилання на товар.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 2000) {
    throw new Error('Посилання має бути HTTPS-адресою без облікових даних і порту.');
  }
  return url.href;
}

export function isOfferProductUrlAllowed(productUrl: string, allowedDomains: string[]): boolean {
  try {
    const url = new URL(normalizeOfferProductUrl(productUrl));
    return allowedDomains.includes(url.hostname);
  } catch { return false; }
}

export function normalizeCompanyOfferInput(input: CompanyOfferInput): CompanyOfferInput {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !OFFER_INPUT_FIELDS.includes(key as typeof OFFER_INPUT_FIELDS[number]))) {
    throw new Error('Пропозиція містить невідомі поля.');
  }
  const name = text(input.name, 'Назва товару', 200);
  const brand = text(input.brand, 'Бренд', 200);
  const type = text(input.type, 'Тип пластику', 80);
  const colorName = text(input.colorName, 'Назва кольору', 100);
  const description = text(input.description, 'Опис', 10000, false);
  if (!OFFER_FAMILIES.includes(input.family) || !OFFER_COLOR_TONES.includes(input.colorTone) ||
      !['spool', 'refill'].includes(input.packagingType) || !OFFER_STATUSES.includes(input.status)) {
    throw new Error('Некоректні категорія, колір, фасування або стан пропозиції.');
  }
  if (typeof input.colorHex !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.colorHex)) throw new Error('Колір має формат #RRGGBB.');
  if (!Number.isFinite(input.spoolWeightGrams) || input.spoolWeightGrams < 1 || input.spoolWeightGrams > 100000) {
    throw new Error('Вага котушки має бути від 1 до 100000 грамів.');
  }
  if (!Number.isFinite(input.diameterMm) || input.diameterMm < 0.1 || input.diameterMm > 10) {
    throw new Error('Діаметр має бути від 0.1 до 10 мм.');
  }
  if (!Number.isFinite(input.priceUah) || input.priceUah <= 0 || input.priceUah > 10000000 || new Decimal(input.priceUah).decimalPlaces() > 2) {
    throw new Error('Ціна має бути більшою за нуль, до 10000000 грн, із точністю до копійок.');
  }
  if (typeof input.inStock !== 'boolean') throw new Error('Вкажіть наявність товару.');
  return { name, brand, type, family: input.family, colorName, colorHex: input.colorHex.toLowerCase(), colorTone: input.colorTone,
    packagingType: input.packagingType, spoolWeightGrams: input.spoolWeightGrams, priceUah: input.priceUah,
    diameterMm: input.diameterMm, description, productUrl: normalizeOfferProductUrl(input.productUrl),
    inStock: input.inStock, status: input.status };
}

export function validateCompanyOfferInput(input: CompanyOfferInput, allowedDomains: string[]): CompanyOfferInput {
  const normalized = normalizeCompanyOfferInput(input);
  if (!isOfferProductUrlAllowed(normalized.productUrl, allowedDomains)) throw new Error('Посилання має вести на дозволений домен компанії.');
  return normalized;
}

export function assertCompanyOfferWrite(access: AccessState, company: Pick<Company, 'id' | 'status'>,
  current: Pick<CompanyOffer, 'companyId' | 'version' | 'status'> | null, expectedVersion: number | undefined,
  status: CompanyOfferStatus): void {
  if (access.blocked || access.role === 'user') throw new Error('Потрібні права менеджера або адміністратора.');
  if (access.role === 'manager' && (access.companyId !== company.id || company.status !== 'active')) {
    throw new Error('Менеджер може керувати лише своєю активною компанією.');
  }
  if (status === 'published' && company.status !== 'active') throw new Error('Публікувати можна лише пропозиції активної компанії.');
  if (current && current.companyId !== company.id) throw new Error('Не можна передати пропозицію іншій компанії.');
  if (current && (!Number.isSafeInteger(expectedVersion) || current.version !== expectedVersion)) {
    throw new Error('Пропозицію вже змінили. Оновіть список і повторіть дію.');
  }
  if (access.role === 'manager' && (current?.status === 'blocked' || status === 'blocked')) {
    throw new Error('Блокування пропозиції змінює лише адміністратор.');
  }
}

export function toConcreteCompanyOffer(offer: CompanyOffer, company: Pick<Company, 'id' | 'name'>,
  temperatureProfiles: Record<string, TemperatureProfile> = STANDARD_TEMPERATURE_PROFILES): ConcreteFilamentSku {
  const typeKey = offer.type.trim().toUpperCase();
  const profile = temperatureProfiles[offer.type] || temperatureProfiles[typeKey];
  const price = new Decimal(offer.priceUah);
  const weight = new Decimal(offer.spoolWeightGrams);
  const weightKgDisplay = offer.spoolWeightGrams >= 1000 ? `${weight.div(1000).toFixed(weight.mod(1000).isZero() ? 1 : 2)} кг` : `${weight.toFixed()} г`;
  return { id: `offer:${offer.id}`, parentFilamentId: `offer:${offer.id}`, offerId: offer.id, companyId: company.id, companyName: company.name,
    name: offer.name, brand: offer.brand, manufacturerId: `company-brand:${company.id}:${encodeURIComponent(offer.brand.trim().toLocaleLowerCase('uk'))}`,
    type: offer.type, family: offer.family, spoolWeightGrams: offer.spoolWeightGrams, weightKgDisplay,
    diameterMm: offer.diameterMm, packagingType: offer.packagingType,
    packagingLabel: offer.packagingType === 'refill' ? 'Рефіл (Refill)' : 'З котушкою', inStock: offer.inStock,
    stockStatusLabel: offer.inStock ? 'В наявності' : 'Немає в наявності', colorName: offer.colorName,
    colorHex: offer.colorHex, colorTone: offer.colorTone, colorType: offer.colorTone === 'multicolor' ? 'rainbow' : 'solid',
    isMulticolor: offer.colorTone === 'multicolor', priceUah: offer.priceUah,
    calculatedPricePerKg: price.div(weight).times(1000).toDecimalPlaces(6).toNumber(), pricePerGram: price.div(weight).toNumber(),
    profileNozzle: profile?.nozzleRange || 'Уточніть у виробника', profileBed: profile?.bedRange || 'Уточніть у виробника',
    ...(profile ? { profileChamber: profile.chamberRange, profileFan: profile.fanSpeed, profileNotes: profile.notes } : {}),
    profileIsCustom: false, storeName: company.name, storeUrl: offer.productUrl, description: offer.description };
}
