import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type {
  MaterialProfile,
  PrinterProfile,
  PricingSettings,
  CalculationSnapshot,
} from '../domain/types.ts';
import { materialRepository } from '../services/materialRepository.ts';
import { printerRepository } from '../services/printerRepository.ts';
import { settingsRepository } from '../services/settingsRepository.ts';
import { calculationRepository } from '../services/calculationRepository.ts';

interface AppDataContextType {
  materials: MaterialProfile[];
  printers: PrinterProfile[];
  settings: PricingSettings;
  calculations: CalculationSnapshot[];
  isLoading: boolean;
  theme: 'light' | 'dark' | 'system';
  setTheme: (t: 'light' | 'dark' | 'system') => void;
  // Material actions
  addMaterial: (m: Omit<MaterialProfile, 'id' | 'createdAt'>) => Promise<MaterialProfile>;
  updateMaterial: (id: string, updates: Partial<MaterialProfile>) => Promise<MaterialProfile>;
  duplicateMaterial: (id: string) => Promise<MaterialProfile>;
  archiveMaterial: (id: string) => Promise<void>;
  deleteMaterial: (id: string) => Promise<void>;
  // Printer actions
  addPrinter: (p: Omit<PrinterProfile, 'id' | 'createdAt'>) => Promise<PrinterProfile>;
  updatePrinter: (id: string, updates: Partial<PrinterProfile>) => Promise<PrinterProfile>;
  deletePrinter: (id: string) => Promise<void>;
  setDefaultPrinter: (id: string) => Promise<void>;
  // Settings actions
  updateSettings: (updates: Partial<PricingSettings>) => Promise<PricingSettings>;
  exportSettings: () => Promise<string>;
  importSettings: (json: string) => Promise<void>;
  resetSettings: () => Promise<void>;
  // Calculation actions
  saveCalculation: (calc: Omit<CalculationSnapshot, 'id' | 'createdAt'>) => Promise<CalculationSnapshot>;
  duplicateCalculation: (id: string) => Promise<CalculationSnapshot>;
  deleteCalculation: (id: string) => Promise<void>;
  // Helper for matching filament
  findBestMaterialMatch: (typeFromFile: string) => {
    material: MaterialProfile | null;
    method: 'exact_preset' | 'type_match' | 'unmatched';
  };
  saveFilamentMapping: (typeFromFile: string, materialId: string) => Promise<void>;
}

const AppDataContext = createContext<AppDataContextType | undefined>(undefined);

export const AppDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [materials, setMaterials] = useState<MaterialProfile[]>([]);
  const [printers, setPrinters] = useState<PrinterProfile[]>([]);
  const [settings, setSettings] = useState<PricingSettings>({} as PricingSettings);
  const [calculations, setCalculations] = useState<CalculationSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(() => {
    try {
      const stored = localStorage.getItem('kilog_theme') as 'light' | 'dark' | 'system';
      if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    } catch {}
    return 'light';
  });

  const refreshAll = useCallback(async () => {
    try {
      const [mats, prns, setts, calcs] = await Promise.all([
        materialRepository.getAll(),
        printerRepository.getAll(),
        settingsRepository.getSettings(),
        calculationRepository.getAll(),
      ]);
      setMaterials(mats);
      setPrinters(prns);
      setSettings(setts);
      setCalculations(calcs);
      const storedTheme = (() => {
        try {
          return localStorage.getItem('kilog_theme') as 'light' | 'dark' | 'system' | null;
        } catch {
          return null;
        }
      })();
      if (storedTheme) {
        setThemeState(storedTheme);
      } else if (setts.theme) {
        setThemeState(setts.theme);
        try {
          localStorage.setItem('kilog_theme', setts.theme);
        } catch {}
      }
    } catch (err) {
      console.error('Failed to load application data', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Apply dark mode class to documentElement (html) & body
  useEffect(() => {
    const root = document.documentElement;
    const updateThemeClasses = () => {
      const isDark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

      if (isDark) {
        root.classList.add('dark');
        root.setAttribute('data-theme', 'dark');
        document.body.classList.add('dark');
      } else {
        root.classList.remove('dark');
        root.setAttribute('data-theme', 'light');
        document.body.classList.remove('dark');
      }
    };

    updateThemeClasses();
    try {
      localStorage.setItem('kilog_theme', theme);
    } catch {}

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = () => {
      if (theme === 'system') {
        updateThemeClasses();
      }
    };
    mediaQuery.addEventListener?.('change', handleMediaChange);
    return () => mediaQuery.removeEventListener?.('change', handleMediaChange);
  }, [theme]);

  const setTheme = async (newTheme: 'light' | 'dark' | 'system') => {
    setThemeState(newTheme);
    try {
      localStorage.setItem('kilog_theme', newTheme);
    } catch {}

    const root = document.documentElement;
    const isDark =
      newTheme === 'dark' ||
      (newTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (isDark) {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
      document.body.classList.add('dark');
    } else {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
      document.body.classList.remove('dark');
    }

    try {
      const updated = await settingsRepository.updateSettings({ theme: newTheme });
      setSettings(updated);
    } catch {
      // Ignore API errors when unauthenticated/offline
    }
  };

  const addMaterial = async (m: Omit<MaterialProfile, 'id' | 'createdAt'>) => {
    const res = await materialRepository.create(m);
    setMaterials((prev) => [res, ...prev]);
    return res;
  };

  const updateMaterial = async (id: string, updates: Partial<MaterialProfile>) => {
    const res = await materialRepository.update(id, updates);
    setMaterials((prev) => prev.map((m) => (m.id === id ? res : m)));
    return res;
  };

  const duplicateMaterial = async (id: string) => {
    const res = await materialRepository.duplicate(id);
    setMaterials((prev) => [res, ...prev]);
    return res;
  };

  const archiveMaterial = async (id: string) => {
    await materialRepository.archive(id);
    setMaterials((prev) =>
      prev.map((m) => (m.id === id ? { ...m, isArchived: !m.isArchived } : m))
    );
  };

  const deleteMaterial = async (id: string) => {
    await materialRepository.delete(id);
    setMaterials((prev) => prev.filter((m) => m.id !== id));
  };

  const addPrinter = async (p: Omit<PrinterProfile, 'id' | 'createdAt'>) => {
    const res = await printerRepository.create(p);
    setPrinters((prev) => (p.isDefault ? prev.map((x) => ({ ...x, isDefault: false })).concat(res) : [...prev, res]));
    return res;
  };

  const updatePrinter = async (id: string, updates: Partial<PrinterProfile>) => {
    const res = await printerRepository.update(id, updates);
    setPrinters((prev) => {
      let updatedList = prev.map((p) => (p.id === id ? res : p));
      if (updates.isDefault) {
        updatedList = updatedList.map((p) => (p.id === id ? p : { ...p, isDefault: false }));
      }
      return updatedList;
    });
    return res;
  };

  const deletePrinter = async (id: string) => {
    await printerRepository.delete(id);
    setPrinters((prev) => prev.filter((p) => p.id !== id));
  };

  const setDefaultPrinter = async (id: string) => {
    await printerRepository.setDefault(id);
    setPrinters((prev) => prev.map((p) => ({ ...p, isDefault: p.id === id })));
  };

  const updateSettings = async (updates: Partial<PricingSettings>) => {
    const res = await settingsRepository.updateSettings(updates);
    setSettings(res);
    return res;
  };

  const exportSettings = async () => {
    return settingsRepository.exportConfigJson();
  };

  const importSettings = async (json: string) => {
    const res = await settingsRepository.importConfigJson(json);
    setSettings(res);
  };

  const resetSettings = async () => {
    const res = await settingsRepository.resetToDefaults();
    setSettings(res);
  };

  const saveCalculation = async (calc: Omit<CalculationSnapshot, 'id' | 'createdAt'>) => {
    const res = await calculationRepository.save(calc);
    setCalculations((prev) => [res, ...prev]);
    return res;
  };

  const duplicateCalculation = async (id: string) => {
    const res = await calculationRepository.duplicate(id);
    setCalculations((prev) => [res, ...prev]);
    return res;
  };

  const deleteCalculation = async (id: string) => {
    await calculationRepository.delete(id);
    setCalculations((prev) => prev.filter((c) => c.id !== id));
  };

  /**
   * Deterministic matching:
   * 1. Preset dictionary match (saved preference)
   * 2. Case-insensitive exact type match with active catalog
   * 3. Else unmatched
   */
  const findBestMaterialMatch = (typeFromFile: string) => {
    const cleanType = typeFromFile.trim().toUpperCase();

    // 1. Check presets
    if (settings.filamentMappingPresets && settings.filamentMappingPresets[cleanType]) {
      const presetId = settings.filamentMappingPresets[cleanType];
      const found = materials.find((m) => m.id === presetId && !m.isArchived);
      if (found) {
        return { material: found, method: 'exact_preset' as const };
      }
    }

    // 2. Direct exact type match
    // Note: PETG doesn't equal PLA; PLA-CF doesn't equal PLA!
    const directMatch = materials.find(
      (m) => !m.isArchived && m.type.trim().toUpperCase() === cleanType
    );
    if (directMatch) {
      return { material: directMatch, method: 'type_match' as const };
    }

    return { material: null, method: 'unmatched' as const };
  };

  const saveFilamentMapping = async (typeFromFile: string, materialId: string) => {
    const cleanType = typeFromFile.trim().toUpperCase();
    const updatedPresets = {
      ...(settings.filamentMappingPresets || {}),
      [cleanType]: materialId,
    };
    await updateSettings({ filamentMappingPresets: updatedPresets });
  };

  return (
    <AppDataContext.Provider
      value={{
        materials,
        printers,
        settings,
        calculations,
        isLoading,
        theme,
        setTheme,
        addMaterial,
        updateMaterial,
        duplicateMaterial,
        archiveMaterial,
        deleteMaterial,
        addPrinter,
        updatePrinter,
        deletePrinter,
        setDefaultPrinter,
        updateSettings,
        exportSettings,
        importSettings,
        resetSettings,
        saveCalculation,
        duplicateCalculation,
        deleteCalculation,
        findBestMaterialMatch,
        saveFilamentMapping,
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
};

export function useAppData() {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error('useAppData must be used within an AppDataProvider');
  }
  return context;
}
