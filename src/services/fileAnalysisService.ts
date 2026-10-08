import type { ParsedJob } from '../domain/types.ts';
import { DEMO_JOB_SECTION_9 } from '../domain/defaultData.ts';
import { FILE_SIZE_LIMIT, parsePrintFile } from './printFileParser.ts';

export interface FileAnalysisService {
  getDemoJob(): Promise<ParsedJob>;
  analyzeUploadedFile(file: File): Promise<ParsedJob>;
  loadPresetJob(presetKey: string): Promise<ParsedJob>;
}

export const fileAnalysisService: FileAnalysisService = {
  async getDemoJob() {
    const job = structuredClone(DEMO_JOB_SECTION_9);
    job.fileName = 'Демо — bracket_mount_v2.gcode.3mf';
    job.warnings = ['Демонстраційні дані, не результат аналізу завантаженого файлу.'];
    return job;
  },

  async loadPresetJob(presetKey) {
    const job = await this.getDemoJob();
    job.fileName = `Демо — ${presetKey}`;
    if (presetKey === 'multi_plate') {
      job.plates.push({ ...structuredClone(job.plates[0]), plateIndex: 2, plateName: 'Демо — пластина 2' });
      job.totalPredictionSeconds *= 2;
      job.totalWeightGrams *= 2;
    } else if (presetKey === 'unknown_material') {
      job.plates[0].filaments[0].type = 'Невідомий';
      job.warnings.push('Демо: виберіть матеріал для невідомого філаменту вручну.');
    } else if (presetKey === 'no_slicing' || presetKey === 'corrupted') {
      job.parseStatus = presetKey === 'no_slicing' ? 'no_slicing_data' : 'corrupted';
      job.errorMessage = presetKey === 'no_slicing'
        ? 'Демо: проєкт містить моделі, але не містить результату нарізки.'
        : 'Демо: архів пошкоджений.';
      job.plates = [];
      job.totalPredictionSeconds = 0;
      job.totalWeightGrams = 0;
    } else {
      job.parseStatus = 'error';
      job.errorMessage = 'Невідомий демонстраційний сценарій.';
      job.plates = [];
      job.totalPredictionSeconds = 0;
      job.totalWeightGrams = 0;
    }
    return job;
  },

  async analyzeUploadedFile(file) {
    if (file.size > FILE_SIZE_LIMIT) return parsePrintFile(file.name, new Uint8Array(), file.size);
    const buffer = await file.arrayBuffer();
    if (typeof Worker === 'undefined') return parsePrintFile(file.name, new Uint8Array(buffer));
    return new Promise<ParsedJob>((resolve, reject) => {
      const worker = new Worker(new URL('./printFileParser.worker.ts', import.meta.url), { type: 'module' });
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('Обробка файлу перевищила 30 секунд. Спробуйте менший файл.'));
      }, 30_000);
      worker.onmessage = (event: MessageEvent<ParsedJob>) => {
        clearTimeout(timeout);
        worker.terminate();
        resolve(event.data);
      };
      worker.onerror = () => {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error('Не вдалося запустити локальний аналізатор файлів.'));
      };
      worker.postMessage({ fileName: file.name, buffer }, [buffer]);
    });
  },
};
