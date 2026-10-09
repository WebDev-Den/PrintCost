import { api } from './api.ts';
import type { FilamentBulkAction, PublicFilamentItem, ManufacturerBrand, TemperatureProfile } from '../domain/filamentsDirectory.ts';

export const catalogAdminRepository = {
  getFilaments: () => api.filaments.getAll(),
  saveFilaments: (items: PublicFilamentItem[]) => api.filaments.replace(items),
  createFilament: (item: Omit<PublicFilamentItem, 'id'>) => api.filaments.create(item),
  updateFilament: (id: string, updates: Partial<PublicFilamentItem>) => api.filaments.update(id, updates),
  deleteFilament: (id: string) => api.filaments.delete(id),
  applyFilamentBulkAction: (ids: string[], action: FilamentBulkAction) => api.filaments.applyBulkAction(ids, action),
  getManufacturers: () => api.manufacturers.getAll(),
  createManufacturer: (item: Omit<ManufacturerBrand, 'id'>) => api.manufacturers.create(item),
  updateManufacturer: (id: string, updates: Partial<ManufacturerBrand>) => api.manufacturers.update(id, updates),
  deleteManufacturer: (id: string) => api.manufacturers.delete(id),
  getTemperatureProfiles: () => api.temperatures.getAll(),
  deleteTemperatureProfile: (type: string) => api.temperatures.delete(type),
  getLikedFilamentIds: () => api.filaments.getLikedIds(),
  toggleLike: (id: string) => api.filaments.toggleLike(id),
  savePlasticType: (original: string | null, name: string, profile: TemperatureProfile) => api.catalog.savePlasticType(original, name, profile),
  resetAllToFactory: () => api.catalog.reset(),
};
