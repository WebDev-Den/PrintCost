import {
  PUBLIC_FILAMENTS_CATALOG,
  MANUFACTURERS_LIST,
  STANDARD_TEMPERATURE_PROFILES,
  PublicFilamentItem,
  ManufacturerBrand,
  TemperatureProfile,
} from '../domain/filamentsDirectory.ts';

const FILAMENTS_STORAGE_KEY = 'kilog_catalog_filaments_v2';
const MANUFACTURERS_STORAGE_KEY = 'kilog_catalog_manufacturers_v2';
const TEMPERATURES_STORAGE_KEY = 'kilog_catalog_temperatures_v2';
const LIKES_STORAGE_KEY = 'kilog_catalog_likes_v1';

class CatalogAdminRepository {
  // --- FILAMENTS ---
  getFilaments(): PublicFilamentItem[] {
    try {
      const data = localStorage.getItem(FILAMENTS_STORAGE_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.warn('Failed reading filaments from localStorage', e);
    }
    return [...PUBLIC_FILAMENTS_CATALOG];
  }

  saveFilaments(items: PublicFilamentItem[]): void {
    try {
      localStorage.setItem(FILAMENTS_STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      console.error('Failed saving filaments to localStorage', e);
    }
  }

  createFilament(item: Omit<PublicFilamentItem, 'id'>): PublicFilamentItem {
    const filaments = this.getFilaments();
    const id = `fil-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newItem: PublicFilamentItem = { ...item, id };
    const updated = [newItem, ...filaments];
    this.saveFilaments(updated);
    return newItem;
  }

  updateFilament(id: string, updates: Partial<PublicFilamentItem>): PublicFilamentItem | null {
    const filaments = this.getFilaments();
    const index = filaments.findIndex((f) => f.id === id);
    if (index === -1) return null;

    const updatedItem = { ...filaments[index], ...updates };
    filaments[index] = updatedItem;
    this.saveFilaments(filaments);
    return updatedItem;
  }

  deleteFilament(id: string): void {
    const filaments = this.getFilaments();
    const filtered = filaments.filter((f) => f.id !== id);
    this.saveFilaments(filtered);
  }

  // --- MANUFACTURERS ---
  getManufacturers(): ManufacturerBrand[] {
    try {
      const data = localStorage.getItem(MANUFACTURERS_STORAGE_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.warn('Failed reading manufacturers from localStorage', e);
    }
    return [...MANUFACTURERS_LIST];
  }

  saveManufacturers(items: ManufacturerBrand[]): void {
    try {
      localStorage.setItem(MANUFACTURERS_STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      console.error('Failed saving manufacturers to localStorage', e);
    }
  }

  createManufacturer(item: Omit<ManufacturerBrand, 'id'>): ManufacturerBrand {
    const list = this.getManufacturers();
    const id = `mfg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newItem: ManufacturerBrand = { ...item, id };
    const updated = [newItem, ...list];
    this.saveManufacturers(updated);
    return newItem;
  }

  updateManufacturer(id: string, updates: Partial<ManufacturerBrand>): ManufacturerBrand | null {
    const list = this.getManufacturers();
    const index = list.findIndex((m) => m.id === id);
    if (index === -1) return null;

    const updatedItem = { ...list[index], ...updates };
    list[index] = updatedItem;
    this.saveManufacturers(list);
    return updatedItem;
  }

  deleteManufacturer(id: string): void {
    const list = this.getManufacturers();
    const filtered = list.filter((m) => m.id !== id);
    this.saveManufacturers(filtered);
  }

  // --- TEMPERATURE PROFILES ---
  getTemperatureProfiles(): Record<string, TemperatureProfile> {
    try {
      const data = localStorage.getItem(TEMPERATURES_STORAGE_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.warn('Failed reading temperature profiles', e);
    }
    return { ...STANDARD_TEMPERATURE_PROFILES };
  }

  saveTemperatureProfiles(profiles: Record<string, TemperatureProfile>): void {
    try {
      localStorage.setItem(TEMPERATURES_STORAGE_KEY, JSON.stringify(profiles));
    } catch (e) {
      console.error('Failed saving temperature profiles', e);
    }
  }

  updateTemperatureProfile(type: string, profile: TemperatureProfile): void {
    const profiles = this.getTemperatureProfiles();
    profiles[type] = profile;
    this.saveTemperatureProfiles(profiles);
  }

  deleteTemperatureProfile(type: string): void {
    const profiles = this.getTemperatureProfiles();
    delete profiles[type];
    this.saveTemperatureProfiles(profiles);
  }

  // --- USER LIKES / FAVORITES ---
  getLikedFilamentIds(): string[] {
    try {
      const data = localStorage.getItem(LIKES_STORAGE_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.warn('Failed reading likes', e);
    }
    return [];
  }

  toggleLike(filamentId: string): boolean {
    const likes = this.getLikedFilamentIds();
    const exists = likes.includes(filamentId);
    let updated: string[];
    if (exists) {
      updated = likes.filter((id) => id !== filamentId);
    } else {
      updated = [...likes, filamentId];
    }
    try {
      localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('Failed saving likes', e);
    }
    return !exists;
  }

  // Reset all catalog overrides back to clean initial demo data
  resetAllToFactory(): void {
    localStorage.removeItem(FILAMENTS_STORAGE_KEY);
    localStorage.removeItem(MANUFACTURERS_STORAGE_KEY);
    localStorage.removeItem(TEMPERATURES_STORAGE_KEY);
  }
}

export const catalogAdminRepository = new CatalogAdminRepository();
