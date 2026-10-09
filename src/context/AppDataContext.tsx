import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import type {
  MaterialProfile,
  PrinterProfile,
  PricingSettings,
  CalculationSnapshot,
  CalculationTemplate,
} from '../domain/types.ts';
import { materialRepository } from '../services/materialRepository.ts';
import { printerRepository } from '../services/printerRepository.ts';
import { settingsRepository } from '../services/settingsRepository.ts';
import { calculationRepository } from '../services/calculationRepository.ts';
import { templateRepository } from '../services/templateRepository.ts';
import type { CalculationCursor, TemplateInput, TemplateUpdates } from '../services/api.ts';
import { findMaterialMatch, isCompatibleMaterial, normalizeMaterialType } from '../domain/materialMatching.ts';
import { INITIAL_PRICING_SETTINGS } from '../domain/defaultData.ts';
import { useAuth } from './AuthContext.tsx';
import { authService } from '../services/authService.ts';

interface AppDataContextType {
  materials: MaterialProfile[];
  printers: PrinterProfile[];
  settings: PricingSettings;
  calculations: CalculationSnapshot[];
  templates: CalculationTemplate[];
  calculationsHasMore: boolean;
  calculationsLoadingMore: boolean;
  loadMoreCalculations: () => Promise<void>;
  createTemplate: (input: TemplateInput) => Promise<CalculationTemplate>;
  updateTemplate: (id: string, expectedVersion: number, updates: TemplateUpdates) => Promise<CalculationTemplate>;
  deleteTemplate: (id: string, expectedVersion: number) => Promise<void>;
  updateCalculationMetadata: (id: string, updates: Pick<Partial<CalculationSnapshot>, 'title' | 'clientName' | 'notes'>) => Promise<CalculationSnapshot>;
  isLoading: boolean;
  loadError: string | null;
  actionError: string | null;
  clearActionError: () => void;
  retryLoad: () => void;
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
  return <SessionDataProvider>{children}</SessionDataProvider>;
};

const SessionDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoading: authLoading, isDemoSession } = useAuth();
  const canUsePrivateData = isDemoSession || Boolean(user?.emailVerified && !user?.isBlocked);
  const identity = isDemoSession ? 'demo' : user?.id || 'guest';
  const sessionKey = canUsePrivateData ? identity : `restricted:${identity}`;
  const sessionRef = useRef(sessionKey);
  sessionRef.current = sessionKey;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [materials, setMaterials] = useState<MaterialProfile[]>([]);
  const [printers, setPrinters] = useState<PrinterProfile[]>([]);
  const [settings, setSettings] = useState<PricingSettings>(INITIAL_PRICING_SETTINGS);
  const [calculations, setCalculations] = useState<CalculationSnapshot[]>([]);
  const [templates, setTemplates] = useState<CalculationTemplate[]>([]);
  const [calculationCursor, setCalculationCursor] = useState<CalculationCursor | null>(null);
  const [calculationsHasMore, setCalculationsHasMore] = useState(false);
  const [calculationsLoadingMore, setCalculationsLoadingMore] = useState(false);
  const loadMoreRef = useRef<number | null>(null);
  const loadGenerationRef = useRef(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(() => {
    try {
      const stored = localStorage.getItem('kilog_theme') as 'light' | 'dark' | 'system';
      if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    } catch {}
    return 'light';
  });

  const refreshAll = useCallback(async () => {
    if (authLoading || sessionRef.current !== sessionKey) return;
    const generation = ++loadGenerationRef.current; loadMoreRef.current = null; setCalculationsLoadingMore(false);
    setMaterials([]); setPrinters([]); setCalculations([]); setTemplates([]); setCalculationCursor(null); setCalculationsHasMore(false); setSettings(INITIAL_PRICING_SETTINGS);
    setLoadError(null); setActionError(null);
    if (!user || !canUsePrivateData) { setLoadedFor(sessionKey); setIsLoading(false); return; }
    setIsLoading(true);
    try {
      const [mats, prns, setts, page, savedTemplates] = await Promise.all([
        materialRepository.getAll(),
        printerRepository.getAll(),
        settingsRepository.getSettings(),
        calculationRepository.getPage(),
        templateRepository.getAll(),
      ]);
      if (sessionRef.current !== sessionKey || loadGenerationRef.current !== generation) return;
      setMaterials(mats);
      setPrinters(prns);
      setSettings(setts);
      setCalculations(page.items); setCalculationCursor(page.cursor); setCalculationsHasMore(page.hasMore);
      setTemplates(savedTemplates);
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
      if (sessionRef.current === sessionKey && loadGenerationRef.current === generation) setLoadError(err instanceof Error ? err.message : 'Не вдалося завантажити дані. Перевірте з’єднання.');
    } finally {
      if (sessionRef.current === sessionKey && loadGenerationRef.current === generation) { setLoadedFor(sessionKey); setIsLoading(false); }
    }
  }, [authLoading, sessionKey]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const assertSession = () => {
    const current = authService.getSessionIdentity() || 'guest';
    if (sessionRef.current !== sessionKey || current !== sessionKey) throw new Error('Акаунт змінився. Повторіть дію у поточному акаунті.');
  };
  const checked = async <T,>(promise: Promise<T>): Promise<T> => {
    const result = await promise;
    assertSession();
    return result;
  };
  const perform = async <T,>(operation: () => Promise<T>): Promise<T> => {
    assertSession();
    setActionError(null);
    try { return await checked(operation()); }
    catch (err) {
      if (sessionRef.current === sessionKey) setActionError(err instanceof Error ? err.message : 'Не вдалося зберегти зміни. Спробуйте ще раз.');
      throw err;
    }
  };

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

    if (!user) return;
    try {
      assertSession();
      const updated = await checked(settingsRepository.updateSettings({ theme: newTheme }));
      setSettings(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Тему змінено лише в цьому браузері. Не вдалося зберегти її в акаунті.');
    }
  };

  const addMaterial = async (m: Omit<MaterialProfile, 'id' | 'createdAt'>) => {
    const res = await checked(materialRepository.create(m));
    setMaterials((prev) => [res, ...prev]);
    return res;
  };

  const updateMaterial = async (id: string, updates: Partial<MaterialProfile>) => {
    const res = await checked(materialRepository.update(id, updates));
    setMaterials((prev) => prev.map((m) => (m.id === id ? res : m)));
    return res;
  };

  const duplicateMaterial = async (id: string) => {
    const res = await checked(materialRepository.duplicate(id));
    setMaterials((prev) => [res, ...prev]);
    return res;
  };

  const archiveMaterial = async (id: string) => {
    await checked(materialRepository.archive(id));
    setMaterials((prev) =>
      prev.map((m) => (m.id === id ? { ...m, isArchived: !m.isArchived } : m))
    );
  };

  const deleteMaterial = async (id: string) => {
    await checked(materialRepository.delete(id));
    setMaterials((prev) => prev.filter((m) => m.id !== id));
  };

  const addPrinter = async (p: Omit<PrinterProfile, 'id' | 'createdAt'>) => {
    const res = await checked(printerRepository.create(p));
    setPrinters((prev) => (p.isDefault ? prev.map((x) => ({ ...x, isDefault: false })).concat(res) : [...prev, res]));
    if (res.isDefault) setSettings((prev) => ({ ...prev, defaultPrinterId: res.id }));
    return res;
  };

  const updatePrinter = async (id: string, updates: Partial<PrinterProfile>) => {
    const res = await checked(printerRepository.update(id, updates));
    if (res.isDefault) setSettings((prev) => ({ ...prev, defaultPrinterId: res.id }));
    else setSettings((prev) => prev.defaultPrinterId === id ? { ...prev, defaultPrinterId: null } : prev);
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
    await checked(printerRepository.delete(id));
    setPrinters((prev) => prev.filter((p) => p.id !== id));
    setSettings((prev) => prev.defaultPrinterId === id ? { ...prev, defaultPrinterId: null } : prev);
  };

  const setDefaultPrinter = async (id: string) => {
    await checked(printerRepository.setDefault(id));
    setPrinters((prev) => prev.map((p) => ({ ...p, isDefault: p.id === id })));
    setSettings((prev) => ({ ...prev, defaultPrinterId: id }));
  };

  const updateSettings = async (updates: Partial<PricingSettings>) => {
    const res = await checked(settingsRepository.updateSettings(updates));
    setSettings(res);
    setPrinters((prev) => prev.map((p) => ({ ...p, isDefault: p.id === res.defaultPrinterId })));
    return res;
  };

  const exportSettings = async () => {
    return settingsRepository.exportConfigJson();
  };

  const importSettings = async (json: string) => {
    const res = await checked(settingsRepository.importConfigJson(json));
    setSettings(res);
    setPrinters((prev) => prev.map((p) => ({ ...p, isDefault: p.id === res.defaultPrinterId })));
  };

  const resetSettings = async () => {
    const res = await checked(settingsRepository.resetToDefaults());
    setSettings(res);
    setPrinters((prev) => prev.map((p) => ({ ...p, isDefault: p.id === res.defaultPrinterId })));
  };

  const saveCalculation = async (calc: Omit<CalculationSnapshot, 'id' | 'createdAt'>) => {
    const res = await checked(calculationRepository.save(calc));
    setCalculations((prev) => [res, ...prev]);
    return res;
  };

  const duplicateCalculation = async (id: string) => {
    const res = await checked(calculationRepository.duplicate(id));
    setCalculations((prev) => [res, ...prev]);
    return res;
  };

  const deleteCalculation = async (id: string) => {
    await checked(calculationRepository.delete(id));
    setCalculations((prev) => prev.filter((c) => c.id !== id));
  };

  const loadMoreCalculations = async () => {
    if (!calculationsHasMore || loadMoreRef.current !== null) return;
    const generation = loadGenerationRef.current;
    loadMoreRef.current = generation; setCalculationsLoadingMore(true);
    try {
      const page = await checked(calculationRepository.getPage(calculationCursor));
      if (loadGenerationRef.current !== generation) return;
      setCalculations(previous => [...new Map([...previous, ...page.items].map(value => [value.id, value])).values()]);
      setCalculationCursor(page.cursor); setCalculationsHasMore(page.hasMore);
    } finally { if (loadGenerationRef.current === generation) { loadMoreRef.current = null; setCalculationsLoadingMore(false); } }
  };
  const updateCalculationMetadata = async (id: string, updates: Pick<Partial<CalculationSnapshot>, 'title' | 'clientName' | 'notes'>) => {
    const value = await checked(calculationRepository.updateMetadata(id, updates));
    setCalculations(previous => previous.map(item => item.id === id ? value : item));
    return value;
  };
  const createTemplate = async (input: TemplateInput) => {
    const value = await checked(templateRepository.create(input));
    setTemplates(previous => [value, ...previous]); return value;
  };
  const updateTemplate = async (id: string, version: number, updates: TemplateUpdates) => {
    const value = await checked(templateRepository.update(id, version, updates));
    setTemplates(previous => previous.map(item => item.id === id ? value : item)); return value;
  };
  const deleteTemplate = async (id: string, version: number) => {
    await checked(templateRepository.delete(id, version));
    setTemplates(previous => previous.filter(item => item.id !== id));
    setSettings(previous => previous.defaultTemplateId === id ? { ...previous, defaultTemplateId: null } : previous);
  };

  /**
   * Deterministic matching:
   * 1. Preset dictionary match (saved preference)
   * 2. Case-insensitive exact type match with active catalog
   * 3. Else unmatched
   */
  const findBestMaterialMatch = (typeFromFile: string) => {
    return findMaterialMatch(typeFromFile, materials, settings.filamentMappingPresets);
  };

  const saveFilamentMapping = async (typeFromFile: string, materialId: string) => {
    const cleanType = normalizeMaterialType(typeFromFile);
    const selected = materials.find(material => material.id === materialId);
    if (!selected || !isCompatibleMaterial(selected, cleanType)) throw new Error('Виберіть активний матеріал відповідного типу.');
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
        templates,
        calculationsHasMore,
        calculationsLoadingMore,
        loadMoreCalculations: () => perform(loadMoreCalculations),
        createTemplate: input => perform(() => createTemplate(input)),
        updateTemplate: (id, version, updates) => perform(() => updateTemplate(id, version, updates)),
        deleteTemplate: (id, version) => perform(() => deleteTemplate(id, version)),
        updateCalculationMetadata: (id, updates) => perform(() => updateCalculationMetadata(id, updates)),
        isLoading: isLoading || authLoading || loadedFor !== sessionKey,
        loadError,
        actionError,
        clearActionError: () => setActionError(null),
        retryLoad: () => { void refreshAll(); },
        theme,
        setTheme,
        addMaterial: (m) => perform(() => addMaterial(m)),
        updateMaterial: (id, updates) => perform(() => updateMaterial(id, updates)),
        duplicateMaterial: (id) => perform(() => duplicateMaterial(id)),
        archiveMaterial: (id) => perform(() => archiveMaterial(id)),
        deleteMaterial: (id) => perform(() => deleteMaterial(id)),
        addPrinter: (p) => perform(() => addPrinter(p)),
        updatePrinter: (id, updates) => perform(() => updatePrinter(id, updates)),
        deletePrinter: (id) => perform(() => deletePrinter(id)),
        setDefaultPrinter: (id) => perform(() => setDefaultPrinter(id)),
        updateSettings: (updates) => perform(() => updateSettings(updates)),
        exportSettings: () => perform(exportSettings),
        importSettings: (json) => perform(() => importSettings(json)),
        resetSettings: () => perform(resetSettings),
        saveCalculation: (calc) => perform(() => saveCalculation(calc)),
        duplicateCalculation: (id) => perform(() => duplicateCalculation(id)),
        deleteCalculation: (id) => perform(() => deleteCalculation(id)),
        findBestMaterialMatch,
        saveFilamentMapping: (type, id) => perform(() => saveFilamentMapping(type, id)),
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
