import { ApiError, decodeFields, type Document } from './firebase.ts';
import type { AnalyticsDatabase } from './analytics.ts';
import { normalizeCompanyOfferInput, normalizeOfferProductUrl, isOfferProductUrlAllowed, OFFER_INPUT_FIELDS } from '../src/domain/companyOfferValidation.ts';
import { PUBLIC_FILAMENTS_CATALOG, STANDARD_TEMPERATURE_PROFILES, buildConcreteFilamentSkus, type ConcreteFilamentSku, type PublicFilamentItem, type TemperatureProfile } from '../src/domain/filamentsDirectory.ts';
import { catalogProductPath, PUBLIC_CATALOG_TEXT_LIMITS, type PublicCatalogProduct } from '../src/domain/catalogSeo.ts';

export const CATALOG_PAGE_SIZE = 20;
export const CATALOG_DAILY_READS = 5000;
export const CATALOG_DAILY_QUERIES = 500;
export const CATALOG_REQUEST_QUERIES = 40;
const pacificDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
const OFFER_FIELDS = ['id', 'companyId', 'updatedAt', ...OFFER_INPUT_FIELDS];
const COMPANY_FIELDS = ['id', 'name', 'status', 'allowedDomains'];
const FILAMENT_FIELDS = ['id', 'deleted', 'updatedAt', 'name', 'brand', 'manufacturerId', 'type', 'family', 'approxPricePerKgUah', 'spoolWeightGrams', 'diameterMm', 'inStock', 'stockStatusLabel', 'printTempNozzle', 'printTempBed', 'chamberTemp', 'coolingFan', 'description', 'badge', 'packagingType', 'primaryColorTone', 'popularColors', 'stores'];
const PROFILE_FIELDS = ['deleted', 'nozzleRange', 'bedRange', 'chamberRange', 'fanSpeed', 'notes'];
export interface CatalogReader { call(suffix: string, body?: unknown): Promise<any>; name(path: string): string }
export interface CatalogPage { products: PublicCatalogProduct[]; nextCursor: string | null }

export function catalogId(value: string, maximum = 180): string {
  if (typeof value !== 'string' || !value || value.length > maximum || value.includes('/') || /[\u0000-\u001f\u007f]/.test(value) || value === '.' || value === '..') throw new ApiError(404, 'Товар не знайдено.');
  return value;
}
const encoder = new TextEncoder();
function compareIds(left: string, right: string): number {
  const a = encoder.encode(left), b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
}
function projectSku(sku: ConcreteFilamentSku, updatedAt?: unknown): PublicCatalogProduct | null {
  if (!Number.isFinite(sku.priceUah) || sku.priceUah <= 0 || sku.priceUah > 10000000 ||
      !Number.isFinite(sku.calculatedPricePerKg) || sku.calculatedPricePerKg <= 0 || sku.calculatedPricePerKg > 10000000000 || !Number.isFinite(sku.spoolWeightGrams) || sku.spoolWeightGrams < 1 || sku.spoolWeightGrams > 100000 ||
      !Number.isFinite(sku.diameterMm) || sku.diameterMm < 0.1 || sku.diameterMm > 10 || typeof sku.inStock !== 'boolean') return null;
  let storeUrl: string, path: string;
  try { storeUrl = normalizeOfferProductUrl(sku.storeUrl); path = catalogProductPath(sku); catalogId(sku.id, PUBLIC_CATALOG_TEXT_LIMITS.id); } catch { return null; }
  const product = { path, id: sku.id, name: sku.name, brand: sku.brand, type: sku.type, colorName: sku.colorName,
    spoolWeightGrams: sku.spoolWeightGrams, diameterMm: sku.diameterMm, packagingLabel: sku.packagingLabel,
    priceUah: sku.priceUah, pricePerKg: sku.calculatedPricePerKg, inStock: sku.inStock, storeName: sku.storeName,
    storeUrl, description: typeof sku.description === 'string' ? sku.description : '',
    profileNozzle: sku.profileNozzle, profileBed: sku.profileBed,
    ...(typeof updatedAt === 'string' && updatedAt.length <= 40 && Number.isFinite(Date.parse(updatedAt)) ? { updatedAt: new Date(updatedAt).toISOString() } : {}) };
  if (!product.name || !product.brand || Object.entries(PUBLIC_CATALOG_TEXT_LIMITS).some(([key, max]) => typeof product[key as keyof typeof product] !== 'string' || (product[key as keyof typeof product] as string).length > max)) return null;
  return product;
}

export function createPublicCatalog(reader: CatalogReader, database: AnalyticsDatabase, now = () => new Date()) {
  let requestQueries = 0;
  async function budget<T>(maximum: number, operation: () => Promise<T>, used: (value: T) => number): Promise<T> {
    // shortcut: large sitemaps need a precomputed manifest before exceeding Free's 50 external subrequests.
    if (++requestQueries > CATALOG_REQUEST_QUERIES) throw new ApiError(503, 'Карта сайту тимчасово недоступна.', 3600);
    const day = pacificDay.format(now());
    const reserved = await database.prepare('INSERT INTO catalog_seo_daily(day,queries,reserved_reads) VALUES(?,1,?) ON CONFLICT(day) DO UPDATE SET queries=queries+1,reserved_reads=reserved_reads+excluded.reserved_reads WHERE queries<? AND reserved_reads<=?-excluded.reserved_reads RETURNING day')
      .bind(day, maximum, CATALOG_DAILY_QUERIES, CATALOG_DAILY_READS).all();
    if (!reserved.results.length) throw new ApiError(503, 'Каталог тимчасово недоступний. Спробуйте пізніше.', 3600);
    const value = await operation();
    const actual = Math.max(1, used(value));
    if (actual > maximum) throw new ApiError(503, 'Некоректна відповідь каталогу.');
    if (actual < maximum) await database.prepare('UPDATE catalog_seo_daily SET reserved_reads=reserved_reads-? WHERE day=?').bind(maximum - actual, day).all();
    return value;
  }
  async function read(collection: string, id: string, fields: string[]): Promise<Document | null> {
    catalogId(id, collection === 'companies' || collection === 'companyOffers' ? 128 : 180);
    const query = new URLSearchParams(fields.map(field => ['mask.fieldPaths', field]));
    const result = await budget(1, () => reader.call('/' + collection + '/' + encodeURIComponent(id) + '?' + query), () => 1);
    if (result === null) return null;
    if (!result || result.name !== reader.name(collection + '/' + id) || (result.fields !== undefined && (!result.fields || typeof result.fields !== 'object' || Array.isArray(result.fields)))) throw new ApiError(503, 'Некоректна відповідь каталогу.');
    return decodeFields(result.fields || {});
  }
  async function list(collection: string, fields: string[], cursor?: string): Promise<{ id: string; data: Document }[]> {
    const maximumId = collection === 'companyOffers' ? 128 : 180;
    if (cursor) catalogId(cursor, maximumId);
    const result = await budget(CATALOG_PAGE_SIZE, () => reader.call(':runQuery', { structuredQuery: {
      from: [{ collectionId: collection }], select: { fields: fields.map(fieldPath => ({ fieldPath })) },
      ...(collection === 'companyOffers' ? { where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'published' } } } } : {}),
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: CATALOG_PAGE_SIZE,
      ...(cursor ? { startAt: { values: [{ referenceValue: reader.name(collection + '/' + cursor) }], before: false } } : {}),
    } }), rows => Array.isArray(rows) ? rows.filter(row => row?.document).length : CATALOG_PAGE_SIZE);
    if (!Array.isArray(result) || result.length > CATALOG_PAGE_SIZE + 1) throw new ApiError(503, 'Некоректна відповідь каталогу.');
    const rows: { id: string; data: Document }[] = [];
    const prefix = reader.name(collection + '/');
    let previous = cursor;
    for (const row of result) {
      if (!row || typeof row !== 'object') throw new ApiError(503, 'Некоректна відповідь каталогу.');
      if (!row.document) {
        if (typeof row.readTime !== 'string' || !Number.isFinite(Date.parse(row.readTime)) || Object.keys(row).some(key => !['readTime', 'skippedResults'].includes(key)) || (row.skippedResults !== undefined && row.skippedResults !== 0)) throw new ApiError(503, 'Некоректна відповідь каталогу.');
        continue;
      }
      const name = row.document.name;
      let id: string;
      try { id = catalogId(typeof name === 'string' && name.startsWith(prefix) ? name.slice(prefix.length) : '', maximumId); }
      catch { throw new ApiError(503, 'Некоректна відповідь каталогу.'); }
      if (name !== reader.name(collection + '/' + id) || (previous !== undefined && compareIds(id, previous) <= 0)
        || (row.document.fields !== undefined && (!row.document.fields || typeof row.document.fields !== 'object' || Array.isArray(row.document.fields)))) throw new ApiError(503, 'Некоректна відповідь каталогу.');
      rows.push({ id, data: decodeFields(row.document.fields || {}) });
      previous = id;
    }
    if (rows.length > CATALOG_PAGE_SIZE) throw new ApiError(503, 'Некоректна відповідь каталогу.');
    return rows;
  }
  async function batchRead(collection: string, ids: string[], fields: string[], maximumId = 180): Promise<Map<string, Document>> {
    if (!ids.length) return new Map();
    const documents = [...new Set(ids)].map(id => reader.name(collection + '/' + catalogId(id, maximumId)));
    const rows = await budget(documents.length, () => reader.call(':batchGet', { documents, mask: { fieldPaths: fields } }), () => documents.length);
    if (!Array.isArray(rows) || rows.length !== documents.length) throw new ApiError(503, 'Некоректна відповідь каталогу.');
    const result = new Map<string, Document>();
    for (const row of rows) {
      const name = row?.found?.name || row?.missing;
      if (!documents.includes(name) || result.has(name) || (row.found && row.missing)
        || (row.found?.fields !== undefined && (!row.found.fields || typeof row.found.fields !== 'object' || Array.isArray(row.found.fields)))) throw new ApiError(503, 'Некоректна відповідь каталогу.');
      result.set(name, row.found ? decodeFields(row.found.fields || {}) : {});
    }
    return new Map([...result].map(([name, data]) => [name.split('/').at(-1)!, data]));
  }
  async function profiles(types: string[]): Promise<Record<string, TemperatureProfile>> {
    const keys = [...new Set(types)].filter(type => { try { catalogId(type); return true; } catch { return false; } });
    const stored = await batchRead('temperatureProfiles', keys, PROFILE_FIELDS);
    const merged = Object.assign(Object.create(null), STANDARD_TEMPERATURE_PROFILES) as Record<string, TemperatureProfile>;
    for (const [type, profile] of stored) {
      if (profile.deleted === true) delete merged[type];
      else if (Object.keys(profile).length) merged[type] = profile as unknown as TemperatureProfile;
    }
    return merged;
  }
  function offerProduct(id: string, data: Document, company: Document | undefined, profiles?: Record<string, TemperatureProfile>): PublicCatalogProduct | null {
    if (data.id !== id || data.status !== 'published' || !company || company.id !== data.companyId || company.status !== 'active' ||
        typeof company.name !== 'string' || !company.name.trim() || company.name.length > 200 || !Array.isArray(company.allowedDomains) || !company.allowedDomains.length || company.allowedDomains.length > 10 || company.allowedDomains.some(domain => typeof domain !== 'string' || domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) || typeof data.productUrl !== 'string' ||
        !isOfferProductUrlAllowed(data.productUrl, company.allowedDomains)) return null;
    try {
      const input = normalizeCompanyOfferInput(Object.fromEntries(OFFER_INPUT_FIELDS.map(field => [field, data[field] ?? (field === 'description' ? '' : undefined)])) as any);
      const temperatures = profiles || STANDARD_TEMPERATURE_PROFILES;
      const profile = temperatures[input.type] || temperatures[input.type.trim().toUpperCase()];
      // Match Decimal's six-place half-up price without initializing the frontend money library in Workers.
      const [whole, fraction = ''] = input.spoolWeightGrams.toString().split('.');
      const grams = BigInt(whole + fraction);
      const numerator = BigInt(Math.round(input.priceUah * 100)) * 10000000n * 10n ** BigInt(fraction.length);
      const pricePerKg = Number((2n * numerator + grams) / (2n * grams)) / 1000000;
      return projectSku({ id: `offer:${id}`, parentFilamentId: `offer:${id}`, offerId: id, name: input.name,
        brand: input.brand, type: input.type, colorName: input.colorName, spoolWeightGrams: input.spoolWeightGrams,
        diameterMm: input.diameterMm, packagingLabel: input.packagingType === 'refill' ? 'Рефіл (Refill)' : 'З котушкою',
        priceUah: input.priceUah, calculatedPricePerKg: pricePerKg, inStock: input.inStock, storeName: company.name,
        storeUrl: input.productUrl, description: input.description, profileNozzle: profile?.nozzleRange || 'Уточніть у виробника',
        profileBed: profile?.bedRange || 'Уточніть у виробника' } as ConcreteFilamentSku, data.updatedAt);
    } catch { return null; }
  }
  function legacyProducts(id: string, data: Document, temperatureProfiles: Record<string, TemperatureProfile>): PublicCatalogProduct[] {
    if (data.deleted === true) return [];
    const validStores = (stores: unknown) => stores === undefined || Array.isArray(stores) && stores.length <= 100;
    if (!validStores(data.stores) || (data.popularColors !== undefined && (!Array.isArray(data.popularColors) || data.popularColors.length > 200
      || data.popularColors.some(color => !color || typeof color !== 'object' || Array.isArray(color) || !validStores(color.stores))))) return [];
    try {
      return buildConcreteFilamentSkus([{ ...data, id } as unknown as PublicFilamentItem]).flatMap(sku => {
        const profile = temperatureProfiles[sku.type];
        const product = projectSku({ ...sku, profileNozzle: (data.printTempNozzle || profile?.nozzleRange || 'Не задано') as string,
          profileBed: (data.printTempBed || profile?.bedRange || 'Не задано') as string }, data.updatedAt);
        return product ? [product] : [];
      });
    }
    catch { return []; }
  }
  return {
    async offers(cursor?: string): Promise<CatalogPage> {
      const rows = await list('companyOffers', OFFER_FIELDS.filter(field => field !== 'description'), cursor);
      const sellerIds = rows.flatMap(row => { try { return [catalogId(row.data.companyId as string, 128)]; } catch { return []; } });
      const sellers = await batchRead('companies', sellerIds, COMPANY_FIELDS, 128);
      const published = rows.filter(row => offerProduct(row.id, row.data, sellers.get(String(row.data.companyId))));
      const temperatures = await profiles(published.flatMap(row => typeof row.data.type === 'string' ? [row.data.type, row.data.type.trim().toUpperCase()] : []));
      return { products: published.flatMap(row => { const product = offerProduct(row.id, row.data, sellers.get(String(row.data.companyId)), temperatures); return product ? [product] : []; }),
        nextCursor: rows.length === CATALOG_PAGE_SIZE ? rows.at(-1)!.id : null };
    },
    async filaments(cursor?: string): Promise<CatalogPage> {
      const rows = await list('filaments', FILAMENT_FIELDS, cursor);
      const upper = rows.length === CATALOG_PAGE_SIZE ? rows.at(-1)!.id : null;
      const merged = new Map(PUBLIC_FILAMENTS_CATALOG.filter(item => (!cursor || compareIds(item.id, cursor) > 0) && (!upper || compareIds(item.id, upper) <= 0)).map(item => [item.id, item as unknown as Document]));
      rows.forEach(row => { if (row.data.deleted === true) merged.delete(row.id); else merged.set(row.id, row.data); });
      const sorted = [...merged].sort(([a], [b]) => compareIds(a, b));
      const selected = sorted.slice(0, CATALOG_PAGE_SIZE);
      const temperatures = await profiles(selected.flatMap(([, data]) => typeof data.type === 'string' ? [data.type] : []));
      const products: PublicCatalogProduct[] = [];
      let consumed = 0;
      for (const [id, data] of selected) {
        const variants = legacyProducts(id, data, temperatures);
        if (products.length && products.length + variants.length > 200) break;
        products.push(...variants);
        consumed++;
      }
      return { products, nextCursor: sorted.length > consumed && consumed ? selected[consumed - 1][0] : upper };
    },
    async product(path: string): Promise<PublicCatalogProduct | null> {
      let parts: string[];
      try { parts = path.split('/').slice(2).map(value => decodeURIComponent(value)); }
      catch { throw new ApiError(404, 'Товар не знайдено.'); }
      if (parts[0] === 'offer' && parts.length === 2) {
        const data = await read('companyOffers', parts[1], OFFER_FIELDS);
        if (!data || data.status !== 'published' || typeof data.companyId !== 'string') return null;
        try { catalogId(data.companyId, 128); } catch { return null; }
        const company = await read('companies', String(data.companyId), COMPANY_FIELDS);
        if (!offerProduct(parts[1], data, company || undefined)) return null;
        const types = typeof data.type === 'string' ? [data.type, data.type.trim().toUpperCase()] : [];
        return offerProduct(parts[1], data, company || undefined, await profiles(types));
      }
      if (parts[0] === 'filament' && parts.length === 3) {
        catalogId(parts[2], PUBLIC_CATALOG_TEXT_LIMITS.id);
        const data = await read('filaments', parts[1], FILAMENT_FIELDS);
        const source = data || PUBLIC_FILAMENTS_CATALOG.find(item => item.id === parts[1]);
        if (!source || data?.deleted === true) return null;
        const temperatures = await profiles(typeof source.type === 'string' ? [source.type] : []);
        return legacyProducts(parts[1], source as unknown as Document, temperatures).find(product => product.id === parts[2]) || null;
      }
      return null;
    },
  };
}
