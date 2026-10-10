import { normalizeCompanyOfferInput, OFFER_INPUT_FIELDS, type CompanyOfferInput } from './companyOfferValidation.ts';
import { STANDARD_TEMPERATURE_PROFILES, type TemperatureProfile } from './filamentsDirectory.ts';
import { normalizeMaterialType } from './materialMatching.ts';
import { validateCompany, type Company } from './organizations.ts';

export const IMPORT_LIMITS = {
  items: 100, bytes: 128 * 1024, managerInterval: 3600, adminInterval: 300,
  dailyItems: 2500, dailyJobs: 100, dailyAccessChecks: 1000, dailyQueueMessages: 600, dailyMaintenanceMessages: 300, activeJobs: 100,
  dailyManagerAccessChecks: 500, dailyAdminAccessChecks: 500,
  dailyUnrecognizedUidChecks: 10, dailyManagerUidChecks: 200, dailyAdminUidChecks: 500,
  batchItems: 5, retries: 3, lifetime: 86400, retentionDays: 30,
} as const;
export type ImportStatus = 'queued' | 'processing' | 'completed' | 'partial' | 'failed' | 'cancelled';
export interface ImportOffer { externalId: string; companyId?: string; familyExplicit: boolean; optionalFields: string[]; offer: CompanyOfferInput }
export interface ImportCompany { companyId?: string; name?: string; website: string; allowedDomains?: string[]; status?: Company['status'] }
export interface ImportPayload { companies: ImportCompany[]; offers: ImportOffer[] }
export interface ImportEnvelope { companies: unknown[]; offers: unknown[] }
export interface ImportItemResult { index: number; kind: 'company' | 'offer'; externalId?: string; companyId?: string; offerId?: string; success: boolean; message?: string }
export interface ImportJobSummary {
  id: string; status: ImportStatus; total: number; processed: number; succeeded: number; failed: number;
  createdAt: string; updatedAt: string; results?: ImportItemResult[];
}
export interface ApiKeyMetadata { prefix: string; createdAt: string; expiresAt: string; role: 'admin' | 'manager'; companyId: string | null; requiresRotation: boolean }

function record(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Очікується JSON-об’єкт.');
}
function fields(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('JSON містить невідомі поля.');
}
export function importId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('Некоректний companyId.');
  return value;
}
export function importDomain(url: string): string {
  const domain = new URL(url).hostname;
  validateCompany({ name: domain, website: url, allowedDomains: [domain], status: 'active' });
  return domain;
}
export function profileForImport(type: string, override?: TemperatureProfile | null): TemperatureProfile | undefined {
  return override || STANDARD_TEMPERATURE_PROFILES[normalizeMaterialType(type)];
}
export function validateImportEnvelope(value: unknown): ImportEnvelope {
  record(value); fields(value, ['companies', 'offers']);
  const companyRows = value.companies ?? [];
  const offerRows = value.offers ?? [];
  if (!Array.isArray(companyRows) || !Array.isArray(offerRows) || companyRows.length + offerRows.length < 1 ||
      companyRows.length + offerRows.length > IMPORT_LIMITS.items) throw new Error(`Потрібно від 1 до ${IMPORT_LIMITS.items} записів.`);
  return { companies: companyRows, offers: offerRows };
}
export function normalizeImportPayload(value: unknown): ImportPayload {
  const { companies: companyRows, offers: offerRows } = validateImportEnvelope(value);
  const companies = companyRows.map((row: unknown): ImportCompany => {
    record(row); fields(row, ['companyId', 'name', 'website', 'allowedDomains', 'status']);
    if (typeof row.website !== 'string') throw new Error('Компанія потребує website.');
    const url = new URL(row.website);
    if (url.port || url.username || url.password || !/^https:\/\/[a-z0-9.-]+(?:[/?#]|$)/i.test(row.website)) throw new Error('Некоректний website компанії.');
    const checked = validateCompany({ name: row.name === undefined ? url.hostname : row.name as string,
      website: row.website, allowedDomains: row.allowedDomains === undefined ? [url.hostname] : row.allowedDomains as string[],
      status: (row.status ?? 'active') as Company['status'] });
    if (!checked.allowedDomains.includes(url.hostname)) throw new Error('Домен website має бути серед allowedDomains.');
    return { ...(row.companyId === undefined ? {} : { companyId: importId(row.companyId) }), website: checked.website,
      ...(row.name === undefined ? {} : { name: checked.name }),
      ...(row.allowedDomains === undefined ? {} : { allowedDomains: checked.allowedDomains }),
      ...(row.status === undefined ? {} : { status: checked.status }) };
  });
  const duplicates = new Set<string>();
  const offers = offerRows.map((row: unknown): ImportOffer => {
    record(row); fields(row, [...OFFER_INPUT_FIELDS, 'externalId', 'companyId']);
    if (typeof row.externalId !== 'string' || !row.externalId.trim() || row.externalId.length > 160 || /[\u0000-\u001f\u007f]/.test(row.externalId)) throw new Error('externalId: від 1 до 160 символів.');
    const type = normalizeMaterialType(row.type);
    if (type.includes('/')) throw new Error('Тип пластику не може містити /.');
    const offer = normalizeCompanyOfferInput({ description: '', packagingType: 'spool', diameterMm: 1.75, colorTone: 'special',
      status: 'hidden', ...Object.fromEntries(OFFER_INPUT_FIELDS.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])),
      type, family: row.family ?? profileForImport(type)?.family ?? 'Стандартні' } as CompanyOfferInput);
    offer.status = offer.status === 'blocked' ? 'blocked' : 'hidden';
    const companyId = row.companyId === undefined ? undefined : importId(row.companyId);
    const domain = importDomain(offer.productUrl);
    const identity = JSON.stringify([companyId || domain, row.externalId.trim()]);
    if (duplicates.has(identity)) throw new Error('Повторний externalId у межах компанії в одному JSON.');
    duplicates.add(identity);
    return { externalId: row.externalId.trim(), ...(companyId ? { companyId } : {}), familyExplicit: row.family !== undefined,
      optionalFields: ['description', 'packagingType', 'diameterMm', 'colorTone', 'status'].filter(key => Object.hasOwn(row, key)), offer };
  });
  return { companies, offers };
}

export const IMPORT_EXAMPLE = { offers: [{ externalId: 'pla-white-1000', name: 'PLA White 1 kg', brand: 'Example', type: 'PLA',
  colorName: 'Білий', colorHex: '#ffffff', spoolWeightGrams: 1000, priceUah: 600,
  productUrl: 'https://shop.example.com/pla-white', inStock: true }] };
