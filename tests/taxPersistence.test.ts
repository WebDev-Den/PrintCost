import assert from 'node:assert/strict';
import test from 'node:test';
import { api, STORAGE_KEYS } from '../src/services/api.ts';
import { authService } from '../src/services/authService.ts';
import { getInitialCalculationSnapshots, INITIAL_MATERIALS } from '../src/domain/defaultData.ts';
import { createTaxPreset } from '../src/domain/taxes.ts';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

test('tax persistence validates every material row, legacy reads and resets', async () => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  try {
    await authService.enableDemoSession();
    assert.equal((await api.settings.getSettings()).tax, undefined);
    await api.settings.updateSettings({ tax: createTaxPreset('fop3', true) });
    assert.equal((await api.settings.getSettings()).tax?.unifiedTaxPercent, '3');
    const canonical = await api.settings.updateSettings({ tax: { ...createTaxPreset(), monthlyOrders: '20.0', monthlyBillableHours: '12,50' } });
    assert.equal(canonical.tax?.monthlyOrders, '20');
    assert.equal(canonical.tax?.monthlyBillableHours, '12.5');
    assert.equal((await api.settings.resetToDefaults()).tax?.enabled, false);
    await api.settings.updateSettings({ tax: createTaxPreset() });
    assert.equal((await api.settings.importConfigJson('{}')).tax?.enabled, false);

    const snapshot = structuredClone(getInitialCalculationSnapshots()[0]);
    snapshot.input.filaments = Array.from({ length: 500 }, (_, i) => ({ ...snapshot.input.filaments[0], key: `row-${i}` }));
    const { id: _id, createdAt: _created, ...input } = snapshot;
    input.input.filaments[499].priceVatMode = 'included';
    input.input.filaments[499].vatRatePercent = '101';
    await assert.rejects(api.calculations.save(input), /ПДВ матеріалу/);
    input.input.filaments[499].vatRatePercent = '20';
    input.input.filaments[499].vatRecoverable = true;
    input.input.tax = { ...createTaxPreset(), monthlyOrders: '20.0', monthlyBillableHours: '.5' };
    const saved = await api.calculations.save(input);
    assert.equal(saved.input.tax?.monthlyOrders, '20');
    assert.equal(saved.input.tax?.monthlyBillableHours, '0.5');
    assert.equal((await api.calculations.getById(saved.id))?.input.filaments[499].vatRatePercent, '20');
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.CALCULATIONS)!);
    stored[0].input.filaments[499].vatRecoverable = 'true';
    localStorage.setItem(STORAGE_KEYS.CALCULATIONS, JSON.stringify(stored));
    await assert.rejects(api.calculations.getById(saved.id), /явною логічною/);
    localStorage.removeItem(STORAGE_KEYS.CALCULATIONS);

    const { id: _materialId, createdAt: _materialCreated, ...material } = INITIAL_MATERIALS[0];
    await assert.rejects(api.materials.create({ ...material, vatRatePercent: '20' }), /виберіть спосіб/);
    const created = await api.materials.create({ ...material, priceVatMode: 'included', vatRatePercent: '20', vatRecoverable: false });
    await assert.rejects(api.materials.update(created.id, { vatRatePercent: '200' }), /ПДВ матеріалу/);
    assert.equal((await api.materials.getById(created.id))?.vatRatePercent, '20');

    const settings = await api.settings.getSettings();
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ ...settings, tax: { ...createTaxPreset(), vatPayer: 'true' } }));
    await assert.rejects(api.settings.getSettings(), /Некоректний податковий/);
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
