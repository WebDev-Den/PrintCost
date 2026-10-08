import type { MaterialProfile } from '../domain/types.ts';
import { api } from './api.ts';

export interface MaterialRepository {
  getAll(): Promise<MaterialProfile[]>;
  create(material: Omit<MaterialProfile, 'id' | 'createdAt'>): Promise<MaterialProfile>;
  update(id: string, updates: Partial<MaterialProfile>): Promise<MaterialProfile>;
  duplicate(id: string): Promise<MaterialProfile>;
  archive(id: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export class MockMaterialRepository implements MaterialRepository {
  async getAll(): Promise<MaterialProfile[]> {
    return api.materials.getAll();
  }

  async create(material: Omit<MaterialProfile, 'id' | 'createdAt'>): Promise<MaterialProfile> {
    return api.materials.create(material);
  }

  async update(id: string, updates: Partial<MaterialProfile>): Promise<MaterialProfile> {
    return api.materials.update(id, updates);
  }

  async duplicate(id: string): Promise<MaterialProfile> {
    return api.materials.duplicate(id);
  }

  async archive(id: string): Promise<void> {
    return api.materials.archive(id);
  }

  async delete(id: string): Promise<void> {
    return api.materials.delete(id);
  }
}

export const materialRepository = new MockMaterialRepository();
