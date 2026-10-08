import {
  collection, doc, documentId, getDocFromServer, getDocsFromServer, limit, orderBy, query, startAfter,
  runTransaction, type DocumentData, type DocumentReference, type QueryDocumentSnapshot, type QueryConstraint, type QuerySnapshot,
} from 'firebase/firestore';
import { Decimal } from 'decimal.js';
import { normalizeDecimalInput } from '../domain/formatters.ts';
import type { UserProfile, MaterialProfile, PrinterProfile, CalculationSnapshot, PricingSettings, CalculationTemplate } from '../domain/types.ts';
import { CALCULATION_ALGORITHM_VERSION, validateCalculationTemplate } from '../domain/calculationTemplates.ts';
import { getEffectiveMaterialType, isCompatibleMaterial } from '../domain/materialMatching.ts';
import { INITIAL_MATERIALS, INITIAL_PRINTERS, INITIAL_PRICING_SETTINGS, getInitialCalculationSnapshots } from '../domain/defaultData.ts';
import { PUBLIC_FILAMENTS_CATALOG, MANUFACTURERS_LIST, STANDARD_TEMPERATURE_PROFILES, type PublicFilamentItem, type ManufacturerBrand, type TemperatureProfile } from '../domain/filamentsDirectory.ts';
import { firebaseAuth, firestoreDb } from './firebaseClient.ts';
import { authService } from './authService.ts';
import { fileAnalysisService } from './fileAnalysisService.ts';
import { DEFAULT_TAX_SETTINGS, validateMaterialVat, validateTaxResult, validateTaxSettings } from '../domain/taxes.ts';

export interface ApiResponse<T = unknown> { success: boolean; data?: T; error?: string; statusCode?: number }

export const STORAGE_KEYS = {
  MATERIALS: 'kilog_demo_materials', PRINTERS: 'kilog_demo_printers', CALCULATIONS: 'kilog_demo_calculations',
  SETTINGS: 'kilog_demo_settings', TEMPLATES: 'kilog_demo_templates', PROFILE: 'kilog_demo_profile', CATALOG_FILAMENTS: 'kilog_demo_filaments',
  CATALOG_MANUFACTURERS: 'kilog_demo_manufacturers', CATALOG_TEMPERATURES: 'kilog_demo_temperatures', CATALOG_LIKES: 'kilog_demo_likes',
  SIDEBAR_COLLAPSED: 'kilog_sidebar_collapsed_v1', FILTERS_HIDDEN: 'kilog_filters_hidden_v1',
} as const;

function readDemo<T>(key: string, initial: T): T {
  const stored = localStorage.getItem(key);
  return stored ? JSON.parse(stored) as T : structuredClone(initial);
}
function writeDemo(key: string, value: unknown) { localStorage.setItem(key, JSON.stringify(value)); }
function db() {
  if (!firestoreDb) throw new Error('Firebase не налаштовано. Увійдіть у демо або налаштуйте проєкт.');
  return firestoreDb;
}
function userPath() {
  if (!firebaseAuth?.currentUser) throw new Error('Увійдіть в акаунт, щоб зберігати дані.');
  return `users/${firebaseAuth.currentUser.uid}`;
}
function sessionIdentity() { return authService.isDemoSession() ? 'demo' : firebaseAuth?.currentUser?.uid || ''; }
function requireSameSession(identity: string) {
  if (sessionIdentity() !== identity) throw new Error('Акаунт змінився під час операції. Повторіть дію.');
}
function validId(id: string) {
  if (typeof id !== 'string' || !id.trim() || id.length > 180 || id.includes('/') || id === '.' || id === '..') throw new Error('Некоректний ідентифікатор запису.');
  return id;
}
function clean<T>(value: T): T {
  const json = JSON.stringify(value, (key, item) => {
    const numeric = /(?:Uah(?:PerKwh)?|Percent(?:Actual)?)$/.test(key) || ['averagePowerWatts', 'spoolWeightGrams', 'lifespanHours', 'weightGrams', 'lengthMeters', 'totalWeightGrams', 'totalEnergyKwh', 'monthlyOrders', 'monthlyBillableHours'].includes(key);
    if (!numeric || typeof item !== 'string') return item;
    const normalized = normalizeDecimalInput(item);
    if (normalized === '') return normalized;
    const signed = ['profitUah', 'marginPercent', 'markupPercentActual', 'profitBeforeTaxUah', 'profitAfterTaxUah', 'marginAfterTaxPercent', 'netTaxableIncomeUah'].includes(key);
    if (!(signed ? /^-?(?:\d+(?:\.\d*)?|\.\d+)$/ : /^(?:\d+(?:\.\d*)?|\.\d+)$/).test(normalized)) throw new Error('Введіть коректне десяткове число.');
    const canonical = new Decimal(normalized).toFixed();
    if (!/^-?\d{1,12}(?:\.\d{1,6})?$/.test(canonical)) throw new Error('Число може містити до 12 цифр перед крапкою та до 6 після неї.');
    return canonical;
  });
  if (new TextEncoder().encode(json).length > 700_000) throw new Error('Розрахунок завеликий для збереження (максимум 700 КБ).');
  return JSON.parse(json) as T;
}
async function write(ref: DocumentReference, value: DocumentData | null) {
  // Transactions fail offline; success means the server has accepted the write.
  await runTransaction(db(), async (transaction) => {
    await transaction.get(ref);
    if (value === null) transaction.delete(ref);
    else transaction.set(ref, clean(value));
  });
}
const money = /^\d{1,12}(?:\.\d{1,6})?$/;
function validateSnapshot(snapshot: CalculationSnapshot) {
  const job = snapshot?.input?.job;
  const fail = (): never => { throw new Error('Некоректні дані збереженого розрахунку.'); };
  if (!job || !Array.isArray(job.plates) || !Array.isArray(snapshot.input.filaments)) fail();
  if (job.plates.length > 100 || snapshot.input.filaments.length > 500) fail();
  if (snapshot.input.tax !== undefined) snapshot.input.tax = validateTaxSettings(snapshot.input.tax);
  if (snapshot.result.tax !== undefined) validateTaxResult(snapshot.result.tax);
  if (snapshot.algorithmVersion !== undefined && (typeof snapshot.algorithmVersion !== 'string' || !snapshot.algorithmVersion || snapshot.algorithmVersion.length > 64)) fail();
  if (snapshot.sourceCalculationId !== undefined && snapshot.sourceCalculationId !== null) validId(snapshot.sourceCalculationId);
  for (const plate of job.plates) {
    if (!plate || !Number.isSafeInteger(plate.plateIndex) || typeof plate.plateName !== 'string' || typeof plate.selected !== 'boolean' || !Number.isSafeInteger(plate.repeatsCount) || plate.repeatsCount < 1 || !Number.isFinite(plate.predictionSeconds) || plate.predictionSeconds < 0 || !Number.isFinite(plate.totalWeightGrams) || plate.totalWeightGrams < 0 || !Array.isArray(plate.filaments)) fail();
    for (const filament of plate.filaments) {
      if (!filament || !Number.isSafeInteger(filament.trayId) || typeof filament.type !== 'string' || typeof filament.colorHex !== 'string' || !Number.isFinite(filament.weightGrams) || filament.weightGrams < 0) fail();
    }
  }
  for (const filament of snapshot.input.filaments) {
    validateMaterialVat(filament);
    if (filament.effectiveMaterialType !== undefined && (typeof filament.effectiveMaterialType !== 'string' || !filament.effectiveMaterialType.trim() || filament.effectiveMaterialType.length > 80)) fail();
    if (!filament || !Number.isSafeInteger(filament.plateIndex) || !Number.isSafeInteger(filament.trayId) || typeof filament.key !== 'string' || typeof filament.plateName !== 'string' || typeof filament.typeFromFile !== 'string' || typeof filament.colorHex !== 'string' || typeof filament.weightGrams !== 'string' || !money.test(filament.weightGrams) || !['exact_preset', 'type_match', 'manual', 'unmatched'].includes(filament.matchMethod)) fail();
    for (const key of ['pricePerKgUah', 'costUah', 'lengthMeters'] as const) {
      if (filament[key] !== null && (typeof filament[key] !== 'string' || !money.test(filament[key]!))) fail();
    }
    if (filament.mappedMaterialId !== null && typeof filament.mappedMaterialId !== 'string') fail();
    if (filament.mappedMaterialName !== undefined && typeof filament.mappedMaterialName !== 'string') fail();
  }
}
function validateSettings(settings: PricingSettings) {
  const allowed = [...Object.keys(INITIAL_PRICING_SETTINGS), 'folderAutoImportPath', 'tax', 'defaultTemplateId'];
  if (Object.keys(settings).some((key) => !allowed.includes(key))) throw new Error('Невідомі поля налаштувань.');
  if (settings.tax !== undefined) settings.tax = validateTaxSettings(settings.tax);
  if (settings.defaultTemplateId !== undefined && settings.defaultTemplateId !== null) validId(settings.defaultTemplateId);
  const numeric = ['defaultMarkupPercent', 'defaultMarginPercent', 'scrapReservePercent', 'minOrderPriceUah', 'defaultOperatorFeeUah', 'defaultPackagingFeeUah', 'defaultPostProcessingFeeUah', 'defaultOtherFeeUah'] as const;
  if (numeric.some((key) => typeof settings[key] !== 'string' || !money.test(settings[key])) || (settings.electricityTariffUahPerKwh !== null && !money.test(settings.electricityTariffUahPerKwh))) throw new Error('Тарифи мають бути невід’ємними числами.');
  if (!['markup', 'target_margin'].includes(settings.pricingMode) || !['none', 'up_1', 'up_5', 'up_10', 'up_50', 'up_100'].includes(settings.roundingMode) || !['light', 'dark', 'system'].includes(settings.theme)) throw new Error('Некоректний режим налаштувань.');
  if (Number(settings.defaultMarginPercent) >= 100 || typeof settings.timezone !== 'string' || settings.timezone.length > 100 || (settings.defaultPrinterId !== null && typeof settings.defaultPrinterId !== 'string') || !settings.filamentMappingPresets || typeof settings.filamentMappingPresets !== 'object' || Array.isArray(settings.filamentMappingPresets) || Object.values(settings.filamentMappingPresets).some((id) => typeof id !== 'string' || id.length > 180)) throw new Error('Некоректні налаштування майстерні.');
}

function privateRepository<T extends { id: string; createdAt: string }>(name: string, key: string, initial: () => T[]) {
  function itemsRef() { return collection(db(), `${userPath()}/${name}`); }
  return {
    async getAll(): Promise<T[]> {
      if (authService.isDemoSession()) {
        const items = readDemo(key, initial());
        if (name === 'calculations') items.forEach(item => validateSnapshot(item as unknown as CalculationSnapshot));
        if (name === 'materials') items.forEach(validateMaterialVat);
        return items;
      }
      const scope = itemsRef();
      const items: T[] = [];
      let cursor: QueryDocumentSnapshot | null = null;
      const pageSize = name === 'templates' ? 100 : 200;
      for (;;) {
        const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc'), limit(pageSize), ...(cursor ? [startAfter(cursor)] : [])];
        const result: QuerySnapshot<DocumentData> = await getDocsFromServer(query(scope, ...constraints));
        const page = result.docs.map((snapshot) => ({ ...snapshot.data(), id: snapshot.id }) as T);
        if (name === 'calculations') page.forEach((item) => validateSnapshot(item as unknown as CalculationSnapshot));
        if (name === 'materials') page.forEach(validateMaterialVat);
        items.push(...page);
        if (result.size < pageSize) return items;
        cursor = result.docs.at(-1)!;
      }
    },
    async getById(id: string): Promise<T | null> {
      validId(id);
      if (authService.isDemoSession()) return (await this.getAll()).find((item) => item.id === id) || null;
      const result = await getDocFromServer(doc(itemsRef(), id));
      const value = result.exists() ? { ...result.data(), id: result.id } as T : null;
      if (value && name === 'calculations') validateSnapshot(value as unknown as CalculationSnapshot);
      if (value && name === 'materials') validateMaterialVat(value);
      return value;
    },
    async create(input: Omit<T, 'id' | 'createdAt'>): Promise<T> {
      const value = clean({ ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() }) as T;
      if (name === 'calculations') validateSnapshot(value as unknown as CalculationSnapshot);
      if (name === 'materials') validateMaterialVat(value);
      if (authService.isDemoSession()) { writeDemo(key, [value, ...await this.getAll()]); return value; }
      await write(doc(itemsRef(), value.id), value);
      return value;
    },
    async update(id: string, updates: Partial<T>): Promise<T> {
      validId(id);
      if (name === 'calculations' && Object.keys(updates).some(key => !['title', 'clientName', 'notes'].includes(key))) throw new Error('Збережені параметри й суми незмінні. Створіть новий розрахунок.');
      if (authService.isDemoSession()) {
        const items = await this.getAll();
        const original = items.find((item) => item.id === id);
        if (!original) throw new Error('Запис не знайдено.');
        const merged = { ...original, ...updates, id, createdAt: original.createdAt } as T;
        const updated = name === 'calculations' ? merged : clean(merged);
        if (name === 'calculations') validateCalculationMetadata(updated as unknown as CalculationSnapshot);
        if (name === 'materials') validateMaterialVat(updated);
        writeDemo(key, items.map((item) => item.id === id ? updated : item));
        return updated;
      }
      const ref = doc(itemsRef(), id);
      return runTransaction(db(), async (transaction) => {
        const original = await transaction.get(ref);
        if (!original.exists()) throw new Error('Запис не знайдено.');
        const merged = { ...original.data(), ...updates, id, createdAt: original.data().createdAt } as T;
        const updated = name === 'calculations' ? merged : clean(merged);
        if (name === 'calculations') validateCalculationMetadata(updated as unknown as CalculationSnapshot);
        if (name === 'materials') validateMaterialVat(updated);
        transaction.set(ref, updated);
        return updated;
      });
    },
    async delete(id: string): Promise<void> {
      validId(id);
      if (authService.isDemoSession()) writeDemo(key, (await this.getAll()).filter((item) => item.id !== id));
      else await write(doc(itemsRef(), id), null);
    },
  };
}

function publicRepository<T extends { id: string }>(name: string, key: string, initial: readonly T[]) {
  return {
    async getAll(): Promise<T[]> {
      if (authService.isDemoSession()) return readDemo(key, [...initial]);
      if (!firestoreDb) return structuredClone([...initial]);
      const items = new Map(initial.map((item) => [item.id, structuredClone(item)]));
      let cursor: QueryDocumentSnapshot | null = null;
      for (;;) {
        const page: QuerySnapshot<DocumentData> = await getDocsFromServer(query(collection(db(), name), orderBy(documentId()), limit(200), ...(cursor ? [startAfter(cursor)] : [])));
        page.forEach((snapshot) => {
          if (snapshot.data().deleted) items.delete(snapshot.id);
          else items.set(snapshot.id, { ...snapshot.data(), id: snapshot.id } as T);
        });
        if (page.size < 200) break;
        cursor = page.docs.at(-1)!;
      }
      return [...items.values()];
    },
    async getById(id: string): Promise<T | null> { return (await this.getAll()).find((item) => item.id === id) || null; },
    async create(input: Omit<T, 'id'>): Promise<T> {
      const value = clean({ ...input, id: crypto.randomUUID() }) as T;
      if (authService.isDemoSession()) writeDemo(key, [value, ...await this.getAll()]);
      else await write(doc(db(), name, value.id), value);
      return value;
    },
    async update(id: string, updates: Partial<T>): Promise<T> {
      validId(id);
      const original = await this.getById(id);
      if (!original) throw new Error('Запис не знайдено.');
      const value = clean({ ...original, ...updates, id }) as T;
      if (authService.isDemoSession()) writeDemo(key, (await this.getAll()).map((item) => item.id === id ? value : item));
      else await write(doc(db(), name, id), value);
      return value;
    },
    async delete(id: string): Promise<void> {
      validId(id);
      if (authService.isDemoSession()) writeDemo(key, (await this.getAll()).filter((item) => item.id !== id));
      else await write(doc(db(), name, id), { id, deleted: true });
    },
    async replace(items: T[]): Promise<void> {
      if (authService.isDemoSession()) { writeDemo(key, items); return; }
      const existing = await this.getAll();
      const values = new Map(items.map((item) => [validId(item.id), clean(item)]));
      const changes = items.filter((item) => JSON.stringify(existing.find((old) => old.id === item.id)) !== JSON.stringify(item));
      const deleted = existing.filter((item) => !values.has(item.id));
      if (changes.length + deleted.length > 450) throw new Error('За один раз можна змінити до 450 позицій каталогу.');
      await runTransaction(db(), async (transaction) => {
        const refs = [...changes, ...deleted].map((item) => doc(db(), name, item.id));
        await Promise.all(refs.map((ref) => transaction.get(ref)));
        changes.forEach((item) => transaction.set(doc(db(), name, item.id), clean(item)));
        deleted.forEach((item) => transaction.set(doc(db(), name, item.id), { id: item.id, deleted: true }));
      });
    },
    async reset(): Promise<void> {
      if (authService.isDemoSession()) { localStorage.removeItem(key); return; }
      const overrides = await getDocsFromServer(query(collection(db(), name), limit(451)));
      if (overrides.size > 450) throw new Error('Забагато змін для одночасного скидання.');
      await runTransaction(db(), async (transaction) => {
        await Promise.all(overrides.docs.map((snapshot) => transaction.get(snapshot.ref)));
        overrides.forEach((snapshot) => transaction.delete(snapshot.ref));
      });
    },
  };
}

const filamentCatalog = publicRepository<PublicFilamentItem>('filaments', STORAGE_KEYS.CATALOG_FILAMENTS, PUBLIC_FILAMENTS_CATALOG);
export const filamentsApi = {
  ...filamentCatalog,
  async update(id: string, updates: Partial<PublicFilamentItem>): Promise<PublicFilamentItem> {
    if (updates.inStock === undefined) return filamentCatalog.update(id, updates);
    const original = await filamentCatalog.getById(id);
    if (!original) throw new Error('Філамент не знайдено.');
    return filamentCatalog.update(id, {
      ...updates,
      stores: (updates.stores || original.stores).map((store) => ({ ...store, inStock: updates.inStock! })),
      popularColors: (updates.popularColors || original.popularColors).map((color) => ({ ...color, ...(color.stores ? { stores: color.stores.map((store) => ({ ...store, inStock: updates.inStock! })) } : {}) })),
    });
  },
  async getLikedIds(): Promise<string[]> {
    if (authService.isDemoSession()) return readDemo(STORAGE_KEYS.CATALOG_LIKES, []);
    if (!firebaseAuth?.currentUser) return [];
    const likes = await getDocsFromServer(query(collection(db(), `${userPath()}/likes`), limit(1000)));
    return likes.docs.map((snapshot) => snapshot.id);
  },
  async toggleLike(id: string): Promise<string[]> {
    validId(id);
    if (authService.isDemoSession()) {
      const ids = await this.getLikedIds();
      const updated = ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
      writeDemo(STORAGE_KEYS.CATALOG_LIKES, updated);
      return updated;
    }
    const ref = doc(db(), `${userPath()}/likes`, id);
    await runTransaction(db(), async (transaction) => {
      const current = await transaction.get(ref);
      if (current.exists()) transaction.delete(ref);
      else transaction.set(ref, { filamentId: id });
    });
    return this.getLikedIds();
  },
};
export const manufacturersApi = publicRepository<ManufacturerBrand>('manufacturers', STORAGE_KEYS.CATALOG_MANUFACTURERS, MANUFACTURERS_LIST);
export const temperatureProfilesApi = {
  async getAll(): Promise<Record<string, TemperatureProfile>> {
    if (authService.isDemoSession()) return readDemo(STORAGE_KEYS.CATALOG_TEMPERATURES, STANDARD_TEMPERATURE_PROFILES);
    if (!firestoreDb) return structuredClone(STANDARD_TEMPERATURE_PROFILES);
    const overrides = await getDocsFromServer(query(collection(db(), 'temperatureProfiles'), limit(200)));
    if (overrides.size === 200) throw new Error('Перевищено ліміт температурних профілів.');
    const profiles = structuredClone(STANDARD_TEMPERATURE_PROFILES);
    overrides.forEach((snapshot) => { if (snapshot.data().deleted) delete profiles[snapshot.id]; else profiles[snapshot.id] = snapshot.data() as TemperatureProfile; });
    return profiles;
  },
  async update(type: string, profile: TemperatureProfile): Promise<Record<string, TemperatureProfile>> {
    validId(type);
    const updated = { ...await this.getAll(), [type]: clean(profile) };
    if (authService.isDemoSession()) writeDemo(STORAGE_KEYS.CATALOG_TEMPERATURES, updated);
    else await write(doc(db(), 'temperatureProfiles', type), clean(profile));
    return updated;
  },
  async delete(type: string): Promise<void> {
    validId(type);
    if (authService.isDemoSession()) { const profiles = await this.getAll(); delete profiles[type]; writeDemo(STORAGE_KEYS.CATALOG_TEMPERATURES, profiles); }
    else await write(doc(db(), 'temperatureProfiles', type), { deleted: true });
  },
  async reset(): Promise<Record<string, TemperatureProfile>> {
    if (authService.isDemoSession()) localStorage.removeItem(STORAGE_KEYS.CATALOG_TEMPERATURES);
    else {
      const snapshots = await getDocsFromServer(query(collection(db(), 'temperatureProfiles'), limit(200)));
      await runTransaction(db(), async (transaction) => {
        await Promise.all(snapshots.docs.map((snapshot) => transaction.get(snapshot.ref)));
        snapshots.forEach((snapshot) => transaction.delete(snapshot.ref));
      });
    }
    return structuredClone(STANDARD_TEMPERATURE_PROFILES);
  },
};

export const catalogApi = {
  async reset(): Promise<void> {
    if (authService.isDemoSession()) {
      [STORAGE_KEYS.CATALOG_FILAMENTS, STORAGE_KEYS.CATALOG_MANUFACTURERS, STORAGE_KEYS.CATALOG_TEMPERATURES].forEach((key) => localStorage.removeItem(key));
      return;
    }
    const groups = await Promise.all(['filaments', 'manufacturers', 'temperatureProfiles'].map((name) => getDocsFromServer(query(collection(db(), name), limit(name === 'temperatureProfiles' ? 200 : 1000)))));
    const refs = groups.flatMap((group) => group.docs.map((snapshot) => snapshot.ref));
    if (refs.length > 450) throw new Error('Забагато змін для одночасного скидання каталогу.');
    await runTransaction(db(), async (transaction) => {
      await Promise.all(refs.map((ref) => transaction.get(ref)));
      refs.forEach((ref) => transaction.delete(ref));
    });
  },
  async renamePlasticType(original: string, name: string, family: PublicFilamentItem['family'], density: number, notes: string): Promise<void> {
    validId(original); validId(name);
    const [filaments, temperatures] = await Promise.all([filamentsApi.getAll(), temperatureProfilesApi.getAll()]);
    if (original !== name && temperatures[name]) throw new Error('Тип з такою назвою вже існує.');
    const changed = filaments.filter((item) => item.type.toUpperCase() === original.toUpperCase());
    const profile = temperatures[original] ? { ...temperatures[original], plasticType: name, notes: notes || temperatures[original].notes } : null;
    if (authService.isDemoSession()) {
      writeDemo(STORAGE_KEYS.CATALOG_FILAMENTS, filaments.map((item) => changed.some((old) => old.id === item.id) ? { ...item, type: name, family, densityGPerCm3: density } : item));
      if (profile) { delete temperatures[original]; temperatures[name] = profile; writeDemo(STORAGE_KEYS.CATALOG_TEMPERATURES, temperatures); }
      return;
    }
    if (changed.length > 448) throw new Error('За один раз можна перейменувати тип у 448 позиціях.');
    const refs = changed.map((item) => doc(db(), 'filaments', item.id));
    const oldRef = doc(db(), 'temperatureProfiles', original);
    const newRef = doc(db(), 'temperatureProfiles', name);
    await runTransaction(db(), async (transaction) => {
      const stored = await Promise.all(refs.map((ref) => transaction.get(ref)));
      const [oldProfile, newProfile] = await Promise.all([transaction.get(oldRef), transaction.get(newRef)]);
      if (original !== name && newProfile.exists() && !newProfile.data().deleted) throw new Error('Тип з такою назвою вже існує.');
      changed.forEach((item, index) => {
        const current: DocumentData = stored[index].exists() ? stored[index].data()! : item;
        if (!current.deleted) transaction.set(refs[index], clean({ ...current, id: item.id, type: name, family, densityGPerCm3: density }));
      });
      if (profile) {
        const current = oldProfile.exists() && !oldProfile.data().deleted ? oldProfile.data() as TemperatureProfile : profile;
        transaction.set(newRef, { ...current, plasticType: name, notes: notes || current.notes });
        if (original !== name) transaction.set(oldRef, { deleted: true });
      }
    });
  },
};

const materialData = privateRepository<MaterialProfile>('materials', STORAGE_KEYS.MATERIALS, () => INITIAL_MATERIALS);
export const materialsApi = {
  ...materialData,
  async duplicate(id: string): Promise<MaterialProfile> {
    const identity = sessionIdentity();
    const original = await this.getById(id);
    requireSameSession(identity);
    if (!original) throw new Error('Матеріал не знайдено.');
    const { id: _id, createdAt: _createdAt, ...input } = original;
    return this.create({ ...input, name: `${original.name} (копія)` });
  },
  async archive(id: string): Promise<void> {
    const identity = sessionIdentity();
    const original = await this.getById(id);
    requireSameSession(identity);
    if (!original) throw new Error('Матеріал не знайдено.');
    await this.update(id, { isArchived: !original.isArchived });
  },
};

const printerData = privateRepository<PrinterProfile>('printers', STORAGE_KEYS.PRINTERS, () => INITIAL_PRINTERS);
async function savePrinter(printer: PrinterProfile, isNew: boolean): Promise<PrinterProfile> {
  if (authService.isDemoSession()) {
    const printers = await printerData.getAll();
    const updated = printers.filter((item) => item.id !== printer.id).map((item) => printer.isDefault ? { ...item, isDefault: false } : item);
    writeDemo(STORAGE_KEYS.PRINTERS, [...updated, printer]);
    const settings = readDemo(STORAGE_KEYS.SETTINGS, INITIAL_PRICING_SETTINGS);
    if (printer.isDefault || settings.defaultPrinterId === printer.id) writeDemo(STORAGE_KEYS.SETTINGS, { ...settings, defaultPrinterId: printer.isDefault ? printer.id : null });
    return printer;
  }
  const scope = userPath();
  const settingsRef = doc(db(), `${scope}/settings/pricing`);
  const ref = doc(db(), `${scope}/printers`, printer.id);
  return runTransaction(db(), async (transaction) => {
    const [savedSettings, savedPrinter] = await Promise.all([transaction.get(settingsRef), transaction.get(ref)]);
    if (!isNew && !savedPrinter.exists()) throw new Error('Принтер не знайдено.');
    const settings = savedSettings.exists() ? savedSettings.data() as PricingSettings : { ...INITIAL_PRICING_SETTINGS, electricityTariffUahPerKwh: null, defaultPrinterId: null, filamentMappingPresets: {} };
    const previous = settings.defaultPrinterId && settings.defaultPrinterId !== printer.id ? doc(db(), `${scope}/printers`, validId(settings.defaultPrinterId)) : null;
    const previousPrinter = previous ? await transaction.get(previous) : null;
    const value = clean({ ...savedPrinter.data(), ...printer, id: printer.id, createdAt: savedPrinter.data()?.createdAt || printer.createdAt });
    if (printer.isDefault) {
      if (previous && previousPrinter?.exists()) transaction.update(previous, { isDefault: false });
      transaction.set(settingsRef, { ...settings, defaultPrinterId: printer.id });
    } else if (settings.defaultPrinterId === printer.id) transaction.set(settingsRef, { ...settings, defaultPrinterId: null });
    transaction.set(ref, value);
    return value;
  });
}
export const printersApi = {
  ...printerData,
  async create(input: Omit<PrinterProfile, 'id' | 'createdAt'>): Promise<PrinterProfile> { return savePrinter(clean({ ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() }), true); },
  async update(id: string, updates: Partial<PrinterProfile>): Promise<PrinterProfile> {
    const identity = sessionIdentity();
    const original = await this.getById(id);
    requireSameSession(identity);
    if (!original) throw new Error('Принтер не знайдено.');
    return savePrinter(clean({ ...original, ...updates, id, createdAt: original.createdAt }), false);
  },
  async delete(id: string): Promise<void> {
    validId(id);
    if (authService.isDemoSession()) {
      await printerData.delete(id);
      const settings = readDemo(STORAGE_KEYS.SETTINGS, INITIAL_PRICING_SETTINGS);
      if (settings.defaultPrinterId === id) writeDemo(STORAGE_KEYS.SETTINGS, { ...settings, defaultPrinterId: null });
      return;
    }
    const settingsRef = doc(db(), `${userPath()}/settings/pricing`);
    const ref = doc(db(), `${userPath()}/printers`, id);
    await runTransaction(db(), async (transaction) => {
      const settings = await transaction.get(settingsRef);
      if (settings.exists() && settings.data().defaultPrinterId === id) transaction.update(settingsRef, { defaultPrinterId: null });
      transaction.delete(ref);
    });
  },
  async setDefault(id: string): Promise<void> { await this.update(id, { isDefault: true }); },
};

const calculationData = privateRepository<CalculationSnapshot>('calculations', STORAGE_KEYS.CALCULATIONS, getInitialCalculationSnapshots);
export interface CalculationCursor { createdAt: string; id: string }
export interface CalculationPage { items: CalculationSnapshot[]; cursor: CalculationCursor | null; hasMore: boolean }
function validateCalculationMetadata(value: Pick<CalculationSnapshot, 'title' | 'clientName' | 'notes'>) {
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 300 || (value.clientName !== undefined && (typeof value.clientName !== 'string' || value.clientName.length > 200)) || (value.notes !== undefined && (typeof value.notes !== 'string' || value.notes.length > 10000))) throw new Error('Перевірте назву, клієнта та нотатки розрахунку.');
}
export const calculationsApi = {
  ...calculationData,
  async getPage(cursor: CalculationCursor | null = null): Promise<CalculationPage> {
    const identity = sessionIdentity();
    if (cursor) { validId(cursor.id); if (typeof cursor.createdAt !== 'string' || cursor.createdAt.length > 40) throw new Error('Некоректний курсор історії.'); }
    let items: CalculationSnapshot[];
    if (authService.isDemoSession()) {
      const all = (await calculationData.getAll()).sort((a, b) => a.createdAt === b.createdAt ? (a.id === b.id ? 0 : a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1);
      const after = cursor ? all.filter(item => item.createdAt < cursor.createdAt || item.createdAt === cursor.createdAt && item.id < cursor.id) : all;
      items = after.slice(0, 51);
    } else {
      const page = await getDocsFromServer(query(collection(db(), `${userPath()}/calculations`), orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'), limit(51), ...(cursor ? [startAfter(cursor.createdAt, cursor.id)] : [])));
      requireSameSession(identity);
      items = page.docs.map(value => ({ ...value.data(), id: value.id }) as CalculationSnapshot);
      items.forEach(validateSnapshot);
    }
    const hasMore = items.length > 50;
    items = items.slice(0, 50);
    const last = items.at(-1);
    return { items, cursor: last ? { createdAt: last.createdAt, id: last.id } : null, hasMore };
  },
  async save(snapshot: Omit<CalculationSnapshot, 'id' | 'createdAt'>): Promise<CalculationSnapshot> {
    const identity = sessionIdentity();
    snapshot = clean(snapshot);
    validateSnapshot({ ...snapshot, id: 'pending', createdAt: new Date().toISOString() });
    validateCalculationMetadata(snapshot);
    if (snapshot.sourceCalculationId !== undefined && snapshot.sourceCalculationId !== null) validId(snapshot.sourceCalculationId);
    const algorithmVersion = snapshot.algorithmVersion ?? CALCULATION_ALGORITHM_VERSION;
    if (typeof algorithmVersion !== 'string' || !algorithmVersion || algorithmVersion.length > 64) throw new Error('Некоректна версія алгоритму.');
    const materialIds = [...new Set(snapshot.input.filaments.map(filament => filament.mappedMaterialId).filter((id): id is string => Boolean(id)))];
    if (materialIds.length > 500) throw new Error('Забагато матеріалів у розрахунку.');
    const latestMaterials = await Promise.all(materialIds.map(id => materialData.getById(validId(id))));
    requireSameSession(identity);
    if (snapshot.input.filaments.some(filament => filament.mappedMaterialId && !isCompatibleMaterial(latestMaterials.find(material => material?.id === filament.mappedMaterialId), getEffectiveMaterialType(filament)))) throw new Error('Матеріал видалено, архівовано або він змінив тип. Оновіть сторінку та виберіть матеріали повторно.');
    if (snapshot.input.selectedPrinterId && !await printerData.getById(validId(snapshot.input.selectedPrinterId))) throw new Error('Принтер видалено. Оновіть сторінку та виберіть принтер повторно.');
    requireSameSession(identity);
    return calculationData.create({ ...snapshot, algorithmVersion });
  },
  async updateMetadata(id: string, updates: Pick<Partial<CalculationSnapshot>, 'title' | 'clientName' | 'notes'>): Promise<CalculationSnapshot> {
    const identity = sessionIdentity();
    const original = await this.getById(id);
    requireSameSession(identity);
    if (!original) throw new Error('Розрахунок не знайдено.');
    validateCalculationMetadata({ ...original, ...updates });
    return calculationData.update(id, updates);
  },
  async duplicate(id: string): Promise<CalculationSnapshot> {
    const identity = sessionIdentity();
    const original = await this.getById(id);
    requireSameSession(identity);
    if (!original) throw new Error('Розрахунок не знайдено.');
    const { id: _id, createdAt: _createdAt, ...input } = original;
    return calculationData.create({ ...input, title: `${original.title.slice(0, 291)} (копія)`, algorithmVersion: original.algorithmVersion || 'legacy', sourceCalculationId: original.id });
  },
};

export type TemplateInput = Omit<CalculationTemplate, 'id' | 'createdAt' | 'updatedAt' | 'version'>;
export type TemplateUpdates = Partial<Pick<CalculationTemplate, 'name' | 'parameters' | 'materialMappings'>>;
const templateData = privateRepository<CalculationTemplate>('templates', STORAGE_KEYS.TEMPLATES, () => []);
export const templatesApi = {
  async getAll(): Promise<CalculationTemplate[]> { return (await templateData.getAll()).map(validateCalculationTemplate); },
  async create(input: TemplateInput): Promise<CalculationTemplate> {
    const value = clean({ ...input, updatedAt: new Date().toISOString(), version: 1 });
    const { id: _id, createdAt: _createdAt, ...validated } = validateCalculationTemplate({ ...value, id: 'pending', createdAt: value.updatedAt });
    return templateData.create(validated);
  },
  async update(id: string, expectedVersion: number, updates: TemplateUpdates): Promise<CalculationTemplate> {
    validId(id);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || Object.keys(updates).some(key => !['name', 'parameters', 'materialMappings'].includes(key))) throw new Error('Некоректна зміна шаблону.');
    const update = (original: CalculationTemplate) => {
      if (original.version !== expectedVersion) throw new Error('Шаблон змінився в іншому вікні. Оновіть сторінку.');
      const value = clean({ ...original, ...updates, id, createdAt: original.createdAt, updatedAt: new Date().toISOString(), version: original.version + 1 });
      return validateCalculationTemplate(value);
    };
    if (authService.isDemoSession()) {
      const items = await this.getAll();
      const original = items.find(item => item.id === id);
      if (!original) throw new Error('Шаблон не знайдено.');
      const value = update(original);
      writeDemo(STORAGE_KEYS.TEMPLATES, items.map(item => item.id === id ? value : item));
      return value;
    }
    const identity = sessionIdentity();
    const ref = doc(db(), `${userPath()}/templates`, id);
    return runTransaction(db(), async transaction => {
      const saved = await transaction.get(ref);
      requireSameSession(identity);
      if (!saved.exists()) throw new Error('Шаблон не знайдено.');
      const value = update({ ...saved.data(), id } as CalculationTemplate);
      transaction.set(ref, value);
      return value;
    });
  },
  async delete(id: string, expectedVersion: number): Promise<void> {
    validId(id);
    if (authService.isDemoSession()) {
      const items = await this.getAll();
      const original = items.find(item => item.id === id);
      if (!original) return;
      if (original.version !== expectedVersion) throw new Error('Шаблон змінився в іншому вікні. Оновіть сторінку.');
      writeDemo(STORAGE_KEYS.TEMPLATES, items.filter(item => item.id !== id));
      const settings = readDemo(STORAGE_KEYS.SETTINGS, INITIAL_PRICING_SETTINGS);
      if (settings.defaultTemplateId === id) writeDemo(STORAGE_KEYS.SETTINGS, { ...settings, defaultTemplateId: null });
      return;
    }
    const identity = sessionIdentity();
    const scope = userPath();
    const ref = doc(db(), `${scope}/templates`, id);
    const settingsRef = doc(db(), `${scope}/settings/pricing`);
    await runTransaction(db(), async transaction => {
      const [saved, settings] = await Promise.all([transaction.get(ref), transaction.get(settingsRef)]);
      requireSameSession(identity);
      if (!saved.exists()) return;
      if (saved.data().version !== expectedVersion) throw new Error('Шаблон змінився в іншому вікні. Оновіть сторінку.');
      transaction.delete(ref);
      if (settings.data()?.defaultTemplateId === id) transaction.update(settingsRef, { defaultTemplateId: null });
    });
  },
};

export const settingsApi = {
  async getSettings(): Promise<PricingSettings> {
    if (authService.isDemoSession()) {
      const value = readDemo(STORAGE_KEYS.SETTINGS, INITIAL_PRICING_SETTINGS);
      if (value.tax !== undefined) validateTaxSettings(value.tax);
      return value;
    }
    const settings = await getDocFromServer(doc(db(), `${userPath()}/settings/pricing`));
    const value = settings.exists() ? settings.data() as PricingSettings : { ...structuredClone(INITIAL_PRICING_SETTINGS), electricityTariffUahPerKwh: null, defaultPrinterId: null, filamentMappingPresets: {} };
    if (value.tax !== undefined) validateTaxSettings(value.tax);
    return value;
  },
  async updateSettings(updates: Partial<PricingSettings>): Promise<PricingSettings> {
    const identity = sessionIdentity();
    const current = await this.getSettings();
    requireSameSession(identity);
    const next = clean({ ...current, ...updates });
    validateSettings(next);
    if (authService.isDemoSession()) {
      const printers = await printerData.getAll();
      if (next.defaultPrinterId && !printers.some((printer) => printer.id === next.defaultPrinterId)) throw new Error('Обраний принтер не існує.');
      if (next.defaultTemplateId && !(await templatesApi.getAll()).some(template => template.id === next.defaultTemplateId)) throw new Error('Обраний шаблон не існує.');
      writeDemo(STORAGE_KEYS.SETTINGS, next);
      if (Object.hasOwn(updates, 'defaultPrinterId')) writeDemo(STORAGE_KEYS.PRINTERS, printers.map((printer) => ({ ...printer, isDefault: printer.id === next.defaultPrinterId })));
      return next;
    }
    const scope = userPath();
    const settingsRef = doc(db(), `${scope}/settings/pricing`);
    return runTransaction(db(), async (transaction) => {
      const saved = await transaction.get(settingsRef);
      const value = clean({ ...(saved.exists() ? saved.data() : current), ...updates }) as PricingSettings;
      validateSettings(value);
      const previousId = saved.data()?.defaultPrinterId;
      const previousRef = previousId && previousId !== value.defaultPrinterId ? doc(db(), `${scope}/printers`, validId(previousId)) : null;
      const nextRef = value.defaultPrinterId ? doc(db(), `${scope}/printers`, validId(value.defaultPrinterId)) : null;
      const previous = previousRef ? await transaction.get(previousRef) : null;
      const selected = nextRef ? await transaction.get(nextRef) : null;
      const template = value.defaultTemplateId ? await transaction.get(doc(db(), `${scope}/templates`, validId(value.defaultTemplateId))) : null;
      if (value.defaultTemplateId && !template?.exists()) throw new Error('Обраний шаблон не існує.');
      if (nextRef && !selected?.exists()) throw new Error('Обраний принтер не існує.');
      if (previousRef && previous?.exists()) transaction.update(previousRef, { isDefault: false });
      if (nextRef) transaction.update(nextRef, { isDefault: true });
      transaction.set(settingsRef, value);
      return value;
    });
  },
  async exportConfigJson(): Promise<string> { return JSON.stringify(await this.getSettings(), null, 2); },
  async importConfigJson(jsonString: string): Promise<PricingSettings> {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Очікується JSON-об’єкт налаштувань.');
    return this.updateSettings({ ...INITIAL_PRICING_SETTINGS, tax: { ...DEFAULT_TAX_SETTINGS }, defaultTemplateId: null, ...parsed });
  },
  async resetToDefaults(): Promise<PricingSettings> { return this.updateSettings({ ...INITIAL_PRICING_SETTINGS, tax: { ...DEFAULT_TAX_SETTINGS }, defaultTemplateId: null, defaultPrinterId: null, filamentMappingPresets: {} }); },
};
export const profileApi = {
  async getProfile(): Promise<UserProfile> {
    const profile = await authService.getCurrentUser();
    if (!profile) throw new Error('Увійдіть в акаунт.');
    return profile;
  },
  async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    const current = await this.getProfile();
    return authService.updateProfile({ fullName: updates.fullName ?? current.fullName, workshopName: updates.workshopName ?? current.workshopName });
  },
};

export const authApi = authService;
export const fileAnalysisApi = fileAnalysisService;
export const api = { auth: authApi, analysis: fileAnalysisApi, filaments: filamentsApi, manufacturers: manufacturersApi, temperatures: temperatureProfilesApi, catalog: catalogApi, materials: materialsApi, printers: printersApi, calculations: calculationsApi, templates: templatesApi, settings: settingsApi, profile: profileApi, config: { storageKeys: STORAGE_KEYS } };
export default api;
