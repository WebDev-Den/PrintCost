import type { CalculationSnapshot } from '../domain/types.ts';
import { getInitialCalculationSnapshots } from '../domain/defaultData.ts';

export interface CalculationRepository {
  getAll(): Promise<CalculationSnapshot[]>;
  getById(id: string): Promise<CalculationSnapshot | null>;
  save(snapshot: Omit<CalculationSnapshot, 'id' | 'createdAt'>): Promise<CalculationSnapshot>;
  duplicate(id: string): Promise<CalculationSnapshot>;
  delete(id: string): Promise<void>;
}

const STORAGE_KEY_CALCULATIONS = 'printcost_saved_calculations';

export class MockCalculationRepository implements CalculationRepository {
  async getAll(): Promise<CalculationSnapshot[]> {
    const raw = localStorage.getItem(STORAGE_KEY_CALCULATIONS);
    if (!raw) {
      const initials = getInitialCalculationSnapshots();
      localStorage.setItem(STORAGE_KEY_CALCULATIONS, JSON.stringify(initials));
      return initials;
    }
    try {
      return JSON.parse(raw) as CalculationSnapshot[];
    } catch {
      return getInitialCalculationSnapshots();
    }
  }

  async getById(id: string): Promise<CalculationSnapshot | null> {
    const list = await this.getAll();
    return list.find((c) => c.id === id) || null;
  }

  async save(snapshot: Omit<CalculationSnapshot, 'id' | 'createdAt'>): Promise<CalculationSnapshot> {
    const list = await this.getAll();
    const newSnapshot: CalculationSnapshot = {
      ...snapshot,
      id: 'calc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      createdAt: new Date().toISOString(),
    };
    list.unshift(newSnapshot);
    localStorage.setItem(STORAGE_KEY_CALCULATIONS, JSON.stringify(list));
    return newSnapshot;
  }

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
    localStorage.setItem(STORAGE_KEY_CALCULATIONS, JSON.stringify(list));
    return copy;
  }

  async delete(id: string): Promise<void> {
    const list = await this.getAll();
    const filtered = list.filter((c) => c.id !== id);
    localStorage.setItem(STORAGE_KEY_CALCULATIONS, JSON.stringify(filtered));
  }
}

export const calculationRepository = new MockCalculationRepository();
