import type { PrinterProfile } from '../domain/types.ts';
import { api } from './api.ts';

export interface PrinterRepository {
  getAll(): Promise<PrinterProfile[]>;
  create(printer: Omit<PrinterProfile, 'id' | 'createdAt'>): Promise<PrinterProfile>;
  update(id: string, updates: Partial<PrinterProfile>): Promise<PrinterProfile>;
  delete(id: string): Promise<void>;
  setDefault(id: string): Promise<void>;
}

export class MockPrinterRepository implements PrinterRepository {
  async getAll(): Promise<PrinterProfile[]> {
    return api.printers.getAll();
  }

  async create(printer: Omit<PrinterProfile, 'id' | 'createdAt'>): Promise<PrinterProfile> {
    return api.printers.create(printer);
  }

  async update(id: string, updates: Partial<PrinterProfile>): Promise<PrinterProfile> {
    return api.printers.update(id, updates);
  }

  async delete(id: string): Promise<void> {
    return api.printers.delete(id);
  }

  async setDefault(id: string): Promise<void> {
    return api.printers.setDefault(id);
  }
}

export const printerRepository = new MockPrinterRepository();
