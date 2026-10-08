import type { CalculationSnapshot } from '../domain/types.ts';
import { api } from './api.ts';
import type { CalculationCursor, CalculationPage } from './api.ts';

export interface CalculationRepository {
  getAll(): Promise<CalculationSnapshot[]>;
  getPage(cursor?: CalculationCursor | null): Promise<CalculationPage>;
  getById(id: string): Promise<CalculationSnapshot | null>;
  save(snapshot: Omit<CalculationSnapshot, 'id' | 'createdAt'>): Promise<CalculationSnapshot>;
  duplicate(id: string): Promise<CalculationSnapshot>;
  delete(id: string): Promise<void>;
  updateMetadata(id: string, updates: Pick<Partial<CalculationSnapshot>, 'title' | 'clientName' | 'notes'>): Promise<CalculationSnapshot>;
}

export class MockCalculationRepository implements CalculationRepository {
  async getPage(cursor: CalculationCursor | null = null): Promise<CalculationPage> { return api.calculations.getPage(cursor); }
  async updateMetadata(id: string, updates: Pick<Partial<CalculationSnapshot>, 'title' | 'clientName' | 'notes'>): Promise<CalculationSnapshot> { return api.calculations.updateMetadata(id, updates); }
  async getAll(): Promise<CalculationSnapshot[]> {
    return api.calculations.getAll();
  }

  async getById(id: string): Promise<CalculationSnapshot | null> {
    return api.calculations.getById(id);
  }

  async save(snapshot: Omit<CalculationSnapshot, 'id' | 'createdAt'>): Promise<CalculationSnapshot> {
    return api.calculations.save(snapshot);
  }

  async duplicate(id: string): Promise<CalculationSnapshot> {
    return api.calculations.duplicate(id);
  }

  async delete(id: string): Promise<void> {
    return api.calculations.delete(id);
  }
}

export const calculationRepository = new MockCalculationRepository();
