import type { PrinterProfile } from '../domain/types.ts';
import { INITIAL_PRINTERS } from '../domain/defaultData.ts';

export interface PrinterRepository {
  getAll(): Promise<PrinterProfile[]>;
  create(printer: Omit<PrinterProfile, 'id' | 'createdAt'>): Promise<PrinterProfile>;
  update(id: string, updates: Partial<PrinterProfile>): Promise<PrinterProfile>;
  delete(id: string): Promise<void>;
  setDefault(id: string): Promise<void>;
}

const STORAGE_KEY_PRINTERS = 'printcost_printers';

export class MockPrinterRepository implements PrinterRepository {
  async getAll(): Promise<PrinterProfile[]> {
    const raw = localStorage.getItem(STORAGE_KEY_PRINTERS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY_PRINTERS, JSON.stringify(INITIAL_PRINTERS));
      return INITIAL_PRINTERS;
    }
    try {
      return JSON.parse(raw) as PrinterProfile[];
    } catch {
      return INITIAL_PRINTERS;
    }
  }

  async create(printer: Omit<PrinterProfile, 'id' | 'createdAt'>): Promise<PrinterProfile> {
    const list = await this.getAll();
    if (printer.isDefault) {
      list.forEach((p) => (p.isDefault = false));
    }
    const newPrinter: PrinterProfile = {
      ...printer,
      id: 'prn_' + Math.random().toString(36).substring(2, 9),
      createdAt: new Date().toISOString(),
    };
    list.push(newPrinter);
    localStorage.setItem(STORAGE_KEY_PRINTERS, JSON.stringify(list));
    return newPrinter;
  }

  async update(id: string, updates: Partial<PrinterProfile>): Promise<PrinterProfile> {
    const list = await this.getAll();
    const index = list.findIndex((p) => p.id === id);
    if (index === -1) throw new Error('Принтер не знайдено');

    if (updates.isDefault) {
      list.forEach((p) => {
        if (p.id !== id) p.isDefault = false;
      });
    }

    const updated = { ...list[index], ...updates };
    list[index] = updated;
    localStorage.setItem(STORAGE_KEY_PRINTERS, JSON.stringify(list));
    return updated;
  }

  async delete(id: string): Promise<void> {
    const list = await this.getAll();
    const filtered = list.filter((p) => p.id !== id);
    // If deleted printer was default, set first remaining as default
    if (filtered.length > 0 && !filtered.some((p) => p.isDefault)) {
      filtered[0].isDefault = true;
    }
    localStorage.setItem(STORAGE_KEY_PRINTERS, JSON.stringify(filtered));
  }

  async setDefault(id: string): Promise<void> {
    const list = await this.getAll();
    list.forEach((p) => {
      p.isDefault = p.id === id;
    });
    localStorage.setItem(STORAGE_KEY_PRINTERS, JSON.stringify(list));
  }
}

export const printerRepository = new MockPrinterRepository();
