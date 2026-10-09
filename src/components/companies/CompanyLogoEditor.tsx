import React, { useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import type { Company } from '../../domain/organizations.ts';
import type { CompanyLogo as CompanyLogoRecord } from '../../domain/companyLogos.ts';
import { companyLogoRepository } from '../../services/companyLogoRepository.ts';
import { prepareCompanyLogo } from '../../services/companyLogoImage.ts';
import { authErrorMessage, authService } from '../../services/authService.ts';
import { Button } from '../common/Button.tsx';
import { CompanyLogo } from './CompanyLogo.tsx';

export const CompanyLogoEditor: React.FC<{ company: Company }> = ({ company }) => {
  const { user, isDemoSession } = useAuth();
  const canEdit = !isDemoSession && !!user?.emailVerified && !user.isBlocked && (user.role === 'admin' || (user.role === 'manager' && user.companyId === company.id && company.status === 'active'));
  const identity = `${user?.id}:${user?.role}:${user?.companyId}:${canEdit}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const request = useRef(0);
  const operation = useRef(false);
  const inputId = useId();
  const [saved, setSaved] = useState<CompanyLogoRecord | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const busy = loading || preparing || saving;
  const dirty = draft !== (saved?.imageDataUrl ?? null);

  const load = async () => {
    if (!canEdit || operation.current) return;
    operation.current = true;
    const generation = ++request.current;
    const account = user!.id;
    setLoading(true); setReady(false); setError(null); setSuccess(null); setDraft(null); setSaved(null);
    try {
      const logo = await companyLogoRepository.get(company.id);
      authService.assertSession(account);
      if (generation !== request.current || identity !== currentIdentity.current) return;
      setSaved(logo); setDraft(logo?.imageDataUrl ?? null); setReady(true);
    } catch (error) { if (generation === request.current && identity === currentIdentity.current) setError(authErrorMessage(error)); }
    finally { if (generation === request.current) { operation.current = false; setLoading(false); } }
  };

  useEffect(() => {
    ++request.current; operation.current = false;
    setSaved(null); setDraft(null); setReady(false); setLoading(false); setPreparing(false); setSaving(false); setError(null); setSuccess(null);
    if (canEdit) void load();
    return () => { ++request.current; operation.current = false; };
  }, [company.id, identity]);

  const chooseFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canEdit || !ready || operation.current) return;
    operation.current = true;
    const generation = request.current;
    const account = user!.id;
    setPreparing(true); setError(null); setSuccess(null);
    try {
      const image = await prepareCompanyLogo(file);
      authService.assertSession(account);
      if (generation !== request.current || identity !== currentIdentity.current) return;
      setDraft(image);
    } catch (error) { if (generation === request.current && identity === currentIdentity.current) setError(authErrorMessage(error)); }
    finally { if (generation === request.current) { operation.current = false; setPreparing(false); } }
  };

  const save = async () => {
    if (!canEdit || !ready || !dirty || operation.current) return;
    operation.current = true;
    const generation = request.current;
    const account = user!.id;
    setSaving(true); setError(null); setSuccess(null);
    try {
      const logo = await companyLogoRepository.save(company.id, draft, saved?.version ?? 0);
      authService.assertSession(account);
      if (generation !== request.current || identity !== currentIdentity.current) return;
      setSaved(logo); setDraft(logo.imageDataUrl); setSuccess(logo.imageDataUrl ? 'Логотип компанії збережено.' : 'Логотип компанії прибрано.');
    } catch (error) {
      if (generation === request.current && identity === currentIdentity.current) { setError(authErrorMessage(error)); setReady(false); }
    } finally { if (generation === request.current) { operation.current = false; setSaving(false); } }
  };

  return <section className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-3" aria-label="Логотип компанії">
    <div className="flex items-center gap-3"><CompanyLogo name={company.name} imageDataUrl={draft} className="h-16 w-16" /><div><h4 className="text-sm font-semibold">Логотип компанії</h4><p className="text-xs text-neutral-500 dark:text-neutral-400">PNG, JPEG або WebP до 2 МБ. Збережене зображення: 128 × 128.</p>{dirty && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Попередній перегляд. Зміни ще не збережено.</p>}</div></div>
    {!canEdit && <p className="text-xs text-neutral-500 dark:text-neutral-400">Змінити логотип може адміністратор або менеджер цієї активної компанії.</p>}
    {loading && <p role="status" className="text-xs text-neutral-500 dark:text-neutral-400">Завантаження логотипа…</p>}
    {preparing && <p role="status" className="text-xs text-neutral-500 dark:text-neutral-400">Підготовка зображення…</p>}
    {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
    {success && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">{success}</p>}
    <div className="space-y-1"><label htmlFor={inputId} className="block text-xs font-medium">Обрати зображення логотипа</label><input id={inputId} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Обрати зображення логотипа" disabled={!canEdit || !ready || busy} onChange={event => { void chooseFile(event); }} className="block w-full text-xs file:mr-3 file:rounded-md file:border file:border-neutral-300 dark:file:border-neutral-700 file:px-3 file:py-2 file:bg-white dark:file:bg-neutral-800 file:text-neutral-800 dark:file:text-neutral-200 disabled:opacity-50" /></div>
    <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => { void save(); }} disabled={!canEdit || !ready || !dirty || busy} isLoading={saving}>Зберегти логотип</Button><Button size="sm" variant="outline" onClick={() => { setDraft(saved?.imageDataUrl ?? null); setError(null); setSuccess(null); }} disabled={!dirty || busy}>Скасувати зміни</Button><Button size="sm" variant="outline" onClick={() => { setDraft(null); setError(null); setSuccess(null); }} disabled={!canEdit || !ready || !draft || busy}>Прибрати логотип</Button><Button size="sm" variant="ghost" onClick={() => { void load(); }} disabled={!canEdit || busy}>Оновити збережений логотип</Button></div>
  </section>;
};
