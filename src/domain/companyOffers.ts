import { Decimal } from 'decimal.js';
import { STANDARD_TEMPERATURE_PROFILES, type ConcreteFilamentSku, type TemperatureProfile } from './filamentsDirectory.ts';
import type { Company } from './organizations.ts';
import type { CompanyOffer } from './companyOfferValidation.ts';
export * from './companyOfferValidation.ts';

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
