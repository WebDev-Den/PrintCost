import React, { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.tsx';
import { organizationRepository } from '../../services/organizationRepository.ts';
import { ANALYTICS_EVENT_TYPES, analyticsService, type AnalyticsCounts, type AnalyticsEventType, type AnalyticsReport } from '../../services/analyticsService.ts';
import type { Company } from '../../domain/organizations.ts';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';

const eventLabels: Record<AnalyticsEventType, string> = { search: 'Пошуки', filter: 'Зміни фільтрів', no_results: 'Без результатів', impression: 'Покази', details: 'Відкриття деталей', seller_click: 'Переходи до продавця', add_material: 'Додавання матеріалу' };
const offerEvents: AnalyticsEventType[] = ['impression', 'details', 'seller_click', 'add_material'];
const ctr = (counts: AnalyticsCounts) => counts.impression > 0 ? `${(counts.seller_click / counts.impression * 100).toFixed(1)}%` : '—';
const today = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}-${parts.find(part => part.type === 'day')!.value}`;
};
const monthAgo = () => new Date(new Date(`${today()}T00:00:00Z`).getTime() - 29 * 86400000).toISOString().slice(0, 10);
const earliestDay = () => { const date = new Date(`${today()}T00:00:00Z`); date.setUTCFullYear(date.getUTCFullYear() - 1); return date.toISOString().slice(0, 10); };
function validPeriod(from: string, to: string): boolean {
  const start = new Date(`${from}T00:00:00Z`); const end = new Date(`${to}T00:00:00Z`);
  return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start.toISOString().slice(0, 10) === from && end.toISOString().slice(0, 10) === to
    && end >= start && (end.getTime() - start.getTime()) / 86400000 + 1 <= 366 && from >= earliestDay() && to <= today();
}

export const AnalyticsPage: React.FC = () => {
  const { user, isDemoSession } = useAuth();
  const eligible = !isDemoSession && Boolean(user?.emailVerified && !user.isBlocked && ['manager', 'admin'].includes(user.role || 'user'));
  const identity = `${user?.id}:${user?.role}:${user?.companyId}:${eligible}`;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesReady, setCompaniesReady] = useState(false);
  const [companiesRevision, setCompaniesRevision] = useState(0);
  const [form, setForm] = useState({ companyId: 'all', from: monthAgo(), to: today() });
  const [query, setQuery] = useState(form);
  const [revision, setRevision] = useState(0);
  const [loadedReport, setReport] = useState<{ key: string; data: AnalyticsReport } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const reportKey = `${identity}|${query.companyId}|${query.from}|${query.to}|${revision}`;
  const report = loadedReport?.key === reportKey ? loadedReport.data : null;

  useEffect(() => {
    let active = true;
    setCompanies([]); setCompaniesReady(false); setReport(null); setLoading(false); setError(null);
    if (!eligible) return;
    const load = async () => {
      try {
        const items = user?.role === 'admin' ? await organizationRepository.listCompanies() : user?.companyId ? [await organizationRepository.getCompany(user.companyId)].filter((company): company is Company => Boolean(company && company.status === 'active')) : [];
        if (!active) return;
        if (user?.role === 'manager' && !items.length) throw new Error('Звіт доступний лише менеджеру активної компанії.');
        const companyId = user?.role === 'manager' ? items[0].id : 'all';
        setCompanies(items); setForm(previous => ({ ...previous, companyId })); setQuery(previous => ({ ...previous, companyId })); setCompaniesReady(true);
      } catch (error) { if (active) setError(error instanceof Error ? error.message : 'Не вдалося завантажити компанії.'); }
    };
    void load();
    return () => { active = false; };
  }, [identity, companiesRevision]);

  useEffect(() => {
    const request = ++generation.current;
    const abort = new AbortController();
    setReport(null);
    if (!eligible || !companiesReady || (user?.role === 'manager' && query.companyId !== user.companyId)) { setLoading(false); return; }
    setLoading(true); setError(null);
    analyticsService.getReport(query.companyId, query.from, query.to, abort.signal).then(value => {
      if (request === generation.current && !abort.signal.aborted) setReport({ key: reportKey, data: value });
    }).catch(error => {
      if (request === generation.current && !abort.signal.aborted) setError(error instanceof Error ? error.message : 'Не вдалося завантажити звіт.');
    }).finally(() => { if (request === generation.current && !abort.signal.aborted) setLoading(false); });
    return () => { abort.abort(); ++generation.current; };
  }, [identity, companiesReady, query, revision]);

  if (!eligible) return <Navigate to="/app/dashboard" replace />;
  const scopeLabel = report?.companyId ? companies.find(company => company.id === report.companyId)?.name || report.companyId : 'Увесь каталог';
  const filterRows = report?.filters || [];
  const companyScope = query.companyId !== 'all' || user?.role === 'manager';
  const visibleEvents = companyScope ? offerEvents : ANALYTICS_EVENT_TYPES;
  const filterEvents = visibleEvents;
  return <div className="space-y-5">
    <div><h1 className="text-xl font-bold text-neutral-900 dark:text-white">Аналітика каталогу</h1><p className="mt-1 text-xs text-neutral-500">{user?.role === 'manager' ? 'Події пропозицій вашої активної компанії. Загальні пошуки й фільтри інших продавців не показуються.' : 'Загальні події каталогу та окремі пропозиції компаній.'} Звіт рахує дії, а не унікальних людей або покупки.</p></div>
    <form className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-3" onSubmit={event => { event.preventDefault(); if (!validPeriod(form.from, form.to)) { setError('Оберіть період у межах останніх 12 місяців, до 366 днів включно й без майбутніх дат.'); return; } setQuery({ ...form }); setRevision(previous => previous + 1); }}>
      <div className="grid sm:grid-cols-3 gap-3"><label className="text-xs space-y-1"><span>Компанія / область звіту</span><select aria-label="Область звіту" value={form.companyId} onChange={event => setForm({ ...form, companyId: event.target.value })} disabled={!companiesReady || user?.role !== 'admin'} className="w-full p-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white">{user?.role === 'admin' && <option value="all">Увесь каталог</option>}{companies.map(company => <option key={company.id} value={company.id}>{company.name}{company.status === 'disabled' ? ' (призупинено)' : ''}</option>)}</select></label><Input label="Від (Київ)" type="date" value={form.from} min={earliestDay()} max={today()} required onChange={event => setForm({ ...form, from: event.target.value })} /><Input label="До (Київ), включно" type="date" value={form.to} min={earliestDay()} max={today()} required onChange={event => setForm({ ...form, to: event.target.value })} /></div>
      <Button type="submit" size="sm" isLoading={loading} disabled={!companiesReady}>Оновити звіт</Button>
    </form>
    {error && <p role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</p>}
    {error && !companiesReady && <Button size="sm" variant="secondary" onClick={() => setCompaniesRevision(previous => previous + 1)}>Повторити завантаження компаній</Button>}
    {loading && <p role="status" className="text-sm text-neutral-500">Завантаження аналітики…</p>}
    {report && <>
      <p className="text-sm font-semibold">{scopeLabel} · {report.from} — {report.to} (за київським часом)</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{visibleEvents.map(type => <div key={type} className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"><p className="text-xs text-neutral-500">{eventLabels[type]}</p><p className="mt-1 text-xl font-semibold font-mono">{report.totals[type]}</p></div>)}<div className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"><p className="text-xs text-neutral-500">Переходи / покази</p><p className="mt-1 text-xl font-semibold font-mono">{ctr(report.totals)}</p></div></div>
      <p className="text-xs text-neutral-500">Відсоток переходів дорівнює кількості переходів до продавця, поділеній на покази за цей період. Він може перевищувати 100% через повторні переходи та неповне збирання показів.</p>
      <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 text-xs text-amber-900 dark:text-amber-300 space-y-1"><p>{report.notice}</p><p>Спільна денна квота сервера на {report.budget.day} (UTC): {report.budget.limit} подій.{report.budget.accepted !== null && ` Прийнято в усьому каталозі: ${report.budget.accepted}.`} Після вичерпання квоти частина подій не потрапляє у звіт; підсумок за вибраний період не є використанням цієї квоти.</p></div>
      <section className="space-y-2"><h2 className="text-sm font-semibold">Події за днями, Київ</h2><div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800"><table className="w-full text-xs text-left"><thead><tr className="bg-neutral-100 dark:bg-neutral-800"><th className="p-2">Дата</th>{visibleEvents.map(type => <th key={type} className="p-2">{eventLabels[type]}</th>)}</tr></thead><tbody>{report.days.map(day => <tr key={day.day} className="border-t border-neutral-200 dark:border-neutral-800"><td className="p-2 whitespace-nowrap">{day.day}</td>{visibleEvents.map(type => <td key={type} className="p-2 font-mono">{day.counts[type]}</td>)}</tr>)}</tbody></table></div>{!report.days.length && <p className="text-xs text-neutral-500">За цей період подій немає.</p>}</section>
      <section className="space-y-2"><h2 className="text-sm font-semibold">Найактивніші пропозиції</h2>{report.offersScanLimited ? <p role="status" className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 text-sm text-amber-800 dark:text-amber-300">Обсяг деталізації завеликий. Звузьте період звіту, щоб побачити пропозиції. Підсумки, дані за днями та категоріями охоплюють усю область звіту.</p> : <><p className="text-xs text-neutral-500">Показано до {report.offersLimit} пропозицій{report.offersTruncated ? '; вибірка обмежена, існують інші пропозиції.' : '.'} Підсумкові лічильники вище охоплюють усю область звіту.</p><div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800"><table className="w-full text-xs text-left"><thead><tr className="bg-neutral-100 dark:bg-neutral-800"><th className="p-2">Пропозиція / компанія</th><th className="p-2">Покази</th><th className="p-2">Деталі</th><th className="p-2">Переходи</th><th className="p-2">Додавання</th><th className="p-2">Переходи / покази</th></tr></thead><tbody>{report.offers.map(offer => <tr key={offer.offerId} className="border-t border-neutral-200 dark:border-neutral-800"><td className="p-2"><span className="font-medium">{offer.name || 'Пропозиція без збереженої назви'}</span><span className="block text-neutral-500">{offer.companyId ? companies.find(company => company.id === offer.companyId)?.name || offer.companyId : 'Загальний каталог'}</span><span className="block text-[10px] font-mono break-all text-neutral-400">ID: {offer.offerId}</span></td><td className="p-2 font-mono">{offer.counts.impression}</td><td className="p-2 font-mono">{offer.counts.details}</td><td className="p-2 font-mono">{offer.counts.seller_click}</td><td className="p-2 font-mono">{offer.counts.add_material}</td><td className="p-2 font-mono">{ctr(offer.counts)}</td></tr>)}</tbody></table></div>{!report.offers.length && <p className="text-xs text-neutral-500">Подій конкретних пропозицій немає.</p>}</>}</section>
      <section className="space-y-2"><h2 className="text-sm font-semibold">Категорії матеріалів, пакування й наявності</h2><p className="text-xs text-neutral-500">До {report.filtersLimit} комбінацій{report.filtersTruncated ? '; вибірка обмежена.' : '.'} {companyScope ? 'Показано категорії подій пропозицій вибраної компанії.' : 'Текст пошуку не зберігається; є лише позначка його наявності.'}</p><div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800"><table className="w-full text-xs text-left"><thead><tr className="bg-neutral-100 dark:bg-neutral-800"><th className="p-2">Матеріал / пакування / наявність</th>{filterEvents.map(type => <th key={type} className="p-2">{eventLabels[type]}</th>)}</tr></thead><tbody>{filterRows.map((filter, index) => <tr key={index} className="border-t border-neutral-200 dark:border-neutral-800"><td className="p-2">{filter.materialType === 'all' ? 'Усі типи' : filter.materialType === 'other' ? 'Інший тип' : filter.materialType} · {filter.packaging === 'spool' ? 'Котушка' : filter.packaging === 'refill' ? 'Рефіл' : 'Усе пакування'} · {filter.stock === 'in_stock' ? 'В наявності' : filter.stock === 'out_of_stock' ? 'Немає в наявності' : 'Усі залишки'}{!companyScope && filter.hasSearch ? ' · Є пошук' : ''}</td>{filterEvents.map(type => <td key={type} className="p-2 font-mono">{filter.counts[type]}</td>)}</tr>)}</tbody></table></div>{!filterRows.length && <p className="text-xs text-neutral-500">Подій цих категорій за цей період немає.</p>}</section>
    </>}
  </div>;
};
