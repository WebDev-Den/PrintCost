import type { PricingSettings } from '../domain/types.ts';
import { api } from './api.ts';

export interface SettingsRepository {
  getSettings(): Promise<PricingSettings>;
  updateSettings(updates: Partial<PricingSettings>): Promise<PricingSettings>;
  exportConfigJson(): Promise<string>;
  importConfigJson(jsonString: string): Promise<PricingSettings>;
  resetToDefaults(): Promise<PricingSettings>;
}

export class MockSettingsRepository implements SettingsRepository {
  async getSettings(): Promise<PricingSettings> {
    return api.settings.getSettings();
  }

  async updateSettings(updates: Partial<PricingSettings>): Promise<PricingSettings> {
    return api.settings.updateSettings(updates);
  }

  async exportConfigJson(): Promise<string> {
    return api.settings.exportConfigJson();
  }

  async importConfigJson(jsonString: string): Promise<PricingSettings> {
    return api.settings.importConfigJson(jsonString);
  }

  async resetToDefaults(): Promise<PricingSettings> {
    return api.settings.resetToDefaults();
  }
}

export const settingsRepository = new MockSettingsRepository();
