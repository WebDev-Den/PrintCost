import assert from 'node:assert/strict';
import test from 'node:test';
import type { ParsedJob } from '../src/domain/types.ts';
import { createPrintPreview } from '../src/services/printPreviewService.ts';
import { FILE_SIZE_LIMIT } from '../src/services/printFileParser.ts';

const job: ParsedJob = { fileName: 'part.gcode', fileSizeBytes: 8, slicerSource: '', plates: [], totalPredictionSeconds: 0, totalWeightGrams: 0, warnings: [], parseStatus: 'error' };
const file = { name: job.fileName, size: 8, arrayBuffer: async () => new ArrayBuffer(8) } as File;

class FakeWorker {
  static instances: FakeWorker[] = [];
  static throwOnPost = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  message?: { fileName: string; buffer: ArrayBuffer; job: ParsedJob };
  transfer?: Transferable[];
  constructor() { FakeWorker.instances.push(this); }
  postMessage(message: FakeWorker['message'], transfer: Transferable[]) {
    if (FakeWorker.throwOnPost) throw new Error('Cannot transfer file');
    this.message = message;
    this.transfer = transfer;
  }
  terminate() { this.terminated = true; }
}

test('preview worker lifecycle stays separate from calculation metadata', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });
  try {
    await t.test('transfers input, returns typed paths, and releases worker on success', async () => {
      const original = JSON.stringify(job);
      const promise = createPrintPreview(file, job);
      await Promise.resolve();
      const worker = FakeWorker.instances.at(-1)!;
      assert.equal(worker.message?.job, job);
      assert.deepEqual(worker.transfer, [worker.message?.buffer]);
      const data = { plates: [{ plateIndex: 1, plateName: 'Пластина 1', groups: [{ trayId: 1, colorHex: '#FFFFFF', positions: new Float32Array([0, 0, 0, 1, 0, 0]) }], warnings: [] }], warnings: [] };
      worker.onmessage!({ data: { ok: true, data } } as MessageEvent);
      assert.equal(await promise, data);
      assert.equal(worker.terminated, true);
      assert.equal(worker.onmessage, null);
      assert.equal(JSON.stringify(job), original);
      assert.equal(JSON.stringify(job).includes('positions'), false);
    });
    await t.test('abort terminates worker and ignores late result', async () => {
      const controller = new AbortController();
      const promise = createPrintPreview(file, job, controller.signal);
      await Promise.resolve();
      const worker = FakeWorker.instances.at(-1)!;
      const lateResult = worker.onmessage!;
      const rejected = assert.rejects(promise, { name: 'AbortError' });
      controller.abort();
      lateResult({ data: { ok: true, data: { plates: [], warnings: [] } } } as MessageEvent);
      await rejected;
      assert.equal(worker.terminated, true);
      assert.equal(worker.onerror, null);
    });
    await t.test('abort during file read never starts a worker', async () => {
      const controller = new AbortController();
      const count = FakeWorker.instances.length;
      const promise = createPrintPreview({ ...file, arrayBuffer: async () => { controller.abort(); return new ArrayBuffer(8); } } as File, job, controller.signal);
      await assert.rejects(promise, { name: 'AbortError' });
      assert.equal(FakeWorker.instances.length, count);
    });
    await t.test('worker failure and invalid structured response release resources', async () => {
      for (const event of ['onerror', 'onmessageerror'] as const) {
        const promise = createPrintPreview(file, job);
        await Promise.resolve();
        const worker = FakeWorker.instances.at(-1)!;
        worker[event]!();
        await assert.rejects(promise, /Розрахунок залишається доступним/);
        assert.equal(worker.terminated, true);
      }
      const promise = createPrintPreview(file, job);
      await Promise.resolve();
      const worker = FakeWorker.instances.at(-1)!;
      worker.onmessage!({ data: { ok: false, error: 'Пошкоджений файл' } } as MessageEvent);
      await assert.rejects(promise, /Пошкоджений файл/);
      assert.equal(worker.terminated, true);
    });
    await t.test('timeout terminates expensive parser without blocking calculation', async () => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      try {
        const promise = createPrintPreview(file, job);
        await Promise.resolve();
        const worker = FakeWorker.instances.at(-1)!;
        const rejected = assert.rejects(promise, /надто довго/);
        t.mock.timers.tick(30_000);
        await rejected;
        assert.equal(worker.terminated, true);
      } finally { t.mock.timers.reset(); }
    });
    await t.test('transfer failure releases worker; oversize file is never read', async () => {
      FakeWorker.throwOnPost = true;
      await assert.rejects(createPrintPreview(file, job), /Cannot transfer/);
      FakeWorker.throwOnPost = false;
      assert.equal(FakeWorker.instances.at(-1)?.terminated, true);
      await assert.rejects(createPrintPreview({ ...file, size: FILE_SIZE_LIMIT + 1, arrayBuffer: async () => { throw new Error('Must not read'); } } as File, job), /50 MiB/);
    });
    await t.test('unsupported browser gets honest fallback without main-thread parse', async () => {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: undefined });
      await assert.rejects(createPrintPreview({ ...file, arrayBuffer: async () => { throw new Error('Must not read'); } } as File, job), /фонову побудову/);
    });
  } finally {
    if (previous) Object.defineProperty(globalThis, 'Worker', previous);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
});
