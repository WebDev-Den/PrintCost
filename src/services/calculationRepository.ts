import type { CalculationSnapshot } from '../domain/types.ts';
import { api } from './api.ts';

export interface CalculationRepository {
  getAll(): Promise<CalculationSnapshot[]>;
  getById(id: string): Promise<CalculationSnapshot | null>;
  save(snapshot: Omit<CalculationSnapshot, 'id' | 'createdAt'>): Promise<CalculationSnapshot>;
  duplicate(id: string): Promise<CalculationSnapshot>;
  delete(id: string): Promise<void>;
}

export class MockCalculationRepository implements CalculationRepository {
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
