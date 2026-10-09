import { parsePrintPreview } from './printPreviewParser.ts';
import type { ParsedJob } from '../domain/types.ts';

self.onmessage = (event: MessageEvent<{ fileName: string; buffer: ArrayBuffer; job: ParsedJob }>) => {
  try {
    const data = parsePrintPreview(event.data.fileName, new Uint8Array(event.data.buffer), event.data.job);
    const buffers = data.plates.flatMap(plate => plate.groups.map(group => group.positions.buffer));
    self.postMessage({ ok: true, data }, { transfer: buffers });
  } catch {
    self.postMessage({ ok: false, error: 'Не вдалося побудувати 3D-прев’ю. Розрахунок залишається доступним.' });
  }
};
