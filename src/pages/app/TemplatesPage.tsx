import React, { useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../../context/AppDataContext.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';
import { Modal } from '../../components/common/Modal.tsx';
import type { CalculationTemplate } from '../../domain/types.ts';
import { isCompatibleMaterial, isKnownMaterialType, normalizeMaterialType } from '../../domain/materialMatching.ts';

export const TemplatesPage: React.FC = () => {
  const navigate = useNavigate();
  const { templates, settings, printers, materials, createTemplate, updateTemplate, deleteTemplate, updateSettings } = useAppData();
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [editName, setEditName] = useState('');
  const [editing, setEditing] = useState<CalculationTemplate | null>(null);
  const [deleting, setDeleting] = useState<CalculationTemplate | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const busy = useRef(false);
  const visible = useMemo(() => templates.filter(template => template.name.toLowerCase().includes(search.trim().toLowerCase())), [templates, search]);
  const perform = async (operation: () => Promise<unknown>, message: string) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null); setSuccess(null);
    try { await operation(); setSuccess(message); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не вдалося змінити шаблон.'); }
    finally { busy.current = false; setPending(false); }
  };
  const createFromDefaults = () => perform(async () => {
    const printer = printers.find(item => item.id === settings.defaultPrinterId) || printers.find(item => item.isDefault) || null;
    if (!printer) throw new Error('Оберіть типовий принтер у розділі «Принтери» або створіть шаблон у калькуляторі з явно заданими параметрами.');
    const materialMappings: Record<string, string> = {};
    for (const [type, id] of Object.entries(settings.filamentMappingPresets)) {
      if (isKnownMaterialType(type) && isCompatibleMaterial(materials.find(item => item.id === id), type)) materialMappings[normalizeMaterialType(type)] = id;
    }
    await createTemplate({ name: name.trim(), materialMappings, parameters: {
      selectedPrinterId: printer.id, averagePowerWatts: printer.averagePowerWatts, machineHourlyRateUah: printer.machineHourlyRateUah,
      electricityTariffUahPerKwh: settings.electricityTariffUahPerKwh, operatorFeeUah: settings.defaultOperatorFeeUah, packagingFeeUah: settings.defaultPackagingFeeUah,
      postProcessingFeeUah: settings.defaultPostProcessingFeeUah, otherFeeUah: settings.defaultOtherFeeUah, scrapReservePercent: settings.scrapReservePercent,
      pricingMode: settings.pricingMode, markupPercent: settings.defaultMarkupPercent, marginPercent: settings.defaultMarginPercent,
      minOrderPriceUah: settings.minOrderPriceUah, roundingMode: settings.roundingMode, ...(settings.tax ? { tax: structuredClone(settings.tax) } : {}),
    } });
    setName('');
  }, 'Шаблон створено з типових налаштувань.');
  return <div className="space-y-5">
    <div><h1 className="text-xl font-bold text-neutral-900 dark:text-white">Шаблони розрахунку</h1><p className="mt-1 text-xs text-neutral-500">Ваші тарифи, принтер, податки та правила вибору матеріалів. Завантажений файл і його пластини до шаблону не входять.</p></div>
    {error && <p role="alert" className="rounded-lg p-3 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</p>}
    {success && <p role="status" className="rounded-lg p-3 bg-emerald-50 dark:bg-emerald-950/30 text-sm text-emerald-700 dark:text-emerald-400">{success}</p>}
    <form onSubmit={event => { event.preventDefault(); void createFromDefaults(); }} className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-3">
      <Input label="Назва нового шаблону" value={name} onChange={event => setName(event.target.value)} maxLength={100} required disabled={pending} />
      <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={pending || !name.trim()}>Створити з типових налаштувань</Button><Button type="button" variant="outline" size="sm" onClick={() => navigate('/app/calculator')}>Зберегти поточний розрахунок як шаблон</Button></div>
    </form>
    <Input label="Пошук ваших шаблонів" value={search} onChange={event => setSearch(event.target.value)} />
    <p className="text-xs text-neutral-500">Шаблонів: {templates.length}. Знайдено: {visible.length}.</p>
    {visible.length === 0 && <p className="p-6 text-center text-sm text-neutral-500">Шаблонів за цим пошуком немає.</p>}
    <div className="space-y-3">{visible.map(template => {
      const missingPrinter = Boolean(template.parameters.selectedPrinterId && !printers.some(printer => printer.id === template.parameters.selectedPrinterId));
      const staleMappings = Object.entries(template.materialMappings).filter(([type, id]) => !isCompatibleMaterial(materials.find(material => material.id === id), type)).length;
      return <article key={template.id} className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-3">
        <div className="flex justify-between gap-3"><h2 className="font-semibold text-neutral-900 dark:text-white break-words">{template.name}{settings.defaultTemplateId === template.id && <span className="ml-2 text-xs font-normal text-emerald-600">Типовий</span>}</h2><span className="text-xs text-neutral-500 shrink-0">Версія {template.version}</span></div>
        <p className="text-xs text-neutral-500">{template.parameters.pricingMode === 'markup' ? `Націнка ${template.parameters.markupPercent}%` : `Маржа ${template.parameters.marginPercent}%`} · Правил матеріалів: {Object.keys(template.materialMappings).length} · {template.parameters.tax?.enabled ? 'Податки увімкнено' : 'Без податкової оцінки'}</p>
        {(missingPrinter || staleMappings > 0) && <p className="text-xs text-amber-700 dark:text-amber-400">{missingPrinter && 'Принтер видалено. '}{staleMappings > 0 && `Неактуальних правил матеріалів: ${staleMappings}. `}Під час застосування ці посилання буде очищено; потрібен ваш вибір.</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => navigate('/app/calculator', { state: { templateId: template.id } })} disabled={pending}>Застосувати в калькуляторі</Button>
          <Button size="sm" variant="outline" onClick={() => { setEditing(template); setEditName(template.name); setError(null); }} disabled={pending}>Перейменувати</Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/app/calculator', { state: { templateId: template.id, editTemplate: true } })} disabled={pending}>Редагувати параметри</Button>
          <Button size="sm" variant="outline" onClick={() => { void perform(() => createTemplate({ name: `${template.name.slice(0, 90)} (копія)`, parameters: structuredClone(template.parameters), materialMappings: { ...template.materialMappings } }), 'Копію шаблону створено.'); }} disabled={pending}>Копіювати</Button>
          <Button size="sm" variant="outline" onClick={() => { void perform(() => updateSettings({ defaultTemplateId: settings.defaultTemplateId === template.id ? null : template.id }), settings.defaultTemplateId === template.id ? 'Типовий шаблон вимкнено.' : 'Типовий шаблон призначено.'); }} disabled={pending}>{settings.defaultTemplateId === template.id ? 'Прибрати типовий' : 'Зробити типовим'}</Button>
          <Button size="sm" variant="danger" onClick={() => { setDeleting(template); setError(null); }} disabled={pending}>Видалити</Button>
        </div>
      </article>;
    })}</div>
    <Modal isOpen={Boolean(editing)} onClose={() => { if (!pending) setEditing(null); }} title="Перейменувати шаблон" footer={<><Button size="sm" variant="outline" onClick={() => setEditing(null)} disabled={pending}>Скасувати</Button><Button size="sm" isLoading={pending} disabled={!editName.trim()} onClick={() => { if (editing) void perform(async () => { await updateTemplate(editing.id, editing.version, { name: editName.trim() }); setEditing(null); }, 'Назву шаблону збережено.'); }}>Зберегти</Button></>}>
      <Input label="Нова назва шаблону" value={editName} onChange={event => setEditName(event.target.value)} maxLength={100} disabled={pending} />{error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </Modal>
    <Modal isOpen={Boolean(deleting)} onClose={() => { if (!pending) setDeleting(null); }} title="Видалити шаблон?" footer={<><Button size="sm" variant="outline" onClick={() => setDeleting(null)} disabled={pending}>Скасувати</Button><Button size="sm" variant="danger" isLoading={pending} onClick={() => { if (deleting) void perform(async () => { await deleteTemplate(deleting.id, deleting.version); setDeleting(null); }, 'Шаблон видалено.'); }}>Видалити</Button></>}><p className="text-sm text-neutral-600 dark:text-neutral-400">Шаблон «{deleting?.name}» буде видалено. Збережені розрахунки лишаться у вашій історії.</p>{error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}</Modal>
  </div>;
};
