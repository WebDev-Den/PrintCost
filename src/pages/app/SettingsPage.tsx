import React, { useEffect, useRef, useState } from 'react';
import {
  Settings as SettingsIcon,
  Zap,
  DollarSign,
  Shield,
  Layers,
  Moon,
  Sun,
  FileDown,
  FileUp,
  RotateCcw,
  Check,
} from 'lucide-react';
import { useAppData } from '../../context/AppDataContext.tsx';
import { NumberInput } from '../../components/common/NumberInput.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Modal } from '../../components/common/Modal.tsx';
import type { PricingMode, RoundingMode } from '../../domain/types.ts';
import { DEFAULT_TAX_SETTINGS } from '../../domain/taxes.ts';
import { TaxSettingsPanel } from '../../components/calculator/TaxSettingsPanel.tsx';

export const SettingsPage: React.FC = () => {
  const {
    settings,
    updateSettings,
    exportSettings,
    importSettings,
    resetSettings,
    theme,
    setTheme,
  } = useAppData();

  const [form, setForm] = useState(() => ({ ...settings, tax: { ...DEFAULT_TAX_SETTINGS, ...settings.tax }, electricityTariffUahPerKwh: settings.electricityTariffUahPerKwh ?? '', defaultPrinterId: settings.defaultPrinterId ?? '' }));
  const [formVersion, setFormVersion] = useState(0);
  useEffect(() => {
    setForm({ ...settings, tax: { ...DEFAULT_TAX_SETTINGS, ...settings.tax }, electricityTariffUahPerKwh: settings.electricityTariffUahPerKwh ?? '', defaultPrinterId: settings.defaultPrinterId ?? '' });
  }, [settings.electricityTariffUahPerKwh, settings.pricingMode, settings.defaultMarkupPercent, settings.defaultMarginPercent,
    settings.scrapReservePercent, settings.minOrderPriceUah, settings.roundingMode, settings.defaultOperatorFeeUah,
    settings.defaultPackagingFeeUah, settings.defaultPostProcessingFeeUah, settings.defaultOtherFeeUah, settings.defaultPrinterId, settings.timezone, settings.tax, formVersion]);

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [showImportBox, setShowImportBox] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const busy = useRef(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setIsPending(true);
    setSavedSuccess(false);
    setError(null);
    try {
    await updateSettings({
      electricityTariffUahPerKwh: form.electricityTariffUahPerKwh.trim() || null,
      pricingMode: form.pricingMode as PricingMode,
      defaultMarkupPercent: form.defaultMarkupPercent,
      defaultMarginPercent: form.defaultMarginPercent,
      scrapReservePercent: form.scrapReservePercent,
      minOrderPriceUah: form.minOrderPriceUah,
      roundingMode: form.roundingMode as RoundingMode,
      defaultOperatorFeeUah: form.defaultOperatorFeeUah,
      defaultPackagingFeeUah: form.defaultPackagingFeeUah,
      defaultPostProcessingFeeUah: form.defaultPostProcessingFeeUah,
      defaultOtherFeeUah: form.defaultOtherFeeUah,
      defaultPrinterId: form.defaultPrinterId || null,
      timezone: form.timezone,
      tax: form.tax,
    });
    setSavedSuccess(true);
    } catch (error) { setError(error instanceof Error ? error.message : 'Не вдалося зберегти налаштування.'); }
    finally { busy.current = false; setIsPending(false); }
  };

  const handleExport = async () => {
    if (busy.current) return;
    busy.current = true;
    setIsPending(true);
    setError(null);
    try {
    const jsonStr = await exportSettings();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'printcost_settings_backup.json';
    a.click();
    URL.revokeObjectURL(url);
    } catch (error) { setError(error instanceof Error ? error.message : 'Не вдалося експортувати налаштування.'); }
    finally { busy.current = false; setIsPending(false); }
  };

  const handleImport = async () => {
    if (busy.current) return;
    busy.current = true;
    setIsPending(true);
    setSavedSuccess(false);
    setImportError(null);
    try {
      await importSettings(importJsonText);
      setFormVersion(version => version + 1);
      setShowImportBox(false);
      setImportJsonText('');
      setSavedSuccess(true);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Не вдалося імпортувати налаштування.');
    } finally { busy.current = false; setIsPending(false); }
  };

  const handleConfirmReset = async () => {
    if (busy.current) return;
    busy.current = true;
    setIsPending(true);
    setSavedSuccess(false);
    setError(null);
    try {
    await resetSettings();
    setFormVersion(version => version + 1);
    setIsResetConfirmOpen(false);
    setSavedSuccess(true);
    } catch (error) { setError(error instanceof Error ? error.message : 'Не вдалося скинути налаштування.'); }
    finally { busy.current = false; setIsPending(false); }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">
            Глобальні налаштування майстерні
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            Типові тарифи, коефіцієнти маржі та правила округлення для нових розрахунків
          </p>
        </div>

        {savedSuccess && (
          <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <Check className="w-4 h-4" /> Налаштування збережено
          </span>
        )}
      </div>

      <form onSubmit={handleSave} onChange={() => setSavedSuccess(false)} className="space-y-6">
        {/* Section 1: Energy */}
        <div className="bg-white dark:bg-neutral-900 p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-4 shadow-2xs">
          <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-3">
            <Zap className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
              Електроенергія
            </h3>
          </div>

          <div className="max-w-xs">
            <NumberInput
              label="Тариф на електроенергію майстерні"
              unit="грн/кВт·год"
              value={form.electricityTariffUahPerKwh}
              onChange={(v) => setForm({ ...form, electricityTariffUahPerKwh: v })}
              placeholder="5.00"
              helperText="Враховує комерційний або побутовий тариф вашого приміщення."
            />
          </div>
        </div>

        {/* Section 2: Pricing & Margins */}
        <div className="bg-white dark:bg-neutral-900 p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-4 shadow-2xs">
          <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-3">
            <DollarSign className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
              Ціноутворення та комерційні правила
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Типовий режим розрахунку ціни
              </label>
              <select
                value={form.pricingMode}
                onChange={(e) => setForm({ ...form, pricingMode: e.target.value as PricingMode })}
                className="w-full py-2 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
              >
                <option value="markup">Націнка на собівартість (%)</option>
                <option value="target_margin">Цільова маржа від ціни продажу (%)</option>
              </select>
            </div>

            <NumberInput
              label="Типова націнка на собівартість"
              unit="%"
              value={form.defaultMarkupPercent}
              onChange={(v) => setForm({ ...form, defaultMarkupPercent: v })}
              placeholder="100"
            />

            <NumberInput
              label="Типова цільова маржа"
              unit="%"
              value={form.defaultMarginPercent}
              onChange={(v) => setForm({ ...form, defaultMarginPercent: v })}
              placeholder="50"
            />

            <NumberInput
              label="Резерв на технічний брак / ризики"
              unit="%"
              value={form.scrapReservePercent}
              onChange={(v) => setForm({ ...form, scrapReservePercent: v })}
              placeholder="10"
              helperText="Накладається на базову собівартість."
            />

            <NumberInput
              label="Мінімальна вартість замовлення"
              unit="грн"
              value={form.minOrderPriceUah}
              onChange={(v) => setForm({ ...form, minOrderPriceUah: v })}
              placeholder="200"
              helperText="Застосовується до всього замовлення один раз."
            />

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Округлення ціни клієнту
              </label>
              <select
                value={form.roundingMode}
                onChange={(e) => setForm({ ...form, roundingMode: e.target.value as RoundingMode })}
                className="w-full py-2 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
              >
                <option value="none">Без округлення</option>
                <option value="up_1">Вгору до 1 грн</option>
                <option value="up_5">Вгору до 5 грн</option>
                <option value="up_10">Вгору до 10 грн</option>
                <option value="up_50">Вгору до 50 грн</option>
                <option value="up_100">Вгору до 100 грн</option>
              </select>
            </div>
          </div>
        </div>

        {/* Section 3: Default Order Labor & Prep Fees */}
        <div className="bg-white dark:bg-neutral-900 p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-4 shadow-2xs">
          <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-3">
            <Shield className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
              Фіксовані супутні витрати на замовлення
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <NumberInput
              label="Робота оператора"
              unit="грн"
              value={form.defaultOperatorFeeUah}
              onChange={(v) => setForm({ ...form, defaultOperatorFeeUah: v })}
              placeholder="20"
            />
            <NumberInput
              label="Пакування"
              unit="грн"
              value={form.defaultPackagingFeeUah}
              onChange={(v) => setForm({ ...form, defaultPackagingFeeUah: v })}
              placeholder="0"
            />
            <NumberInput
              label="Постобробка"
              unit="грн"
              value={form.defaultPostProcessingFeeUah}
              onChange={(v) => setForm({ ...form, defaultPostProcessingFeeUah: v })}
              placeholder="0"
            />
            <NumberInput
              label="Інші витрати"
              unit="грн"
              value={form.defaultOtherFeeUah}
              onChange={(v) => setForm({ ...form, defaultOtherFeeUah: v })}
              placeholder="0"
            />
          </div>
        </div>

        <TaxSettingsPanel value={form.tax} onChange={tax => { setForm({ ...form, tax }); setSavedSuccess(false); }} disabled={isPending} />

        {/* Section 4: Interface & System */}
        <div className="bg-white dark:bg-neutral-900 p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-4 shadow-2xs">
          <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-3">
            <SettingsIcon className="w-4 h-4 text-neutral-600" />
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
              Інтерфейс та локалізація
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Тема оформлення
              </label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={theme === 'light' ? 'primary' : 'outline'}
                  size="sm"
                  leftIcon={<Sun className="w-3.5 h-3.5" />}
                  onClick={() => setTheme('light')}
                >
                  Світла
                </Button>
                <Button
                  type="button"
                  variant={theme === 'dark' ? 'primary' : 'outline'}
                  size="sm"
                  leftIcon={<Moon className="w-3.5 h-3.5" />}
                  onClick={() => setTheme('dark')}
                >
                  Темна
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Часовий пояс
              </label>
              <input
                type="text"
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                className="w-full py-2 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
              />
            </div>
          </div>
        </div>

        {/* Save button */}
        <div className="flex items-center justify-between pt-2">
          <Button type="submit" variant="primary" size="md" isLoading={isPending}>
            Зберегти зміни в налаштуваннях
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            leftIcon={<RotateCcw className="w-3.5 h-3.5 text-neutral-400" />}
            onClick={() => setIsResetConfirmOpen(true)}
            disabled={isPending}
          >
            Скинути до типових
          </Button>
        </div>
      </form>

      {/* Export / Import Box */}
      <div className="bg-neutral-50 dark:bg-neutral-900/50 p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-3">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
          Резервне копіювання конфігурації (JSON)
        </h3>
        <p className="text-xs text-neutral-500">
          Ви можете експортувати поточні налаштування майстерні у JSON або відновити їх на іншому комп'ютері.
        </p>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<FileDown className="w-3.5 h-3.5" />}
            onClick={handleExport}
            disabled={isPending}
          >
            Експортувати налаштування
          </Button>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<FileUp className="w-3.5 h-3.5" />}
            onClick={() => setShowImportBox(!showImportBox)}
            disabled={isPending}
          >
            Імпортувати з JSON
          </Button>
        </div>

        {showImportBox && (
          <div className="space-y-2 pt-2">
            <textarea
              rows={4}
              value={importJsonText}
              onChange={(e) => {
                setImportJsonText(e.target.value);
                setImportError(null);
              }}
              placeholder="Вставте сюди вміст JSON-файлу конфігурації..."
              className="w-full p-2.5 text-xs font-mono rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
            />
            {importError && (
              <p role="alert" className="text-xs text-rose-600 font-medium">{importError}</p>
            )}
            <Button variant="primary" size="sm" onClick={handleImport} isLoading={isPending}>
              Застосувати імпортований JSON
            </Button>
          </div>
        )}
      </div>

      {/* Confirmation Modal for Reset Settings */}
      <Modal
        isOpen={isResetConfirmOpen}
        onClose={() => { if (!isPending) setIsResetConfirmOpen(false); }}
        title="Скинути налаштування?"
        description="Тарифи та правила ціноутворення повернуться до типових значень."
        maxWidth="sm"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setIsResetConfirmOpen(false)} disabled={isPending}>
              Скасувати
            </Button>
            <Button variant="danger" size="sm" onClick={handleConfirmReset} isLoading={isPending}>
              Підтвердити скидання
            </Button>
          </>
        }
      >
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          Ви впевнені, що хочете скинути всі налаштування ціноутворення? Матеріали, принтери та розрахунки залишаться у вашому акаунті.
        </p>
      </Modal>
    </div>
  );
};
