import type { ParsedJob } from '../domain/types.ts';
import { DEMO_JOB_SECTION_9 } from '../domain/defaultData.ts';

export interface FileAnalysisService {
  getDemoJob(): Promise<ParsedJob>;
  analyzeUploadedFile(file: File): Promise<ParsedJob>;
  loadPresetJob(presetKey: string): Promise<ParsedJob>;
}

export class MockFileAnalysisService implements FileAnalysisService {
  async getDemoJob(): Promise<ParsedJob> {
    // Returns agreed Section 9 demonstration job
    return JSON.parse(JSON.stringify(DEMO_JOB_SECTION_9));
  }

  async analyzeUploadedFile(file: File): Promise<ParsedJob> {
    // Check file extension
    const fileName = file.name;
    const is3mf = fileName.toLowerCase().endsWith('.3mf') || fileName.toLowerCase().includes('.gcode.3mf');

    // Simulate small reading delay
    await new Promise((resolve) => setTimeout(resolve, 600));

    // File size limit check (e.g. 50MB)
    if (file.size > 50 * 1024 * 1024) {
      return {
        fileName,
        fileSizeBytes: file.size,
        slicerSource: 'Невідомо',
        plates: [],
        totalPredictionSeconds: 0,
        totalWeightGrams: 0,
        warnings: [],
        parseStatus: 'file_limit_exceeded',
        errorMessage: 'Розмір файлу перевищує ліміт (максимум 50 МБ).',
      };
    }

    if (!is3mf) {
      return {
        fileName,
        fileSizeBytes: file.size,
        slicerSource: 'Невідомо',
        plates: [],
        totalPredictionSeconds: 0,
        totalWeightGrams: 0,
        warnings: [],
        parseStatus: 'corrupted',
        errorMessage: 'Непідтримуваний формат файлу. Очікується файл проекту Bambu Studio (.gcode.3mf).',
      };
    }

    // Explicitly notify user that production binary zip/XML parser is pending backend integration
    // As explicitly specified in brief:
    // "Для іншого вибраного файлу можна показати його справжні назву й розмір, але не генеруй вигадані грами й час.
    //  Виклич mock-service, який явно повідомляє, що production-парсер ще не підключений."
    return {
      fileName: file.name,
      fileSizeBytes: file.size,
      slicerSource: 'Bambu Studio (потрібен серверний парсер)',
      plates: [],
      totalPredictionSeconds: 0,
      totalWeightGrams: 0,
      warnings: [],
      parseStatus: 'error',
      errorMessage:
        'Production-парсер метаданих Bambu Studio .gcode.3mf очікує підключення Supabase backend. Для перевірки розрахунку, зміни тарифів та тестування інтерфейсу скористайтеся кнопкою «Відкрити демонстраційний приклад».',
    };
  }

  async loadPresetJob(presetKey: string): Promise<ParsedJob> {
    switch (presetKey) {
      case 'multi_plate':
        return {
          fileName: 'quadcopter_frame_kit.gcode.3mf',
          fileSizeBytes: 4892140,
          slicerSource: 'Bambu Studio v1.9.3.50',
          printerModelName: 'Bambu Lab X1-Carbon',
          nozzleDiameterMm: '0.40',
          isDemoJob: true,
          parseStatus: 'success',
          totalPredictionSeconds: 12600, // 3.5 hours
          totalWeightGrams: 240,
          warnings: ['Пластина 2 містить композитний матеріал з рекомендацією сопла 0.4 Hardened Steel'],
          plates: [
            {
              plateIndex: 1,
              plateName: 'Пластина 1 — Верхня та нижня палуби (PETG)',
              predictionSeconds: 7200,
              totalWeightGrams: 140,
              selected: true,
              repeatsCount: 1,
              filaments: [
                {
                  trayId: 1,
                  type: 'PETG',
                  colorHex: '#1e293b',
                  colorName: 'Чорний',
                  weightGrams: 140,
                  lengthMeters: 46.5,
                },
              ],
            },
            {
              plateIndex: 2,
              plateName: 'Пластина 2 — Променеві кронштейни (PLA-CF)',
              predictionSeconds: 5400,
              totalWeightGrams: 100,
              selected: true,
              repeatsCount: 1,
              filaments: [
                {
                  trayId: 2,
                  type: 'PLA-CF',
                  colorHex: '#334155',
                  colorName: 'Carbon Grey',
                  weightGrams: 100,
                  lengthMeters: 33.1,
                },
              ],
            },
          ],
        };

      case 'unknown_material':
        return {
          fileName: 'aerospace_bracket_experimental.gcode.3mf',
          fileSizeBytes: 1820400,
          slicerSource: 'Bambu Studio v1.9.3.50',
          printerModelName: 'Bambu Lab X1-Carbon',
          nozzleDiameterMm: '0.60',
          isDemoJob: true,
          parseStatus: 'success',
          totalPredictionSeconds: 8400,
          totalWeightGrams: 120,
          warnings: ['Матеріал "PA6-GF30" не знайдено в каталозі. Потрібно вказати відповідність або додати матеріал.'],
          plates: [
            {
              plateIndex: 1,
              plateName: 'Пластина 1 — Корпус',
              predictionSeconds: 8400,
              totalWeightGrams: 120,
              selected: true,
              repeatsCount: 1,
              filaments: [
                {
                  trayId: 1,
                  type: 'PA6-GF30',
                  colorHex: '#71717a',
                  colorName: 'Склонаповнений поліамід',
                  weightGrams: 120,
                  lengthMeters: 38.0,
                },
              ],
            },
          ],
        };

      case 'no_slicing':
        return {
          fileName: 'unsliced_model_project.3mf',
          fileSizeBytes: 890100,
          slicerSource: 'Bambu Studio',
          plates: [],
          totalPredictionSeconds: 0,
          totalWeightGrams: 0,
          warnings: [],
          parseStatus: 'no_slicing_data',
          errorMessage: 'Файл є проєктом геометрії 3MF, але не містить результатів слайсингу (gcode / slice info). Будь ласка, виконайте нарізку в Bambu Studio та експортуйте зрізаний файл .gcode.3mf.',
        };

      case 'corrupted':
        return {
          fileName: 'damaged_archive.gcode.3mf',
          fileSizeBytes: 12040,
          slicerSource: 'Невідомо',
          plates: [],
          totalPredictionSeconds: 0,
          totalWeightGrams: 0,
          warnings: [],
          parseStatus: 'corrupted',
          errorMessage: 'Помилка відкриття архіву: структура метаданих пошкоджена або неповна.',
        };

      default:
        return this.getDemoJob();
    }
  }
}

export const fileAnalysisService = new MockFileAnalysisService();
