import type { ParsedJob } from '../domain/types.ts';
import { api } from './api.ts';

export interface FileAnalysisService {
  getDemoJob(): Promise<ParsedJob>;
  analyzeUploadedFile(file: File): Promise<ParsedJob>;
  loadPresetJob(presetKey: string): Promise<ParsedJob>;
}

export class MockFileAnalysisService implements FileAnalysisService {
  async getDemoJob(): Promise<ParsedJob> {
    return api.analysis.getDemoJob();
  }

  async analyzeUploadedFile(file: File): Promise<ParsedJob> {
    return api.analysis.analyzeUploadedFile(file);
  }

  async loadPresetJob(presetKey: string): Promise<ParsedJob> {
    return api.analysis.loadPresetJob(presetKey);
  }
}

export const fileAnalysisService = new MockFileAnalysisService();
