import type { MaterialProfile } from '../domain/types.ts';
import { INITIAL_MATERIALS } from '../domain/defaultData.ts';

export interface MaterialRepository {
  getAll(): Promise<MaterialProfile[]>;
  create(material: Omit<MaterialProfile, 'id' | 'createdAt'>): Promise<MaterialProfile>;
  update(id: string, updates: Partial<MaterialProfile>): Promise<MaterialProfile>;
  duplicate(id: string): Promise<MaterialProfile>;
  archive(id: string): Promise<void>;
  delete(id: string): Promise<void>;
}

const STORAGE_KEY_MATERIALS = 'printcost_materials';

export class MockMaterialRepository implements MaterialRepository {
  async getAll(): Promise<MaterialProfile[]> {
    const raw = localStorage.getItem(STORAGE_KEY_MATERIALS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY_MATERIALS, JSON.stringify(INITIAL_MATERIALS));
      return INITIAL_MATERIALS;
    }
    try {
      return JSON.parse(raw) as MaterialProfile[];
    } catch {
      return INITIAL_MATERIALS;
    }
  }

  async create(material: Omit<MaterialProfile, 'id' | 'createdAt'>): Promise<MaterialProfile> {
    const list = await this.getAll();
    const newMat: MaterialProfile = {
      ...material,
      id: 'mat_' + Math.random().toString(36).substring(2, 9),
      createdAt: new Date().toISOString(),
    };
    list.unshift(newMat);
    localStorage.setItem(STORAGE_KEY_MATERIALS, JSON.stringify(list));
    return newMat;
  }

  async update(id: string, updates: Partial<MaterialProfile>): Promise<MaterialProfile> {
    const list = await this.getAll();
    const index = list.findIndex((m) => m.id === id);
    if (index === -1) throw new Error('Матеріал не знайдено');
    const updated = { ...list[index], ...updates };
    list[index] = updated;
    localStorage.setItem(STORAGE_KEY_MATERIALS, JSON.stringify(list));
    return updated;
  }

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
    list.splice(list.indexOf(original) + 1, 0, copy);
    localStorage.setItem(STORAGE_KEY_MATERIALS, JSON.stringify(list));
    return copy;
  }

  async archive(id: string): Promise<void> {
    const list = await this.getAll();
    const target = list.find((m) => m.id === id);
    if (target) {
      target.isArchived = !target.isArchived;
      localStorage.setItem(STORAGE_KEY_MATERIALS, JSON.stringify(list));
    }
  }

  async delete(id: string): Promise<void> {
    const list = await this.getAll();
    const filtered = list.filter((m) => m.id !== id);
    localStorage.setItem(STORAGE_KEY_MATERIALS, JSON.stringify(filtered));
  }
}

export const materialRepository = new MockMaterialRepository();
