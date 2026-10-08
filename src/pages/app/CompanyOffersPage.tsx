import React, { useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, useSearchParams } from 'react-router-dom';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';
import { Modal } from '../../components/common/Modal.tsx';
import { COLOR_TONES_CONFIG, type ColorTone } from '../../domain/filamentsDirectory.ts';
import type { Company } from '../../domain/organizations.ts';
import { OFFER_FAMILIES, type CompanyOffer, type CompanyOfferInput } from '../../domain/companyOffers.ts';
import { companyOfferRepository } from '../../services/companyOfferRepository.ts';
import { organizationRepository } from '../../services/organizationRepository.ts';
import { authErrorMessage, authService } from '../../services/authService.ts';
import { formatUah } from '../../domain/formatters.ts';
import { CompanyLogoEditor } from '../../components/companies/CompanyLogoEditor.tsx';

const statusLabels = { published: 'Опубліковано', hidden: 'Приховано', blocked: 'Заблоковано адміністратором' };
const selectClass = 'w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white disabled:opacity-50';
const initialOffer: CompanyOfferInput = { name: '', brand: '', type: 'PLA', family: 'Стандартні', colorName: '', colorHex: '#ffffff', colorTone: 'white', packagingType: 'spool', spoolWeightGrams: 1000, priceUah: 0, diameterMm: 1.75, description: '', productUrl: '', inStock: true, status: 'published' };

export const CompanyOffersPage: React.FC = () => {
  const { user, isDemoSession } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedCompanyId = searchParams.get('companyId') || '';
  const isAdmin = user?.role === 'admin';
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [offers, setOffers] = useState<CompanyOffer[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<CompanyOffer | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<CompanyOfferInput>(initialOffer);
  const companyRequest = useRef(0);
  const offerRequest = useRef(0);

  useEffect(() => {
    const version = ++companyRequest.current;
    ++offerRequest.current;
    setCompanies([]); setCompanyId(''); setOffers([]); setCursor(null); setFormOpen(false); setError(null); setLoading(true);
    const identity = user?.id || '';
    const load = async () => {
      try {
        const available = isAdmin ? await organizationRepository.listCompanies() : user?.companyId ? [await organizationRepository.getCompany(user.companyId)].filter((company): company is Company => !!company) : [];
        authService.assertSession(identity);
        if (version !== companyRequest.current) return;
        setCompanies(available); setCompanyId(isAdmin && available.some(company => company.id === requestedCompanyId) ? requestedCompanyId : available[0]?.id || '');
      } catch (error) { if (version === companyRequest.current) setError(authErrorMessage(error)); }
      finally { if (version === companyRequest.current) setLoading(false); }
    };
    if (!isDemoSession && (isAdmin || user?.role === 'manager')) void load();
    return () => { ++companyRequest.current; ++offerRequest.current; };
  }, [user?.id, user?.role, user?.companyId, isDemoSession, requestedCompanyId]);

  const loadOffers = async (more = false) => {
    if (!companyId) return;
    const version = ++offerRequest.current;
    const identity = user?.id || '';
    setLoading(true); setError(null);
    try {
      const page = await companyOfferRepository.getForCompany(companyId, more && cursor ? cursor : undefined);
      authService.assertSession(identity);
      if (version !== offerRequest.current) return;
      setOffers(previous => more ? [...previous, ...page.items.filter(item => !previous.some(existing => existing.id === item.id))] : page.items);
      setCursor(page.nextCursor);
    } catch (error) { if (version === offerRequest.current) setError(authErrorMessage(error)); }
    finally { if (version === offerRequest.current) setLoading(false); }
  };

  useEffect(() => {
    setOffers([]); setCursor(null); setSearch(''); setFormOpen(false); setSuccess(null);
    if (companyId) void loadOffers();
    return () => { ++offerRequest.current; };
  }, [companyId]);

  const company = companies.find(item => item.id === companyId);
  const canEditCompany = !!company && (isAdmin || (user?.role === 'manager' && user.companyId === company.id && company.status === 'active'));
  const openEditor = (offer: CompanyOffer | null) => {
    setEditing(offer); setError(null); setSuccess(null);
    setDraft(offer ? { name: offer.name, brand: offer.brand, type: offer.type, family: offer.family,
      colorName: offer.colorName, colorHex: offer.colorHex, colorTone: offer.colorTone, packagingType: offer.packagingType,
      spoolWeightGrams: offer.spoolWeightGrams, priceUah: offer.priceUah, diameterMm: offer.diameterMm,
      description: offer.description, productUrl: offer.productUrl, inStock: offer.inStock, status: offer.status }
      : { ...initialOffer, status: company?.status === 'active' ? 'published' : 'hidden' });
    setFormOpen(true);
  };
  const applyResult = (offer: CompanyOffer) => {
    setOffers(previous => previous.some(item => item.id === offer.id) ? previous.map(item => item.id === offer.id ? offer : item) : [offer, ...previous]);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canEditCompany || !company) return;
    setBusy(true); setError(null); setSuccess(null);
    const identity = user!.id;
    const version = offerRequest.current;
    try {
      const saved = await companyOfferRepository.save({ ...draft, companyId: company.id, ...(editing ? { id: editing.id, version: editing.version } : {}) });
      authService.assertSession(identity);
      if (version !== offerRequest.current) return;
      applyResult(saved); setFormOpen(false); setSuccess(saved.status === 'published' && company.status === 'active' ? 'Пропозицію збережено та опубліковано в каталозі.' : 'Пропозицію збережено.');
    } catch (error) { if (version === offerRequest.current) setError(authErrorMessage(error)); }
    finally { setBusy(false); }
  };
  const changeStatus = async (offer: CompanyOffer, status: CompanyOffer['status']) => {
    setBusy(true); setError(null); setSuccess(null);
    const identity = user!.id;
    const version = offerRequest.current;
    try {
      const changed = await companyOfferRepository.setStatus(offer.id, status, offer.version);
      authService.assertSession(identity);
      if (version !== offerRequest.current) return;
      applyResult(changed); setSuccess(status === 'published' ? 'Пропозицію опубліковано.' : status === 'hidden' ? 'Пропозицію приховано.' : 'Пропозицію заблоковано.');
    } catch (error) { if (version === offerRequest.current) setError(authErrorMessage(error)); }
    finally { setBusy(false); }
  };

  if (isDemoSession || !user?.emailVerified || user.isBlocked || !['manager', 'admin'].includes(user.role || 'user')) return <Navigate to="/app/dashboard" replace />;
  const term = search.trim().toLocaleLowerCase('uk');
  const visible = offers.filter(offer => `${offer.name} ${offer.brand} ${offer.type} ${offer.colorName}`.toLocaleLowerCase('uk').includes(term));
  const offerLocked = !canEditCompany || (!isAdmin && editing?.status === 'blocked');

  return <div className="max-w-6xl space-y-5 text-neutral-900 dark:text-white">
    <div className="flex flex-wrap justify-between items-start gap-3"><div><h2 className="text-xl font-bold">Пропозиції компанії</h2><p className="text-xs text-neutral-500 mt-1">Власні пластики, ціни та прямі посилання. Опубліковані зміни одразу доступні у каталозі.</p></div><NavLink to="/filaments"><Button variant="outline" size="sm">Відкрити каталог</Button></NavLink></div>
    {isAdmin && <label className="block text-xs space-y-1.5"><span>Компанія</span><select aria-label="Компанія для керування пропозиціями" className={selectClass} value={companyId} onChange={event => setCompanyId(event.target.value)} disabled={busy || loading}><option value="">Оберіть компанію</option>{companies.map(item => <option key={item.id} value={item.id}>{item.name}{item.status === 'disabled' ? ' · призупинено' : ''}</option>)}</select></label>}
    {error && <p role="alert" className="p-3 text-sm rounded-lg text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30">{error}</p>}
    {success && <p role="status" className="p-3 text-sm rounded-lg text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30">{success}</p>}
    {loading && <p role="status" className="text-sm text-neutral-500">Завантаження…</p>}
    {!loading && !company && <p className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 text-sm">{isAdmin ? 'Спочатку створіть компанію у розділі «Користувачі та компанії».' : 'Компанію не призначено. Зверніться до адміністратора.'}</p>}
    {company && <>
      <div className="flex flex-wrap justify-between items-center gap-3"><div><h3 className="font-semibold">{company.name}</h3><p className="text-xs text-neutral-500">Дозволені магазини: {company.allowedDomains.join(', ')}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" disabled={loading || busy} onClick={() => { void loadOffers(); }}>Оновити пропозиції</Button><Button size="sm" onClick={() => openEditor(null)} disabled={loading || busy || !canEditCompany}>Додати пластик</Button></div></div>
      {company.status === 'disabled' && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">Компанію призупинено. Її пропозиції не показуються у публічному каталозі. Адміністратор може редагувати дані.</p>}
      <CompanyLogoEditor key={`${company.id}:${user.id}`} company={company} />
      <Input id="company-offer-search" label="Пошук власних пропозицій" value={search} onChange={event => setSearch(event.target.value)} helperText={`Серед ${offers.length} завантажених записів${cursor ? '; наступні доступні нижче' : ''}.`} />
      <div className="space-y-3">{visible.map(offer => <article key={offer.id} className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <div className="flex flex-wrap justify-between gap-3"><div><h4 className="font-semibold">{offer.name}</h4><p className="text-xs text-neutral-500 mt-1">{offer.brand} · {offer.type} · {offer.colorName} · {offer.spoolWeightGrams} г · {offer.packagingType === 'refill' ? 'Рефіл' : 'З котушкою'}</p><p className="text-sm mt-2">{formatUah(offer.priceUah)} за упаковку · {formatUah(offer.priceUah / offer.spoolWeightGrams * 1000)} / кг</p><p className="text-xs mt-1">{statusLabels[offer.status]} · {offer.inStock ? 'В наявності' : 'Немає в наявності'}</p><a href={offer.productUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-600 underline">Сторінка товару</a></div>
          <div className="flex flex-wrap items-start gap-2"><Button variant="outline" size="sm" onClick={() => openEditor(offer)} disabled={busy || (!isAdmin && offer.status === 'blocked')}>Редагувати</Button>
            {offer.status !== 'blocked' && <Button variant="outline" size="sm" disabled={busy || !canEditCompany || (offer.status !== 'published' && company.status !== 'active')} onClick={() => { void changeStatus(offer, offer.status === 'published' ? 'hidden' : 'published'); }}>{offer.status === 'published' ? 'Приховати' : 'Опублікувати'}</Button>}
            {isAdmin && <Button variant={offer.status === 'blocked' ? 'outline' : 'danger'} size="sm" disabled={busy} onClick={() => { void changeStatus(offer, offer.status === 'blocked' ? 'hidden' : 'blocked'); }}>{offer.status === 'blocked' ? 'Розблокувати й приховати' : 'Заблокувати'}</Button>}
          </div></div>
      </article>)}</div>
      {!visible.length && !loading && <p className="text-sm text-neutral-500">Пропозицій не знайдено серед завантажених записів.</p>}
      {cursor && <Button variant="outline" size="sm" onClick={() => { void loadOffers(true); }} disabled={loading || busy}>Завантажити ще пропозиції</Button>}
    </>}
    <Modal isOpen={formOpen} onClose={() => { if (!busy) setFormOpen(false); }} title={editing ? 'Редагування пропозиції' : 'Новий пластик компанії'} description="Заповніть характеристики конкретного кольору та упаковки."
      footer={<><Button variant="outline" size="sm" onClick={() => setFormOpen(false)} disabled={busy}>Скасувати</Button><Button type="submit" form="company-offer-form" size="sm" isLoading={busy} disabled={offerLocked}>Зберегти пропозицію</Button></>}>
      <form id="company-offer-form" onSubmit={save} className="space-y-4">
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {offerLocked && <p className="text-sm text-amber-700">Ця пропозиція недоступна для редагування.</p>}
        <fieldset disabled={busy || offerLocked} className="space-y-4">
          <Input id="offer-name" label="Назва товару" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} maxLength={200} required />
          <div className="grid sm:grid-cols-2 gap-3"><Input id="offer-brand" label="Бренд" value={draft.brand} onChange={event => setDraft({ ...draft, brand: event.target.value })} maxLength={200} required /><Input id="offer-type" label="Тип пластику" value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value })} placeholder="PLA, PETG, ASA…" maxLength={80} required /></div>
          <label className="block text-xs space-y-1.5"><span>Категорія пластику</span><select className={selectClass} aria-label="Категорія пластику" value={draft.family} onChange={event => setDraft({ ...draft, family: event.target.value as CompanyOfferInput['family'] })}>{OFFER_FAMILIES.map(family => <option key={family}>{family}</option>)}</select></label>
          <div className="grid sm:grid-cols-2 gap-3"><Input id="offer-color-name" label="Назва кольору" value={draft.colorName} onChange={event => setDraft({ ...draft, colorName: event.target.value })} maxLength={100} required /><Input id="offer-color-hex" label="Колір HEX" value={draft.colorHex} onChange={event => setDraft({ ...draft, colorHex: event.target.value })} placeholder="#ffffff" pattern="#[0-9a-fA-F]{6}" maxLength={7} required /></div>
          <div className="grid sm:grid-cols-2 gap-3"><label className="block text-xs space-y-1.5"><span>Група кольору</span><select className={selectClass} aria-label="Група кольору" value={draft.colorTone} onChange={event => setDraft({ ...draft, colorTone: event.target.value as ColorTone })}>{Object.entries(COLOR_TONES_CONFIG).map(([tone, config]) => <option key={tone} value={tone}>{config.label}</option>)}</select></label><label className="block text-xs space-y-1.5"><span>Упаковка</span><select className={selectClass} aria-label="Упаковка" value={draft.packagingType} onChange={event => setDraft({ ...draft, packagingType: event.target.value as CompanyOfferInput['packagingType'] })}><option value="spool">З котушкою</option><option value="refill">Рефіл без котушки</option></select></label></div>
          <div className="grid sm:grid-cols-3 gap-3"><Input id="offer-weight" label="Вага пластику, г" type="number" min="1" max="100000" step="0.01" value={draft.spoolWeightGrams || ''} onChange={event => setDraft({ ...draft, spoolWeightGrams: Number(event.target.value) })} required /><Input id="offer-price" label="Ціна упаковки, грн" type="number" min="0.01" max="10000000" step="0.01" value={draft.priceUah || ''} onChange={event => setDraft({ ...draft, priceUah: Number(event.target.value) })} required /><Input id="offer-diameter" label="Діаметр, мм" type="number" min="0.1" max="10" step="0.01" value={draft.diameterMm || ''} onChange={event => setDraft({ ...draft, diameterMm: Number(event.target.value) })} required /></div>
          <Input id="offer-url" label="Пряме HTTPS-посилання на товар" type="url" value={draft.productUrl} onChange={event => setDraft({ ...draft, productUrl: event.target.value })} maxLength={2000} required helperText={`Дозволені домени: ${company?.allowedDomains.join(', ') || 'не задано'}.`} />
          <label className="block text-xs space-y-1.5"><span>Опис товару</span><textarea className={`${selectClass} min-h-24`} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} maxLength={10000} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.inStock} onChange={event => setDraft({ ...draft, inStock: event.target.checked })} />В наявності</label>
          <label className="block text-xs space-y-1.5"><span>Публікація</span><select aria-label="Статус публікації" className={selectClass} value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as CompanyOfferInput['status'] })}><option value="hidden">Приховано</option>{(company?.status === 'active' || draft.status === 'published') && <option value="published">Опубліковано одразу</option>}{isAdmin && <option value="blocked">Заблоковано адміністратором</option>}</select></label>
        </fieldset>
      </form>
    </Modal>
  </div>;
};
