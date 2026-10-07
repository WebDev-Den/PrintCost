import type { PricingSettings } from '../domain/types.ts';
import { INITIAL_PRICING_SETTINGS } from '../domain/defaultData.ts';

export interface SettingsRepository {
  getSettings(): Promise<PricingSettings>;
  updateSettings(updates: Partial<PricingSettings>): Promise<PricingSettings>;
  exportConfigJson(): Promise<string>;
  importConfigJson(jsonString: string): Promise<PricingSettings>;
  resetToDefaults(): Promise<PricingSettings>;
}

const STORAGE_KEY_SETTINGS = 'printcost_pricing_settings';

export class MockSettingsRepository implements SettingsRepository {
  async getSettings(): Promise<PricingSettings> {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(INITIAL_PRICING_SETTINGS));
      return INITIAL_PRICING_SETTINGS;
    }
    try {
      return { ...INITIAL_PRICING_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return INITIAL_PRICING_SETTINGS;
    }
  }

  async updateSettings(updates: Partial<PricingSettings>): Promise<PricingSettings> {
    const current = await this.getSettings();
    const updated = { ...current, ...updates };
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(updated));
    return updated;
  }

  async exportConfigJson(): Promise<string> {
    const settings = await this.getSettings();
    return JSON.stringify(settings, null, 2);
  }

  async importConfigJson(jsonString: string): Promise<PricingSettings> {
    const parsed = JSON.parse(jsonString);
    const updated = { ...INITIAL_PRICING_SETTINGS, ...parsed };
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(updated));
    return updated;
  }

  async resetToDefaults(): Promise<PricingSettings> {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(INITIAL_PRICING_SETTINGS));
    return INITIAL_PRICING_SETTINGS;
  }
}

export const settingsRepository = new MockSettingsRepository();
