import type { ParsedJob } from '../domain/types.ts';
import type { PrintPreviewData } from '../domain/printPreview.ts';
import { FILE_SIZE_LIMIT } from './printFileParser.ts';

export async function createPrintPreview(file: File, job: ParsedJob, signal?: AbortSignal): Promise<PrintPreviewData> {
  signal?.throwIfAborted();
  if (file.size > FILE_SIZE_LIMIT) throw new Error('Файл перевищує 50 MiB — ліміт 3D-прев’ю у браузері.');
  if (typeof Worker === 'undefined') throw new Error('Цей браузер не підтримує фонову побудову 3D-прев’ю. Розрахунок залишається доступним.');
  const buffer = await file.arrayBuffer();
  signal?.throwIfAborted();

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./printPreviewParser.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (data?: PrintPreviewData, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      if (error !== undefined) reject(error);
      else resolve(data!);
    };
    const abort = () => finish(undefined, signal?.reason ?? new DOMException('Прев’ю скасовано.', 'AbortError'));
    const timeout = setTimeout(() => finish(undefined, new Error('Побудова 3D-прев’ю триває надто довго. Розрахунок залишається доступним.')), 30_000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    worker.onmessage = (event: MessageEvent<{ ok: true; data: PrintPreviewData } | { ok: false; error: string }>) => {
      if (event.data.ok) finish(event.data.data);
      else finish(undefined, new Error(event.data.error));
    };
    worker.onerror = worker.onmessageerror = () => finish(undefined, new Error('Не вдалося прочитати 3D-прев’ю. Розрахунок залишається доступним.'));
    try { worker.postMessage({ fileName: file.name, buffer, job }, [buffer]); }
    catch (error) { finish(undefined, error); }
  });
}
