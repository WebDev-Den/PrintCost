import assert from 'node:assert/strict';
import test from 'node:test';
import { api, STORAGE_KEYS } from '../src/services/api.ts';
import { authService } from '../src/services/authService.ts';
import { getInitialCalculationSnapshots } from '../src/domain/defaultData.ts';
import { CALCULATION_ALGORITHM_VERSION } from '../src/domain/calculationTemplates.ts';
import { getCalculationSaveErrors, getRecalculationTitle } from '../src/domain/calculationPersistence.ts';
import { calculatePrintCost } from '../src/domain/calculator.ts';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

test('private templates enforce versions; history pages beyond 200 and preserves saved amounts', async () => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  try {
    await authService.enableDemoSession();
    const legacy = structuredClone(getInitialCalculationSnapshots()[0]);
    const { job: _job, filaments: _filaments, ...parameters } = legacy.input;
    const template = await api.templates.create({ name: 'PLA details', parameters, materialMappings: { PLA: 'mat_pla_esun' } });
    assert.equal(template.version, 1);
    await api.settings.updateSettings({ defaultTemplateId: template.id });
    const updated = await api.templates.update(template.id, 1, { name: 'Renamed' });
    assert.equal(updated.version, 2);
    assert.equal(updated.createdAt, template.createdAt);
    await assert.rejects(api.templates.update(template.id, 1, { name: 'stale' }), /іншому вікні/);
    await assert.rejects(api.templates.delete(template.id, 1), /іншому вікні/);
    await assert.rejects(api.templates.update(template.id, 2, { version: 99 } as never), /Некоректна зміна/);
    const copy = await api.templates.create({ name: 'Copy', parameters: updated.parameters, materialMappings: updated.materialMappings });
    assert.notEqual(copy.id, template.id);
    await api.templates.delete(template.id, 2);
    assert.equal((await api.settings.getSettings()).defaultTemplateId, null);
    assert.equal((await api.templates.getAll()).length, 1);
    await assert.rejects(api.settings.updateSettings({ defaultTemplateId: template.id }), /не існує/);

    const rows = Array.from({ length: 251 }, (_, index) => ({ ...legacy, id: `history-${String(index).padStart(3, '0')}`, createdAt: '2026-01-01T00:00:00.000Z' }));
    localStorage.setItem(STORAGE_KEYS.CALCULATIONS, JSON.stringify(rows));
    const ids: string[] = [];
    let cursor = null;
    let hasMore = true;
    while (hasMore) {
      const page = await api.calculations.getPage(cursor);
      assert.ok(page.items.length <= 50);
      ids.push(...page.items.map(item => item.id));
      cursor = page.cursor; hasMore = page.hasMore;
    }
    assert.equal(ids.length, 251);
    assert.equal(new Set(ids).size, 251);
    assert.equal(ids[0], 'history-250');
    assert.equal(ids.at(-1), 'history-000');
    assert.equal((await api.calculations.getAll()).length, 251);
    const mixedIds = Array.from({ length: 60 }, (_, index) => `${index % 2 ? 'a' : 'B'}${String(index).padStart(3, '0')}`);
    localStorage.setItem(STORAGE_KEYS.CALCULATIONS, JSON.stringify(mixedIds.map(id => ({ ...legacy, id }))));
    const mixedFirst = await api.calculations.getPage();
    const mixedSecond = await api.calculations.getPage(mixedFirst.cursor);
    assert.deepEqual([...mixedFirst.items, ...mixedSecond.items].map(item => item.id), mixedIds.sort().reverse());
    localStorage.setItem(STORAGE_KEYS.CALCULATIONS, JSON.stringify(rows));
    await assert.rejects(api.calculations.update('history-250', { input: { ...legacy.input, markupPercent: '999' } }), /незмінні/);
    const renamed = await api.calculations.updateMetadata('history-250', { title: 'Invoice', clientName: 'Example', notes: 'Order notes' });
    assert.deepEqual(renamed.result, legacy.result);
    const duplicated = await api.calculations.duplicate('history-250');
    assert.equal(duplicated.algorithmVersion, 'legacy');
    assert.equal(duplicated.sourceCalculationId, 'history-250');
    assert.equal(Number(duplicated.result.sellingPriceUah), Number(legacy.result.sellingPriceUah));
    assert.equal(Number(duplicated.result.costPriceUah), Number(legacy.result.costPriceUah));
    assert.deepEqual((await api.calculations.getById('history-250'))?.result, legacy.result);
    const longOriginal = await api.calculations.updateMetadata('history-250', { title: 'Д'.repeat(300) });
    const recalculatedInput = { ...longOriginal.input, markupPercent: '125' };
    const recalculatedResult = calculatePrintCost(recalculatedInput);
    const recalculatedTitle = getRecalculationTitle(longOriginal.title, new Date('2026-10-09T12:00:00Z'));
    const recalculated = await api.calculations.save({
      title: recalculatedTitle, input: recalculatedInput, result: recalculatedResult, status: recalculatedResult.status,
      fileName: longOriginal.fileName, sourceCalculationId: longOriginal.id,
    });
    assert.equal(recalculated.title.length, 300);
    assert.ok(recalculated.title.endsWith(' (оновлені тарифи 09.10.2026)'));
    assert.notEqual(recalculated.id, longOriginal.id);
    assert.equal(recalculated.sourceCalculationId, longOriginal.id);
    assert.deepEqual(await api.calculations.getById(longOriginal.id), longOriginal);
    assert.equal(getRecalculationTitle('Деталь', new Date('2026-10-09T12:00:00Z')), 'Деталь (оновлені тарифи 09.10.2026)');
    const { id: _id, createdAt: _createdAt, ...input } = legacy;
    assert.equal((await api.calculations.save(input)).algorithmVersion, CALCULATION_ALGORITHM_VERSION);
    await api.materials.update('mat_petg_bambu', { isArchived: true });
    await assert.rejects(api.calculations.save(input), /Матеріал видалено, архівовано/);
    assert.equal((await api.calculations.duplicate('history-250')).sourceCalculationId, 'history-250');
    await api.materials.update('mat_petg_bambu', { isArchived: false, type: 'ABS' });
    await assert.rejects(api.calculations.save(input), /він змінив тип/);
    await api.materials.update('mat_petg_bambu', { type: 'PETG' });
    await api.printers.delete(input.input.selectedPrinterId!);
    await assert.rejects(api.calculations.save(input), /Принтер видалено/);
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('saving drafts rejects missing printer parameters locally and preserves unknown material prices', async () => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  try {
    const { id: _id, createdAt: _created, ...snapshot } = structuredClone(getInitialCalculationSnapshots()[0]);
    snapshot.input.selectedPrinterId = null;
    snapshot.input.averagePowerWatts = '';
    snapshot.input.machineHourlyRateUah = '';
    snapshot.input.electricityTariffUahPerKwh = null;
    snapshot.result = calculatePrintCost(snapshot.input);
    snapshot.status = snapshot.result.status;
    assert.deepEqual(getCalculationSaveErrors(snapshot.input), ['Потужність принтера: введіть невід’ємне число.', 'Машинна ставка: введіть невід’ємне число.']);
    // Firebase is unconfigured here: a precise parameter error must precede any repository access.
    await assert.rejects(api.calculations.save(snapshot), /Потужність принтера.*Машинна ставка/);
    assert.equal(localStorage.getItem(STORAGE_KEYS.CALCULATIONS), null);
    await authService.enableDemoSession();
    await assert.rejects(api.calculations.save(snapshot), /Потужність принтера.*Машинна ставка/);
    assert.equal(localStorage.getItem(STORAGE_KEYS.CALCULATIONS), null);

    snapshot.input.averagePowerWatts = '100,000001';
    snapshot.input.machineHourlyRateUah = '10';
    snapshot.input.filaments = snapshot.input.filaments.map(filament => ({ ...filament, mappedMaterialId: null, mappedMaterialName: undefined, pricePerKgUah: null, costUah: null, matchMethod: 'unmatched' }));
    snapshot.result = calculatePrintCost(snapshot.input);
    snapshot.status = snapshot.result.status;
    assert.equal(snapshot.status, 'incomplete');
    assert.deepEqual(getCalculationSaveErrors(snapshot.input), []);
    const saved = await api.calculations.save(snapshot);
    assert.equal(saved.input.averagePowerWatts, '100.000001');
    assert.equal(saved.input.machineHourlyRateUah, '10');
    assert.equal(saved.input.electricityTariffUahPerKwh, null);
    assert.equal(saved.status, 'incomplete');
    assert.ok(saved.input.filaments.every(filament => filament.pricePerKgUah === null));
    assert.deepEqual((await api.calculations.getById(saved.id))?.result, saved.result);
    assert.match(getCalculationSaveErrors({ ...snapshot.input, averagePowerWatts: '100.0000001' }).join(' '), /Потужність принтера.*6 після/);
    assert.match(getCalculationSaveErrors({ ...snapshot.input, machineHourlyRateUah: '1000000000000' }).join(' '), /Машинна ставка.*12 цифр/);
    assert.match(getCalculationSaveErrors({ ...snapshot.input, marginPercent: '100' }).join(' '), /менше 100/);
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
