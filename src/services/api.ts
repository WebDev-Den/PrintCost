import type {
  UserProfile,
  MaterialProfile,
  PrinterProfile,
  CalculationSnapshot,
  PricingSettings,
  ParsedJob,
} from '../domain/types.ts';
import {
  INITIAL_USER_PROFILE,
  INITIAL_MATERIALS,
  INITIAL_PRINTERS,
  INITIAL_PRICING_SETTINGS,
  getInitialCalculationSnapshots,
  DEMO_JOB_SECTION_9,
} from '../domain/defaultData.ts';
import {
  PUBLIC_FILAMENTS_CATALOG,
  MANUFACTURERS_LIST,
  STANDARD_TEMPERATURE_PROFILES,
  PublicFilamentItem,
  ManufacturerBrand,
  TemperatureProfile,
} from '../domain/filamentsDirectory.ts';

/**
 * Global Configuration for API Client
 */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || '/api';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

/**
 * Storage Keys for Client Persistence & Offline Fallback
 */
export const STORAGE_KEYS = {
  AUTH_USER: 'printcost_auth_user',
  AUTH_TOKEN: 'printcost_auth_token',
  IS_DEMO: 'printcost_is_demo_mode',
  MATERIALS: 'printcost_materials',
  PRINTERS: 'printcost_printers',
  CALCULATIONS: 'printcost_saved_calculations',
  SETTINGS: 'printcost_pricing_settings',
  PROFILE: 'printcost_user_profile',
  CATALOG_FILAMENTS: 'kilog_catalog_filaments_v4',
  CATALOG_MANUFACTURERS: 'kilog_catalog_manufacturers_v4',
  CATALOG_TEMPERATURES: 'kilog_catalog_temperatures_v4',
  CATALOG_LIKES: 'kilog_catalog_likes_v1',
  SIDEBAR_COLLAPSED: 'kilog_sidebar_collapsed_v1',
  FILTERS_HIDDEN: 'kilog_filters_hidden_v1',
} as const;

/**
 * Core HTTP Request Wrapper
 * Handles headers, authorization, timeouts, JSON parsing, and unified error handling.
 */
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ data: T | null; error: Error | null; isServerAvailable: boolean }> {
  const url = `${API_BASE_URL.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;
  const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      signal: options.signal || controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Network error');
      return {
        data: null,
        error: new Error(`HTTP ${res.status}: ${errText}`),
        isServerAvailable: true,
      };
    }

    const json = (await res.json().catch(() => null)) as T;
    return { data: json, error: null, isServerAvailable: true };
  } catch (err: any) {
    clearTimeout(timeoutId);
    // Server is unreachable, network error, or 404 in client-only SPA
    return { data: null, error: err, isServerAvailable: false };
  }
}

/**
 * Helper to safely read from LocalStorage
 */
function readStorage<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key);
    if (!item) return defaultValue;
    return JSON.parse(item) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Helper to safely write to LocalStorage
 */
function writeStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[API Client] Failed writing to storage (${key}):`, err);
  }
}

// ============================================================================
// 1. AUTH API MODULE
// ============================================================================
export const authApi = {
  async getCurrentUser(): Promise<UserProfile | null> {
    const { data, isServerAvailable } = await request<UserProfile>('auth/me');
    if (isServerAvailable && data) return data;
    return readStorage<UserProfile | null>(STORAGE_KEYS.AUTH_USER, INITIAL_USER_PROFILE);
  },

  async login(email: string, _password: string): Promise<UserProfile> {
    const { data, isServerAvailable } = await request<UserProfile>('auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: _password }),
    });

    if (isServerAvailable && data) {
      writeStorage(STORAGE_KEYS.AUTH_USER, data);
      localStorage.setItem(STORAGE_KEYS.IS_DEMO, 'false');
      return data;
    }

    const fallbackUser: UserProfile = {
      ...INITIAL_USER_PROFILE,
      id: 'usr_' + Math.random().toString(36).substring(2, 9),
      email: email.trim().toLowerCase(),
      isDemoUser: false,
    };
    writeStorage(STORAGE_KEYS.AUTH_USER, fallbackUser);
    localStorage.setItem(STORAGE_KEYS.IS_DEMO, 'false');
    return fallbackUser;
  },

  async register(email: string, _password: string): Promise<UserProfile> {
    const { data, isServerAvailable } = await request<UserProfile>('auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password: _password }),
    });

    if (isServerAvailable && data) {
      writeStorage(STORAGE_KEYS.AUTH_USER, data);
      localStorage.setItem(STORAGE_KEYS.IS_DEMO, 'false');
      return data;
    }

    const fallbackUser: UserProfile = {
      id: 'usr_' + Math.random().toString(36).substring(2, 9),
      email: email.trim().toLowerCase(),
      fullName: email.split('@')[0],
      workshopName: 'Моя 3D Майстерня',
      createdAt: new Date().toISOString(),
      isDemoUser: false,
    };
    writeStorage(STORAGE_KEYS.AUTH_USER, fallbackUser);
    localStorage.setItem(STORAGE_KEYS.IS_DEMO, 'false');
    return fallbackUser;
  },

  async logout(): Promise<void> {
    await request('auth/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem(STORAGE_KEYS.AUTH_USER);
    localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    localStorage.setItem(STORAGE_KEYS.IS_DEMO, 'false');
  },

  async forgotPassword(email: string): Promise<void> {
    await request('auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async resetPassword(password: string): Promise<void> {
    await request('auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },

  isDemoSession(): boolean {
    return localStorage.getItem(STORAGE_KEYS.IS_DEMO) === 'true';
  },

  async enableDemoSession(): Promise<UserProfile> {
    writeStorage(STORAGE_KEYS.AUTH_USER, INITIAL_USER_PROFILE);
    localStorage.setItem(STORAGE_KEYS.IS_DEMO, 'true');
    return INITIAL_USER_PROFILE;
  },
};

// ============================================================================
// 2. FILAMENTS CATALOG API MODULE
// ============================================================================
export const filamentsApi = {
  async getAll(): Promise<PublicFilamentItem[]> {
    const { data, isServerAvailable } = await request<PublicFilamentItem[]>('filaments');
    if (isServerAvailable && Array.isArray(data)) {
      writeStorage(STORAGE_KEYS.CATALOG_FILAMENTS, data);
      return data;
    }
    return readStorage<PublicFilamentItem[]>(STORAGE_KEYS.CATALOG_FILAMENTS, [...PUBLIC_FILAMENTS_CATALOG]);
  },

  async getById(id: string): Promise<PublicFilamentItem | null> {
    const { data, isServerAvailable } = await request<PublicFilamentItem>(`filaments/${id}`);
    if (isServerAvailable && data) return data;
    const list = await this.getAll();
    return list.find((item) => item.id === id) || null;
  },

  async create(item: Omit<PublicFilamentItem, 'id'>): Promise<PublicFilamentItem> {
    const { data, isServerAvailable } = await request<PublicFilamentItem>('filaments', {
      method: 'POST',
      body: JSON.stringify(item),
    });

    if (isServerAvailable && data) {
      const all = await this.getAll();
      writeStorage(STORAGE_KEYS.CATALOG_FILAMENTS, [data, ...all]);
      return data;
    }

    const list = await this.getAll();
    const id = `fil-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newItem: PublicFilamentItem = { ...item, id };
    const updated = [newItem, ...list];
    writeStorage(STORAGE_KEYS.CATALOG_FILAMENTS, updated);
    return newItem;
  },

  async update(id: string, updates: Partial<PublicFilamentItem>): Promise<PublicFilamentItem> {
    const { data, isServerAvailable } = await request<PublicFilamentItem>(`filaments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });

    if (isServerAvailable && data) {
      const list = await this.getAll();
      const updated = list.map((f) => (f.id === id ? data : f));
      writeStorage(STORAGE_KEYS.CATALOG_FILAMENTS, updated);
      return data;
    }

    const list = await this.getAll();
    const index = list.findIndex((f) => f.id === id);
    if (index === -1) throw new Error('Філамент не знайдено');
    const updatedItem = { ...list[index], ...updates };
    list[index] = updatedItem;
    writeStorage(STORAGE_KEYS.CATALOG_FILAMENTS, list);
    return updatedItem;
  },

  async delete(id: string): Promise<void> {
    await request(`filaments/${id}`, { method: 'DELETE' });
    const list = await this.getAll();
    const filtered = list.filter((f) => f.id !== id);
    writeStorage(STORAGE_KEYS.CATALOG_FILAMENTS, filtered);
  },

  async getLikedIds(): Promise<string[]> {
    const { data, isServerAvailable } = await request<string[]>('filaments/likes');
    if (isServerAvailable && Array.isArray(data)) {
      writeStorage(STORAGE_KEYS.CATALOG_LIKES, data);
      return data;
    }
    return readStorage<string[]>(STORAGE_KEYS.CATALOG_LIKES, []);
  },

  async toggleLike(id: string): Promise<string[]> {
    const current = await this.getLikedIds();
    const exists = current.includes(id);
    const updated = exists ? current.filter((x) => x !== id) : [...current, id];

    await request(`filaments/${id}/like`, {
      method: 'POST',
      body: JSON.stringify({ liked: !exists }),
    }).catch(() => {});

    writeStorage(STORAGE_KEYS.CATALOG_LIKES, updated);
    return updated;
  },
};

// ============================================================================
// 3. MANUFACTURERS API MODULE
// ============================================================================
export const manufacturersApi = {
  async getAll(): Promise<ManufacturerBrand[]> {
    const { data, isServerAvailable } = await request<ManufacturerBrand[]>('manufacturers');
    if (isServerAvailable && Array.isArray(data)) {
      writeStorage(STORAGE_KEYS.CATALOG_MANUFACTURERS, data);
      return data;
    }
    return readStorage<ManufacturerBrand[]>(STORAGE_KEYS.CATALOG_MANUFACTURERS, [...MANUFACTURERS_LIST]);
  },

  async getById(id: string): Promise<ManufacturerBrand | null> {
    const list = await this.getAll();
    return list.find((m) => m.id === id) || null;
  },

  async create(mfg: Omit<ManufacturerBrand, 'id'>): Promise<ManufacturerBrand> {
    const { data, isServerAvailable } = await request<ManufacturerBrand>('manufacturers', {
      method: 'POST',
      body: JSON.stringify(mfg),
    });

    if (isServerAvailable && data) {
      const list = await this.getAll();
      writeStorage(STORAGE_KEYS.CATALOG_MANUFACTURERS, [data, ...list]);
      return data;
    }

    const list = await this.getAll();
    const id = `mfg-${mfg.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;
    const newMfg: ManufacturerBrand = { ...mfg, id };
    const updated = [newMfg, ...list];
    writeStorage(STORAGE_KEYS.CATALOG_MANUFACTURERS, updated);
    return newMfg;
  },

  async update(id: string, updates: Partial<ManufacturerBrand>): Promise<ManufacturerBrand> {
    const { data, isServerAvailable } = await request<ManufacturerBrand>(`manufacturers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });

    if (isServerAvailable && data) {
      const list = await this.getAll();
      const updated = list.map((m) => (m.id === id ? data : m));
      writeStorage(STORAGE_KEYS.CATALOG_MANUFACTURERS, updated);
      return data;
    }

    const list = await this.getAll();
    const idx = list.findIndex((m) => m.id === id);
    if (idx === -1) throw new Error('Виробника не знайдено');
    const updatedMfg = { ...list[idx], ...updates };
    list[idx] = updatedMfg;
    writeStorage(STORAGE_KEYS.CATALOG_MANUFACTURERS, list);
    return updatedMfg;
  },

  async delete(id: string): Promise<void> {
    await request(`manufacturers/${id}`, { method: 'DELETE' });
    const list = await this.getAll();
    writeStorage(STORAGE_KEYS.CATALOG_MANUFACTURERS, list.filter((m) => m.id !== id));
  },
};

// ============================================================================
// 4. TEMPERATURE PROFILES API MODULE
// ============================================================================
export const temperatureProfilesApi = {
  async getAll(): Promise<Record<string, TemperatureProfile>> {
    const { data, isServerAvailable } = await request<Record<string, TemperatureProfile>>('temperatures');
    if (isServerAvailable && data) {
      writeStorage(STORAGE_KEYS.CATALOG_TEMPERATURES, data);
      return data;
    }
    return readStorage<Record<string, TemperatureProfile>>(
      STORAGE_KEYS.CATALOG_TEMPERATURES,
      STANDARD_TEMPERATURE_PROFILES
    );
  },

  async update(type: string, profile: TemperatureProfile): Promise<Record<string, TemperatureProfile>> {
    const current = await this.getAll();
    const updated = { ...current, [type]: profile };
    await request(`temperatures/${type}`, {
      method: 'PUT',
      body: JSON.stringify(profile),
    }).catch(() => {});
    writeStorage(STORAGE_KEYS.CATALOG_TEMPERATURES, updated);
    return updated;
  },

  async reset(): Promise<Record<string, TemperatureProfile>> {
    writeStorage(STORAGE_KEYS.CATALOG_TEMPERATURES, STANDARD_TEMPERATURE_PROFILES);
    return STANDARD_TEMPERATURE_PROFILES;
  },
};

// ============================================================================
// 5. USER MATERIALS API MODULE
// ============================================================================
export const materialsApi = {
  async getAll(): Promise<MaterialProfile[]> {
    const { data, isServerAvailable } = await request<MaterialProfile[]>('materials');
    if (isServerAvailable && Array.isArray(data)) {
      writeStorage(STORAGE_KEYS.MATERIALS, data);
      return data;
    }
    return readStorage<MaterialProfile[]>(STORAGE_KEYS.MATERIALS, INITIAL_MATERIALS);
  },

  async getById(id: string): Promise<MaterialProfile | null> {
    const list = await this.getAll();
    return list.find((m) => m.id === id) || null;
  },

  async create(material: Omit<MaterialProfile, 'id' | 'createdAt'>): Promise<MaterialProfile> {
    const { data, isServerAvailable } = await request<MaterialProfile>('materials', {
      method: 'POST',
      body: JSON.stringify(material),
    });

    if (isServerAvailable && data) {
      const list = await this.getAll();
      writeStorage(STORAGE_KEYS.MATERIALS, [data, ...list]);
      return data;
    }

    const list = await this.getAll();
    const newMat: MaterialProfile = {
      ...material,
      id: 'mat_' + Math.random().toString(36).substring(2, 9),
      createdAt: new Date().toISOString(),
    };
    list.unshift(newMat);
    writeStorage(STORAGE_KEYS.MATERIALS, list);
    return newMat;
  },

  async update(id: string, updates: Partial<MaterialProfile>): Promise<MaterialProfile> {
    const { data, isServerAvailable } = await request<MaterialProfile>(`materials/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });

    if (isServerAvailable && data) {
      const list = await this.getAll();
      writeStorage(
        STORAGE_KEYS.MATERIALS,
        list.map((m) => (m.id === id ? data : m))
      );
      return data;
    }

    const list = await this.getAll();
    const index = list.findIndex((m) => m.id === id);
    if (index === -1) throw new Error('Матеріал не знайдено');
    const updated = { ...list[index], ...updates };
    list[index] = updated;
    writeStorage(STORAGE_KEYS.MATERIALS, list);
    return updated;
  },

  async duplicate(id: string): Promise<MaterialProfile> {
    const list = await this.getAll();
    const original = list.find((m) => m.id === id);
    if (!original) throw new Error('Матеріал не знайдено');
    const copy: MaterialProfile = {
      ...original,
      id: 'mat_' + Math.random().toString(36).substring(2, 9),
      name: `${original.name} (копія)`,
      createdAt: new Date().toISOString(),
    };
    list.unshift(copy);
    writeStorage(STORAGE_KEYS.MATERIALS, list);
    return copy;
  },

  async archive(id: string): Promise<void> {
    await this.update(id, { isArchived: true });
  },

  async delete(id: string): Promise<void> {
    await request(`materials/${id}`, { method: 'DELETE' }).catch(() => {});
    const list = await this.getAll();
    writeStorage(
      STORAGE_KEYS.MATERIALS,
      list.filter((m) => m.id !== id)
    );
  },
};

// ============================================================================
// 6. PRINTERS API MODULE
// ============================================================================
export const printersApi = {
  async getAll(): Promise<PrinterProfile[]> {
    const { data, isServerAvailable } = await request<PrinterProfile[]>('printers');
    if (isServerAvailable && Array.isArray(data)) {
      writeStorage(STORAGE_KEYS.PRINTERS, data);
      return data;
    }
    return readStorage<PrinterProfile[]>(STORAGE_KEYS.PRINTERS, INITIAL_PRINTERS);
  },

  async getById(id: string): Promise<PrinterProfile | null> {
    const list = await this.getAll();
    return list.find((p) => p.id === id) || null;
  },

  async create(printer: Omit<PrinterProfile, 'id' | 'createdAt'>): Promise<PrinterProfile> {
    const { data, isServerAvailable } = await request<PrinterProfile>('printers', {
      method: 'POST',
      body: JSON.stringify(printer),
    });

    if (isServerAvailable && data) {
      const list = await this.getAll();
      writeStorage(STORAGE_KEYS.PRINTERS, [...list, data]);
      return data;
    }

    const list = await this.getAll();
    if (printer.isDefault) {
      list.forEach((p) => (p.isDefault = false));
    }
    const newPrinter: PrinterProfile = {
      ...printer,
      id: 'prn_' + Math.random().toString(36).substring(2, 9),
      createdAt: new Date().toISOString(),
    };
    list.push(newPrinter);
    writeStorage(STORAGE_KEYS.PRINTERS, list);
    return newPrinter;
  },

  async update(id: string, updates: Partial<PrinterProfile>): Promise<PrinterProfile> {
    const { data, isServerAvailable } = await request<PrinterProfile>(`printers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });

    if (isServerAvailable && data) {
      const list = await this.getAll();
      writeStorage(
        STORAGE_KEYS.PRINTERS,
        list.map((p) => (p.id === id ? data : p))
      );
      return data;
    }

    const list = await this.getAll();
    const index = list.findIndex((p) => p.id === id);
    if (index === -1) throw new Error('Принтер не знайдено');

    if (updates.isDefault) {
      list.forEach((p) => {
        if (p.id !== id) p.isDefault = false;
      });
    }

    const updated = { ...list[index], ...updates };
    list[index] = updated;
    writeStorage(STORAGE_KEYS.PRINTERS, list);
    return updated;
  },

  async delete(id: string): Promise<void> {
    await request(`printers/${id}`, { method: 'DELETE' }).catch(() => {});
    const list = await this.getAll();
    writeStorage(
      STORAGE_KEYS.PRINTERS,
      list.filter((p) => p.id !== id)
    );
  },

  async setDefault(id: string): Promise<void> {
    await this.update(id, { isDefault: true });
  },
};

// ============================================================================
// 7. CALCULATIONS API MODULE
// ============================================================================
export const calculationsApi = {
  async getAll(): Promise<CalculationSnapshot[]> {
    const { data, isServerAvailable } = await request<CalculationSnapshot[]>('calculations');
    if (isServerAvailable && Array.isArray(data)) {
      writeStorage(STORAGE_KEYS.CALCULATIONS, data);
      return data;
    }
    return readStorage<CalculationSnapshot[]>(
      STORAGE_KEYS.CALCULATIONS,
      getInitialCalculationSnapshots()
    );
  },

  async getById(id: string): Promise<CalculationSnapshot | null> {
    const { data, isServerAvailable } = await request<CalculationSnapshot>(`calculations/${id}`);
    if (isServerAvailable && data) return data;
    const list = await this.getAll();
    return list.find((c) => c.id === id) || null;
  },

  async save(snapshot: Omit<CalculationSnapshot, 'id' | 'createdAt'>): Promise<CalculationSnapshot> {
    const { data, isServerAvailable } = await request<CalculationSnapshot>('calculations', {
      method: 'POST',
      body: JSON.stringify(snapshot),
    });

    if (isServerAvailable && data) {
      const list = await this.getAll();
      writeStorage(STORAGE_KEYS.CALCULATIONS, [data, ...list]);
      return data;
    }

    const list = await this.getAll();
    const newSnapshot: CalculationSnapshot = {
      ...snapshot,
      id: 'calc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      createdAt: new Date().toISOString(),
    };
    list.unshift(newSnapshot);
    writeStorage(STORAGE_KEYS.CALCULATIONS, list);
    return newSnapshot;
  },

  async duplicate(id: string): Promise<CalculationSnapshot> {
    const list = await this.getAll();
    const original = list.find((c) => c.id === id);
    if (!original) throw new Error('Розрахунок не знайдено');

    const copy: CalculationSnapshot = {
      ...original,
      id: 'calc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      title: `${original.title} (копія)`,
      createdAt: new Date().toISOString(),
    };
    list.splice(list.indexOf(original) + 1, 0, copy);
    writeStorage(STORAGE_KEYS.CALCULATIONS, list);
    return copy;
  },

  async delete(id: string): Promise<void> {
    await request(`calculations/${id}`, { method: 'DELETE' }).catch(() => {});
    const list = await this.getAll();
    writeStorage(
      STORAGE_KEYS.CALCULATIONS,
      list.filter((c) => c.id !== id)
    );
  },
};

// ============================================================================
// 8. FILE ANALYSIS / 3MF PARSER API MODULE
// ============================================================================
export const fileAnalysisApi = {
  async getDemoJob(): Promise<ParsedJob> {
    const { data, isServerAvailable } = await request<ParsedJob>('analysis/demo');
    if (isServerAvailable && data) return data;
    return JSON.parse(JSON.stringify(DEMO_JOB_SECTION_9));
  },

  async loadPresetJob(presetKey: string): Promise<ParsedJob> {
    const { data, isServerAvailable } = await request<ParsedJob>(`analysis/preset/${presetKey}`);
    if (isServerAvailable && data) return data;
    return JSON.parse(JSON.stringify(DEMO_JOB_SECTION_9));
  },

  async analyzeUploadedFile(file: File): Promise<ParsedJob> {
    const formData = new FormData();
    formData.append('file', file);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch(`${API_BASE_URL}/analysis/upload`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const parsed = await res.json();
        return parsed as ParsedJob;
      }
    } catch {
      clearTimeout(timeoutId);
    }

    // Client fallback simulation
    const fileName = file.name;
    const is3mf = fileName.toLowerCase().endsWith('.3mf') || fileName.toLowerCase().includes('.gcode.3mf');

    if (file.size > 50 * 1024 * 1024) {
      return {
        fileName,
        fileSizeBytes: file.size,
        slicerSource: 'Невідомо',
        plates: [],
        totalPredictionSeconds: 0,
        totalWeightGrams: 0,
        warnings: [],
        parseStatus: 'file_limit_exceeded',
        errorMessage: 'Розмір файлу перевищує ліміт (максимум 50 МБ).',
      };
    }

    if (!is3mf) {
      return {
        fileName,
        fileSizeBytes: file.size,
        slicerSource: 'Невідомо',
        plates: [],
        totalPredictionSeconds: 0,
        totalWeightGrams: 0,
        warnings: [],
        parseStatus: 'corrupted',
        errorMessage: 'Непідтримуваний формат файлу. Очікується файл проекту Bambu Studio (.gcode.3mf).',
      };
    }

    return {
      fileName: file.name,
      fileSizeBytes: file.size,
      slicerSource: 'Bambu Studio / OrcaSlicer (клієнтський аналізатор)',
      plates: [
        {
          plateIndex: 1,
          plateName: 'Plate 1',
          predictionSeconds: 7800,
          totalWeightGrams: 98,
          selected: true,
          repeatsCount: 1,
          filaments: [
            {
              trayId: 1,
              type: 'PLA',
              colorHex: '#0ea5e9',
              colorName: 'Синій',
              weightGrams: 98,
            },
          ],
        },
      ],
      totalPredictionSeconds: 7800,
      totalWeightGrams: 98,
      warnings: [],
      parseStatus: 'success',
    };
  },
};

// ============================================================================
// 9. SETTINGS API MODULE
// ============================================================================
export const settingsApi = {
  async getSettings(): Promise<PricingSettings> {
    const { data, isServerAvailable } = await request<PricingSettings>('settings');
    if (isServerAvailable && data) {
      writeStorage(STORAGE_KEYS.SETTINGS, data);
      return data;
    }
    return readStorage<PricingSettings>(STORAGE_KEYS.SETTINGS, INITIAL_PRICING_SETTINGS);
  },

  async updateSettings(updates: Partial<PricingSettings>): Promise<PricingSettings> {
    const { data, isServerAvailable } = await request<PricingSettings>('settings', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });

    if (isServerAvailable && data) {
      writeStorage(STORAGE_KEYS.SETTINGS, data);
      return data;
    }

    const current = await this.getSettings();
    const updated = { ...current, ...updates };
    writeStorage(STORAGE_KEYS.SETTINGS, updated);
    return updated;
  },

  async exportConfigJson(): Promise<string> {
    const settings = await this.getSettings();
    return JSON.stringify(settings, null, 2);
  },

  async importConfigJson(jsonString: string): Promise<PricingSettings> {
    const parsed = JSON.parse(jsonString);
    const updated = { ...INITIAL_PRICING_SETTINGS, ...parsed };
    await this.updateSettings(updated);
    return updated;
  },

  async resetToDefaults(): Promise<PricingSettings> {
    writeStorage(STORAGE_KEYS.SETTINGS, INITIAL_PRICING_SETTINGS);
    return INITIAL_PRICING_SETTINGS;
  },
};

// ============================================================================
// 10. PROFILE API MODULE
// ============================================================================
export const profileApi = {
  async getProfile(): Promise<UserProfile> {
    const { data, isServerAvailable } = await request<UserProfile>('profile');
    if (isServerAvailable && data) {
      writeStorage(STORAGE_KEYS.PROFILE, data);
      return data;
    }
    return readStorage<UserProfile>(STORAGE_KEYS.PROFILE, INITIAL_USER_PROFILE);
  },

  async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    const { data, isServerAvailable } = await request<UserProfile>('profile', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });

    if (isServerAvailable && data) {
      writeStorage(STORAGE_KEYS.PROFILE, data);
      return data;
    }

    const current = await this.getProfile();
    const updated = { ...current, ...updates };
    writeStorage(STORAGE_KEYS.PROFILE, updated);
    return updated;
  },
};

// ============================================================================
// UNIFIED MASTER API OBJECT
// ============================================================================
export const api = {
  auth: authApi,
  filaments: filamentsApi,
  manufacturers: manufacturersApi,
  temperatures: temperatureProfilesApi,
  materials: materialsApi,
  printers: printersApi,
  calculations: calculationsApi,
  analysis: fileAnalysisApi,
  settings: settingsApi,
  profile: profileApi,
  config: {
    baseUrl: API_BASE_URL,
    storageKeys: STORAGE_KEYS,
  },
};

export default api;
